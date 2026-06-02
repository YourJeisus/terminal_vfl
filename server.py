#!/usr/bin/env python3
"""HTTP server with no-cache headers + /print endpoint for silent thermal printing."""
import http.server
import json
import base64
import io
import sys
import os

# --- Load .env file ---
def load_env(path='.env'):
    """Load key=value pairs from .env file into os.environ."""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
    if not os.path.exists(env_path):
        print(f"[ENV] Warning: {env_path} not found, using environment variables")
        return
    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip())
    print(f"[ENV] Loaded from {env_path}")

load_env()

TERMINAL_NAME = os.environ.get('TERMINAL_NAME', 'term1')
TERMINAL_CODE = os.environ.get('TERMINAL_CODE', '')
TERMINAL_ID = os.environ.get('TERMINAL_ID', '1')

print(f"[ENV] TERMINAL_NAME={TERMINAL_NAME}")
print(f"[ENV] TERMINAL_CODE={'*' * len(TERMINAL_CODE) if TERMINAL_CODE else 'EMPTY!'}")
print(f"[ENV] TERMINAL_ID={TERMINAL_ID}")
if not TERMINAL_CODE:
    print("[ENV] WARNING: TERMINAL_CODE is empty! Set it in .env file")

# --- Printer setup (Windows GDI, like PhotoBudka) ---

PRINTER = None
PRINTER_NAME = None

def init_printer():
    """Detect default printer on Windows."""
    global PRINTER_NAME
    if sys.platform != "win32":
        print("[PRINTER] Not Windows — print endpoint will simulate only")
        return
    try:
        import win32print
        PRINTER_NAME = win32print.GetDefaultPrinter()
        print(f"[PRINTER] GDI mode, using '{PRINTER_NAME}'")
    except ImportError:
        print("[PRINTER] win32print not available. Install: pip install pywin32")
    except Exception as e:
        print(f"[PRINTER] Error detecting printer: {e}")


def print_image_gdi(img_bytes):
    """Print image bytes via Windows GDI — no browser dialog."""
    global PRINTER_NAME
    try:
        import win32print
        import win32ui
        from PIL import Image, ImageWin

        if not PRINTER_NAME:
            PRINTER_NAME = win32print.GetDefaultPrinter()

        img = Image.open(io.BytesIO(img_bytes))

        # Convert to RGB if needed
        if img.mode != "RGB":
            img = img.convert("RGB")

        hdc = win32ui.CreateDC()
        hdc.CreatePrinterDC(PRINTER_NAME)
        hdc.StartDoc("TerminalVG_Ticket")
        hdc.StartPage()

        # Get printer page size in pixels
        page_w = hdc.GetDeviceCaps(110)  # PHYSICALWIDTH
        page_h = hdc.GetDeviceCaps(111)  # PHYSICALHEIGHT

        # Scale image to fit page width
        w, h = img.size
        ratio = min(page_w / w, page_h / h)
        new_w = int(w * ratio)
        new_h = int(h * ratio)

        # Center horizontally
        x = (page_w - new_w) // 2
        y = 0

        dib = ImageWin.Dib(img)
        dib.draw(hdc.GetHandleOutput(), (x, y, x + new_w, y + new_h))

        hdc.EndPage()
        hdc.EndDoc()
        hdc.DeleteDC()

        return True, "Printed via GDI"
    except ImportError as e:
        return False, f"Missing library: {e}. Run: pip install pywin32 Pillow"
    except Exception as e:
        return False, f"GDI print error: {e}"


# --- HTTP Server ---

class TerminalHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # CORS headers for Vercel origin (if frontend loaded from there)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # No-cache
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path == '/print':
            self._handle_print()
        elif self.path == '/api/categories':
            self._handle_api_proxy()
        elif self.path == '/api/tickets/create':
            self._handle_tickets_proxy()
        elif self.path == '/api/tickets/email':
            self._handle_email_proxy()
        else:
            self.send_error(404)

    def _handle_print(self):
        """Receive base64 PNG image → print via Windows GDI."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body)

            img_data = data.get('image', '')
            # Strip data URL prefix if present
            if ',' in img_data:
                img_data = img_data.split(',', 1)[1]

            img_bytes = base64.b64decode(img_data)

            if sys.platform == "win32" and PRINTER_NAME:
                success, message = print_image_gdi(img_bytes)
            else:
                # Simulate on non-Windows
                success = True
                message = "Print simulated (not Windows)"
                print(f"[PRINT SIMULATED] Received {len(img_bytes)} bytes")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': success,
                'message': message
            }).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': False,
                'message': str(e)
            }).encode())

    def _handle_api_proxy(self):
        """Proxy POST to external ticket API — injects credentials from .env."""
        import urllib.request
        try:
            # Ignore frontend body — build request with server-side credentials
            length = int(self.headers.get('Content-Length', 0))
            if length > 0:
                self.rfile.read(length)  # drain

            payload = json.dumps({
                'terminal_name': TERMINAL_NAME,
                'terminal_code': TERMINAL_CODE
            }).encode()

            api_url = 'https://vgsport-admin.eskimos.ski/api/v1/tickets/terminal/categories'
            req = urllib.request.Request(
                api_url,
                data=payload,
                headers={
                    'Content-Type': 'application/json',
                    'Cookie': f'terminal_id={TERMINAL_ID}'
                },
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp_body = resp.read()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(resp_body)
            print(f"[API PROXY] OK, {len(resp_body)} bytes")

        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': True,
                'message': str(e)
            }).encode())
            print(f"[API PROXY] Error: {e}")

    def _handle_tickets_proxy(self):
        """Proxy POST to Eskimos ticket creation API — injects terminal_code from .env."""
        import urllib.request
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body) if body else {}

            # Inject server-side credentials (overwrite anything from frontend)
            data['terminal_code'] = TERMINAL_CODE
            if 'transaction' in data:
                data['transaction']['terminal_id'] = TERMINAL_ID

            payload = json.dumps(data).encode()

            api_url = 'https://vgsport-admin.eskimos.ski/api/v1/tickets/terminal/create'
            req = urllib.request.Request(
                api_url,
                data=payload,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp_body = resp.read()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(resp_body)
            print(f"[TICKETS] Created OK, {len(resp_body)} bytes")

        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': True,
                'message': str(e)
            }).encode())
            print(f"[TICKETS] Error: {e}")

    def _handle_email_proxy(self):
        """Proxy POST to Eskimos email receipt API — injects terminal_code from .env."""
        import urllib.request
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body) if body else {}

            data['terminal_code'] = TERMINAL_CODE

            payload = json.dumps(data).encode()

            api_url = 'https://vgsport-admin.eskimos.ski/api/v1/tickets/terminal/email'
            req = urllib.request.Request(
                api_url,
                data=payload,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp_body = resp.read()

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(resp_body)
            print(f"[EMAIL] Sent OK, {len(resp_body)} bytes")

        except Exception as e:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'error': True,
                'message': str(e)
            }).encode())
            print(f"[EMAIL] Error: {e}")

    def do_GET(self):
        if self.path == '/printer-status':
            self._handle_status()
            return
        # Clear conditional headers
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        if 'If-None-Match' in self.headers:
            del self.headers['If-None-Match']
        super().do_GET()

    def _handle_status(self):
        """Check if printer is available."""
        status = {
            'available': PRINTER_NAME is not None,
            'name': PRINTER_NAME,
            'method': 'gdi' if PRINTER_NAME else None
        }
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(status).encode())


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 9999))
    print_only = '--print-only' in sys.argv

    init_printer()

    if print_only:
        # Only handle /print and /printer-status, no static files
        print(f'Print server on 0.0.0.0:{port} (print-only mode)')
    else:
        print(f'Serving on 0.0.0.0:{port} (static files + print endpoint)')

    server = http.server.HTTPServer(('0.0.0.0', port), TerminalHandler)
    server.serve_forever()
