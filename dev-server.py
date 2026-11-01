"""Servidor local para desenvolvimento: igual ao `python -m http.server`,
mas sem cache — o navegador sempre recebe a versão mais nova dos arquivos.

Uso (dentro da pasta portfolio):  python dev-server.py
"""
import functools
import http.server
import os

PORT = int(os.environ.get('PORT', 5500))
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_error(self, code, message=None, explain=None):
        # Endereço que não existe: mostra o /404.html, como a hospedagem faz
        # (ele mesmo troca os botões quando o endereço é do painel).
        path = os.path.join(ROOT, '404.html')
        if code != 404 or not os.path.exists(path):
            return super().send_error(code, message, explain)
        body = open(path, 'rb').read()
        self.send_response(404)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)


if __name__ == '__main__':
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(('', PORT), handler) as httpd:
        print(f'Portfólio em http://localhost:{PORT}  (painel: /admin/)')
        httpd.serve_forever()
