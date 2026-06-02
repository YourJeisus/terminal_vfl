#!/usr/bin/env python3
"""
Payment bridge: HTTP REST <-> INPAS DualConnector HTTP/XML.
Translates requests from Chrome into HTTP POST commands for DC Service.

Architecture:
  Chrome -> HTTP :5050 -> this -> HTTP :9015 -> DC Service -> COM3 -> PAX S300 -> Bank

Protocol (from kkmspb.ru debug dumps):
  POST / HTTP/1.1, Content-Type: text/xml
  <request><field id="25">OP</field><field id="04">AMOUNT</field><timeout>N</timeout></request>
  Response: windows-1251 XML with <field id="39">response_code</field>
"""

import http.server
import json
import socketserver
import threading
import xml.etree.ElementTree as ET
import os
import sys
import time
import traceback
import urllib.request
import urllib.error
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DC_HOST = os.environ.get('DC_HOST', '127.0.0.1')
DC_PORT = int(os.environ.get('DC_PORT', '9015'))
PAY_PORT = int(os.environ.get('PAY_PORT', '5050'))
DC_TIMEOUT = 45    # seconds — shorter for better UX (user can retry)
SETTLEMENT_TIME = os.environ.get('SETTLEMENT_TIME', '23:55')

# INPAS operation codes (field 25)
OP_PURCHASE   = '1'
OP_CANCEL     = '2'
OP_REFUND     = '3'
OP_SETTLEMENT = '7'
OP_TEST       = '26'

# INPAS field IDs (confirmed from live testing)
F_AMOUNT    = '00'   # Amount in kopecks
F_CURRENCY  = '04'   # Currency code (643 = RUB)
F_CARD      = '10'   # Masked card number
F_AUTHCODE  = '13'   # Authorization code
F_MESSAGE   = '19'   # Status message text
F_TIMESTAMP = '21'   # YYYYMMDDHHmmss
F_OPERATION = '25'   # Operation type
F_TERMINAL  = '27'   # Terminal ID
F_MERCHANT  = '28'   # Merchant ID
F_RESPONSE  = '39'   # Response code (1=OK)
F_RRN       = '52'   # Retrieval Reference Number
F_RECEIPT   = '90'   # Receipt text

TERMINAL_ID = '10364869'


# ---------------------------------------------------------------------------
# DualConnector HTTP protocol
# ---------------------------------------------------------------------------

def build_xml(operation, amount=None, rrn=None, timeout_sec=120):
    """Build INPAS field-based XML request."""
    root = ET.Element('request')
    if amount is not None:
        ET.SubElement(root, 'field', id=F_AMOUNT).text = str(int(amount))
    ET.SubElement(root, 'field', id=F_CURRENCY).text = '643'
    ET.SubElement(root, 'field', id=F_OPERATION).text = str(operation)
    ET.SubElement(root, 'field', id=F_TERMINAL).text = TERMINAL_ID
    if rrn:
        ET.SubElement(root, 'field', id=F_RRN).text = str(rrn)
    ET.SubElement(root, 'timeout').text = str(timeout_sec)
    return ET.tostring(root, encoding='unicode')


def send_to_dc(xml_str, timeout=DC_TIMEOUT):
    """Send XML to DualConnector via HTTP POST."""
    url = f'http://{DC_HOST}:{DC_PORT}/'
    data = xml_str.encode('utf-8')

    print(f'[DC] >>> POST {url}')
    print(f'[DC] >>> {xml_str}')

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            'Content-Type': 'text/xml',
            'Accept': 'text/html',
            'Connection': 'Keep-Alive',
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp_body = resp.read()
            # DC responds in windows-1251
            try:
                decoded = resp_body.decode('windows-1251')
            except UnicodeDecodeError:
                decoded = resp_body.decode('utf-8', errors='replace')
            print(f'[DC] <<< {decoded[:500]}')
            return decoded
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        print(f'[DC] <<< HTTP {e.code}: {body[:300]}')
        raise Exception(f'DC HTTP error {e.code}: {body[:200]}')


def parse_response(xml_str):
    """Parse INPAS field-based XML response."""
    result = {}
    try:
        root = ET.fromstring(xml_str)
        for child in root:
            if child.tag == 'field':
                fid = child.get('id', '')
                result[fid] = child.text or ''
            else:
                result[child.tag] = child.text or ''
    except ET.ParseError as e:
        result['_parse_error'] = str(e)
        result['_raw'] = xml_str
    return result


