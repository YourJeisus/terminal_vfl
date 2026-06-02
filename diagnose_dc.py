"""
Diagnostic tool: find DualConnector and test communication.
Run on the terminal: python diagnose_dc.py
"""
import socket
import struct
import subprocess
import os
import sys
import xml.etree.ElementTree as ET

# INPAS operation code for status check
OP_STATUS = 50
CURRENCY_RUB = 643


def get_listening_ports():
    """Get all listening TCP ports with process info."""
    ports = []
    try:
        result = subprocess.run(
            ['netstat', '-ano'], capture_output=True, text=True, timeout=10
        )
        for line in result.stdout.splitlines():
            if 'LISTENING' not in line:
                continue
            parts = line.split()
            if len(parts) < 5:
                continue
            addr = parts[1]
            pid = parts[4]
            if ':' in addr:
                port = int(addr.rsplit(':', 1)[1])
                ports.append((port, pid))
    except Exception as e:
        print(f'  Error getting ports: {e}')
    # Deduplicate
    seen = set()
    unique = []
    for port, pid in ports:
        if port not in seen:
            seen.add(port)
            unique.append((port, pid))
    return sorted(unique)


def get_process_name(pid):
    """Get process name by PID."""
    try:
        result = subprocess.run(
            ['tasklist', '/FI', f'PID eq {pid}', '/FO', 'CSV', '/NH'],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.strip().splitlines():
            if line.startswith('"'):
                return line.split('"')[1]
    except:
        pass
    return '?'


def build_status_xml():
    """Build INPAS status check XML."""
    root = ET.Element('request')
    ET.SubElement(root, 'operation_code').text = str(OP_STATUS)
    ET.SubElement(root, 'currency_code').text = str(CURRENCY_RUB)
    return '<?xml version="1.0" encoding="windows-1251"?>\n' + ET.tostring(root, encoding='unicode')


def try_tcp_inpas(host, port, timeout=5):
    """Try INPAS DualConnector TCP protocol (4-byte length + XML)."""
    xml_str = build_status_xml()
    results = []

    # Try both encodings
    for encoding in ['windows-1251', 'utf-8']:
        # Try both big-endian and little-endian length prefix
        for endian, label in [('>', 'big-endian'), ('<', 'little-endian')]:
            try:
                encoded = xml_str.encode(encoding)
                header = struct.pack(f'{endian}I', len(encoded))

                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(timeout)
                sock.connect((host, port))
                sock.sendall(header + encoded)

                # Try to read response
                resp = sock.recv(4096)
                sock.close()

                if resp:
                    results.append({
                        'encoding': encoding,
                        'endian': label,
                        'response_len': len(resp),
                        'response_hex': resp[:64].hex(),
                        'response_text': try_decode(resp),
                        'success': True,
                    })
            except socket.timeout:
                results.append({
                    'encoding': encoding,
                    'endian': label,
                    'error': 'timeout (sent ok, no response)',
                    'success': 'maybe',
                })
            except ConnectionRefusedError:
                pass  # Not this port
            except ConnectionResetError:
                results.append({
                    'encoding': encoding,
                    'endian': label,
                    'error': 'connection reset (wrong protocol?)',
                    'success': False,
                })
            except Exception as e:
                results.append({
                    'encoding': encoding,
                    'endian': label,
                    'error': str(e),
                    'success': False,
                })

    return results


def try_tcp_raw(host, port, timeout=3):
    """Try raw TCP connection and see what comes back."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
        # Some services send a banner on connect
        try:
            data = sock.recv(1024)
            sock.close()
            if data:
                return f'Banner: {try_decode(data)[:200]}'
        except socket.timeout:
            sock.close()
            return 'Connected OK (no banner)'
    except ConnectionRefusedError:
        return None
    except Exception as e:
        return f'Error: {e}'


def try_http(host, port, timeout=3):
    """Try HTTP GET to see if it's a web service."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((host, port))
        sock.sendall(b'GET / HTTP/1.0\r\nHost: localhost\r\n\r\n')
        resp = sock.recv(4096)
        sock.close()
        if resp and b'HTTP' in resp:
            first_line = resp.split(b'\r\n')[0].decode('utf-8', errors='replace')
            return f'HTTP: {first_line}'
    except:
        pass
    return None


def try_decode(data):
    """Try to decode bytes as text."""
    for enc in ['utf-8', 'windows-1251', 'ascii']:
        try:
            return data.decode(enc)
        except:
            continue
    return data.hex()


def find_dc_files():
    """Look for DualConnector file exchange directories."""
    common_paths = [
        r'C:\INPAS',
        r'C:\Program Files\INPAS',
        r'C:\Program Files (x86)\INPAS',
        r'C:\ProgramData\INPAS',
        r'C:\DualConnector',
        r'C:\DC',
        r'C:\Program Files\DualConnector',
        r'C:\Program Files (x86)\DualConnector',
    ]
    found = []
    for p in common_paths:
        if os.path.exists(p):
            found.append(p)
            # List contents
            try:
                for item in os.listdir(p):
                    found.append(f'  {item}')
            except:
                pass

    # Also search for DC config files
    for drive in ['C:', 'D:']:
        for root_dir in [drive + '\\']:
            try:
                for item in os.listdir(root_dir):
                    low = item.lower()
                    if 'inpas' in low or 'dual' in low or 'dualconnector' in low or 'dc_' in low or 'smartsale' in low:
                        full = os.path.join(root_dir, item)
                        found.append(full)
                        if os.path.isdir(full):
                            try:
                                for sub in os.listdir(full):
                                    found.append(f'  {sub}')
                            except:
                                pass
            except:
                pass

    return found


def find_dc_config():
    """Search for DC config files with port settings."""
    config_patterns = ['*.ini', '*.cfg', '*.conf', '*.xml', '*.properties', '*.json']
    found_configs = []

    search_dirs = [
        r'C:\INPAS', r'C:\Program Files\INPAS', r'C:\Program Files (x86)\INPAS',
        r'C:\ProgramData\INPAS', r'C:\DualConnector',
        r'C:\Program Files\DualConnector', r'C:\Program Files (x86)\DualConnector',
    ]

    for d in search_dirs:
        if not os.path.exists(d):
            continue
        for root, dirs, files in os.walk(d):
            for f in files:
                low = f.lower()
                if any(low.endswith(ext.replace('*', '')) for ext in config_patterns):
                    fpath = os.path.join(root, f)
                    found_configs.append(fpath)
                    try:
                        with open(fpath, 'r', encoding='utf-8', errors='replace') as fh:
                            content = fh.read(2000)
                            # Look for port settings
                            for line in content.splitlines():
                                low_line = line.lower()
                                if 'port' in low_line or 'socket' in low_line or 'tcp' in low_line:
                                    found_configs.append(f'  >>> {line.strip()}')
                    except:
                        pass

    return found_configs


if __name__ == '__main__':
    print('=' * 60)
    print('  DualConnector Diagnostic Tool')
    print('=' * 60)

    # 1. Find DC installation
    print('\n[1] Searching for DualConnector files...')
    dc_files = find_dc_files()
    if dc_files:
        for f in dc_files:
            print(f'  {f}')
    else:
        print('  No INPAS/DualConnector directories found')

    # 2. Search config files
    print('\n[2] Searching for config files with port settings...')
    configs = find_dc_config()
    if configs:
        for c in configs:
            print(f'  {c}')
    else:
        print('  No config files found')

    # 3. List listening ports
    print('\n[3] Listening TCP ports:')
    ports = get_listening_ports()
    skip_ports = {135, 139, 445, 5357}
    interesting = []
    for port, pid in ports:
        if port in skip_ports or port >= 49000:
            continue
        name = get_process_name(pid)
        print(f'  :{port}  PID={pid}  {name}')
        interesting.append((port, pid, name))

    # 4. Test suspicious ports with INPAS protocol
    print('\n[4] Testing INPAS protocol on each port...')
    skip_known = {5050, 9999}  # Our own services
    for port, pid, name in interesting:
        if port in skip_known:
            print(f'\n  :{port} ({name}) — SKIPPED (our service)')
            continue

        print(f'\n  :{port} ({name}):')

        # Try HTTP first
        http = try_http('127.0.0.1', port)
        if http:
            print(f'    {http}')

        # Try raw connection
        raw = try_tcp_raw('127.0.0.1', port)
        if raw:
            print(f'    Raw: {raw}')

        # Try INPAS protocol
        results = try_tcp_inpas('127.0.0.1', port, timeout=5)
        for r in results:
            if r.get('success') == True:
                print(f'    *** INPAS OK! encoding={r["encoding"]}, length={r["endian"]} ***')
                print(f'    Response ({r["response_len"]} bytes): {r["response_text"][:300]}')
            elif r.get('success') == 'maybe':
                print(f'    INPAS {r["encoding"]}/{r["endian"]}: {r["error"]}')
            elif r.get('success') == False and 'reset' in r.get('error', ''):
                print(f'    INPAS {r["encoding"]}/{r["endian"]}: {r["error"]}')

    print('\n' + '=' * 60)
    print('  Diagnostic complete')
    print('=' * 60)
    input('\nPress Enter to exit...')
