import http.server
import socketserver
import os
import sys

# Определяем рабочую директорию (папка, где лежит этот скрипт)
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


def resolve_port():
    raw_port = os.environ.get("PORT")
    if len(sys.argv) > 1:
        raw_port = sys.argv[1]

    if raw_port is None:
        return 8000

    try:
        port = int(raw_port)
    except ValueError as exc:
        raise SystemExit(f"Invalid port: {raw_port}") from exc

    if not 1 <= port <= 65535:
        raise SystemExit(f"Port out of range: {port}")

    return port


PORT = resolve_port()

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Указываем серверу работать в папке скрипта
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Отключаем кеширование для браузера
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    os.chdir(DIRECTORY)
    with ReusableTCPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"=== UI Server 2026 Ready ===")
        print(f"Root: {DIRECTORY}")
        print(f"URL: http://127.0.0.1:{PORT}")
        httpd.serve_forever()