def is_success(fields):
    """Check if response indicates success."""
    code = fields.get(F_RESPONSE, '')
    message = fields.get(F_MESSAGE, '').upper()
    # DC returns '00' or '1' for success, and message contains 'ОДОБРЕНО'
    return code in ('00', '1') or 'ОДОБРЕН' in message


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class PaymentHandler(http.server.BaseHTTPRequestHandler):

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/status':
            self._handle_status()
        else:
            self.send_error(404)

    def do_POST(self):
        routes = {
            '/api/pay':        self._handle_pay,
            '/api/cancel':         self._handle_cancel,
            '/api/cancel-current': self._handle_cancel_current,
            '/api/refund':         self._handle_refund,
            '/api/status':         self._handle_status,
            '/api/settlement':     self._handle_settlement,
            '/api/test':           self._handle_test,
        }
        handler = routes.get(self.path)
        if handler:
            handler()
        else:
            self.send_error(404)

    def _read_json(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def _send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(body)

    def _make_response(self, fields):
        """Build standard JSON response from INPAS fields."""
        return {
            'response_code':      fields.get(F_RESPONSE, ''),
            'message':            fields.get(F_MESSAGE, ''),
            'rrn':                fields.get(F_RRN, ''),
            'authorization_code': fields.get(F_AUTHCODE, ''),
            'card_number':        fields.get(F_CARD, ''),
            'terminal_id':        fields.get(F_TERMINAL, ''),
            'amount':             fields.get(F_AMOUNT, ''),
            'receipt':            fields.get(F_RECEIPT, ''),
            'all_fields':         fields,
        }

    # --- Test endpoint (uses same format as DC Control test) ---

    def _handle_test(self):
        """POST /api/test — test connection (same as DC Control)."""
        try:
            print('[TEST] Testing DualConnector connection...')
            xml_req = build_xml(OP_TEST, timeout_sec=60)
            xml_resp = send_to_dc(xml_req, timeout=30)
            fields = parse_response(xml_resp)
            resp = self._make_response(fields)
            resp['success'] = True
            resp['connected'] = True
            self._send_json(200, resp)
        except urllib.error.URLError as e:
            self._send_json(200, {
                'success': False, 'connected': False,
                'error': f'Cannot connect: {e.reason}',
            })
        except Exception as e:
            self._send_json(200, {
                'success': False, 'connected': False,
                'error': str(e),
            })

    # --- Cancel in-progress transaction ---

    def _handle_cancel_current(self):
        """POST /api/cancel-current — abort transaction waiting on terminal."""
        try:
            print('[CANCEL-CURRENT] Sending cancel to DualConnector...')
            # Send a test/status request to interrupt the pending operation
            xml_req = build_xml(OP_TEST, timeout_sec=5)
            xml_resp = send_to_dc(xml_req, timeout=10)
            fields = parse_response(xml_resp)
            print(f'[CANCEL-CURRENT] Response: {fields.get(F_MESSAGE, "")}')
            self._send_json(200, {'success': True, 'message': 'Cancel sent'})
        except Exception as e:
            print(f'[CANCEL-CURRENT] Error: {e}')
            self._send_json(200, {'success': False, 'error': str(e)})

    # --- Payment endpoints ---

    def _handle_pay(self):
        """POST /api/pay  {amount: kopecks, order_id: string}"""
        try:
            params = self._read_json()
            amount = params.get('amount')
            order_id = params.get('order_id', '')

            if not amount or int(amount) <= 0:
                self._send_json(400, {'success': False, 'error': 'Invalid amount'})
                return

            print(f'[PAY] Purchase: {int(amount)} kopecks, order={order_id}')

            xml_req = build_xml(OP_PURCHASE, amount=int(amount), timeout_sec=DC_TIMEOUT)
            xml_resp = send_to_dc(xml_req, timeout=DC_TIMEOUT)
            fields = parse_response(xml_resp)

            success = is_success(fields)
            resp = self._make_response(fields)
            resp['success'] = success

            tag = 'OK' if success else f'DECLINED ({fields.get(F_RESPONSE, "?")})'
            print(f'[PAY] {tag}: {fields.get(F_MESSAGE, "")}')
            self._send_json(200, resp)

        except urllib.error.URLError as e:
            print(f'[PAY] Connection error: {e}')
            self._send_json(503, {
                'success': False,
                'error': f'DualConnector not available: {e.reason}',
            })
        except Exception as e:
            print(f'[PAY] Error: {e}')
            traceback.print_exc()
            self._send_json(500, {'success': False, 'error': str(e)})

    def _handle_cancel(self):
        """POST /api/cancel  {amount: kopecks, rrn: string}"""
        try:
            params = self._read_json()
            amount = params.get('amount')
            rrn = params.get('rrn')
            if not amount or not rrn:
                self._send_json(400, {'success': False, 'error': 'amount and rrn required'})
                return

            print(f'[CANCEL] {amount} kopecks, rrn={rrn}')
            xml_req = build_xml(OP_CANCEL, amount=int(amount), rrn=rrn)
            xml_resp = send_to_dc(xml_req)
            fields = parse_response(xml_resp)
            resp = self._make_response(fields)
            resp['success'] = is_success(fields)
            self._send_json(200, resp)
        except Exception as e:
            print(f'[CANCEL] Error: {e}')
            self._send_json(500, {'success': False, 'error': str(e)})

    def _handle_refund(self):
        """POST /api/refund  {amount: kopecks, rrn: string}"""
        try:
            params = self._read_json()
            amount = params.get('amount')
            rrn = params.get('rrn')
            if not amount or not rrn:
                self._send_json(400, {'success': False, 'error': 'amount and rrn required'})
                return

            print(f'[REFUND] {amount} kopecks, rrn={rrn}')
            xml_req = build_xml(OP_REFUND, amount=int(amount), rrn=rrn)
            xml_resp = send_to_dc(xml_req)
            fields = parse_response(xml_resp)
            resp = self._make_response(fields)
            resp['success'] = is_success(fields)
            self._send_json(200, resp)
        except Exception as e:
            print(f'[REFUND] Error: {e}')
            self._send_json(500, {'success': False, 'error': str(e)})

    def _handle_status(self):
        """POST|GET /api/status"""
        try:
            xml_req = build_xml(OP_TEST, timeout_sec=30)
            xml_resp = send_to_dc(xml_req, timeout=15)
            fields = parse_response(xml_resp)
            self._send_json(200, {
                'success': True, 'connected': True,
                'message': fields.get(F_MESSAGE, ''),
                'all_fields': fields,
            })
        except urllib.error.URLError:
            self._send_json(200, {
                'success': False, 'connected': False,
                'error': 'DualConnector HTTP not available',
            })
        except Exception as e:
            self._send_json(200, {
                'success': False, 'connected': False,
                'error': str(e),
            })

    def _handle_settlement(self):
        """POST /api/settlement"""
        try:
            print('[SETTLEMENT] Starting...')
            xml_req = build_xml(OP_SETTLEMENT, timeout_sec=60)
            xml_resp = send_to_dc(xml_req, timeout=60)
            fields = parse_response(xml_resp)
            success = is_success(fields)
            print(f'[SETTLEMENT] {"OK" if success else "FAILED"}: {fields.get(F_MESSAGE, "")}')
            resp = self._make_response(fields)
            resp['success'] = success
            self._send_json(200, resp)
        except Exception as e:
            print(f'[SETTLEMENT] Error: {e}')
            self._send_json(500, {'success': False, 'error': str(e)})

    def log_message(self, fmt, *args):
        print(f'[{time.strftime("%H:%M:%S")}] {args[0] if args else fmt}')


# ---------------------------------------------------------------------------
# Auto-settlement scheduler
# ---------------------------------------------------------------------------

def run_settlement():
    try:
        print(f'[SETTLEMENT] Auto-settlement at {time.strftime("%H:%M:%S")}')
        xml_req = build_xml(OP_SETTLEMENT, timeout_sec=60)
        xml_resp = send_to_dc(xml_req, timeout=60)
        fields = parse_response(xml_resp)
        success = is_success(fields)
        print(f'[SETTLEMENT] {"OK" if success else "FAILED"}: {fields.get(F_MESSAGE, "")}')
        return success
    except Exception as e:
        print(f'[SETTLEMENT] Error: {e}')
        return False


def settlement_scheduler():
    while True:
        now = datetime.now()
        hour, minute = map(int, SETTLEMENT_TIME.split(':'))
        target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        wait_seconds = (target - now).total_seconds()
        print(f'[SETTLEMENT] Next at {target.strftime("%Y-%m-%d %H:%M")}'
              f' (in {int(wait_seconds // 3600)}h {int((wait_seconds % 3600) // 60)}m)')
        time.sleep(wait_seconds)
        run_settlement()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    for i, arg in enumerate(sys.argv):
        if arg == '--dc-port' and i + 1 < len(sys.argv):
            DC_PORT = int(sys.argv[i + 1])
        if arg == '--settlement-time' and i + 1 < len(sys.argv):
            SETTLEMENT_TIME = sys.argv[i + 1]

    print('=' * 50)
    print('  PAX S300 Payment Service')
    print('=' * 50)
    print(f'  Listen:          http://0.0.0.0:{PAY_PORT}')
    print(f'  DualConnector:   http://{DC_HOST}:{DC_PORT}/')
    print(f'  Protocol:        HTTP POST, field id="25"')
    print(f'  Timeout:         {DC_TIMEOUT}s')
    print(f'  Settlement:      {SETTLEMENT_TIME}')
    print('=' * 50)

    settler = threading.Thread(target=settlement_scheduler, daemon=True)
    settler.start()

    class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True

    server = ThreadedHTTPServer(('0.0.0.0', PAY_PORT), PaymentHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[PAYMENT] Shutting down')
        server.server_close()
