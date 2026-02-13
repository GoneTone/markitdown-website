#!/usr/bin/env python3
"""本地開發測試用伺服器（含 COOP/COEP 標頭）"""
import http.server
import socketserver
import os

class COOPHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        super().end_headers()

    def log_message(self, format, *args):
        pass  # 靜音日誌

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PORT = 8080
print(f"測試伺服器啟動於 http://localhost:{PORT}")
print("按 Ctrl+C 停止")
with socketserver.TCPServer(("", PORT), COOPHandler) as httpd:
    httpd.serve_forever()
