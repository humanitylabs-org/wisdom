#!/usr/bin/env python3
"""Loopback disposable shell + real Wisdom; copies the library/DB, never owner mounts.
WIZARD_PIN_WEB, WISDOM_SOURCE and WISDOM_OFFLINE_SEED are required immutable inputs.
No model, connector, or agent job is contacted. All /wizard APIs are isolated fixtures.
"""
import json
import mimetypes
import os
from pathlib import Path
import shutil
import signal
import sys
import tempfile
import threading
from urllib.parse import unquote, urlsplit


def main():
    web = Path(os.environ['WIZARD_PIN_WEB']).resolve()
    source = Path(os.environ['WISDOM_SOURCE']).resolve()
    seed = Path(os.environ['WISDOM_OFFLINE_SEED']).resolve()
    sys.path.insert(0, str(source))
    with tempfile.TemporaryDirectory(prefix='wizard-pin-', dir=os.environ.get('TMPDIR')) as tmp:
        root = Path(tmp); app = root / 'app'
        shutil.copytree(source / 'static', app / 'static')
        shutil.copytree(seed / 'library', root / 'library')
        (root / 'data').mkdir(); shutil.copy2(seed / 'wisdom.sqlite', root / 'data/wisdom.sqlite')
        os.environ.update(WISDOM_DATA=str(root / 'data'), WISDOM_LIBRARY=str(root / 'library'), WISDOM_BASE='/wisdom', WISDOM_ADMIT='disabled', WISDOM_SEED_STARTER='0')
        for name in ['WISDOM_WIZARD_ORIGIN', 'WISDOM_COLLECTION_SOURCE', 'WISDOM_ROUTER_URL', 'WISDOM_ROUTER_GRANT', 'WISDOM_DISCUSS_TOKEN']:
            os.environ.pop(name, None)
        import importlib
        server = importlib.import_module('server')
        setattr(server, 'ROOT', app); server.init()
        class Handler(server.Handler):
            def do_GET(self):
                path = urlsplit(self.path).path
                if path == '/wizard/v1/bootstrap':
                    return self.send(200, {'bootstrap': 1, 'settings': {'owner': {}, 'agent': {'name': 'Wizard'}, 'clock': {}}, 'capabilities': {}, 'endpoints': {'apps': '/wizard/v1/apps'}})
                if path == '/wizard/v1/apps':
                    return self.send(200, {'apps': [{'id': 'wisdom', 'name': 'Wisdom', 'url': '/wisdom/', 'icon': '/wisdom/icon.svg', 'source': 'apps.json'}]})
                if path == '/wizard/v1/agents': return self.send(200, {'agents': []})
                if path.startswith('/wizard/'): return self.send(404, {'error': 'Disposable fixture: unavailable'})
                if path.startswith('/wizard-os-home/'):
                    relative = unquote(path[len('/wizard-os-home/'):]) or 'index.html'
                    file = (web / relative).resolve()
                    if not file.is_relative_to(web) or not file.is_file(): return self.send(404, {'error': 'Not found'})
                    data = file.read_bytes()
                    # Optional negative control reproduces the shell unregistering Wisdom's approved worker.
                    if os.environ.get('PIN_REPRO_LEGACY') == '1' and relative == 'core/apps.js':
                        data = data.replace(b'window.WizCore.appMigrations = Object.freeze({', b"window.WizCore.appMigrations = Object.freeze({ wisdom: {scope:'/wisdom/',scripts:['/wisdom/sw.js'],caches:[]},")
                    mime = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
                    if file.suffix == '.js': mime = 'application/javascript'
                    return self.send(200, json.loads(data) if mime == 'application/json' else data, mime)
                return super().do_GET()
            def do_POST(self):
                if self.path.startswith('/wizard/'): return self.send(404, {'error': 'Disposable fixture: unavailable'})
                return super().do_POST()
        http = server.ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('PIN_PORT', '0'))), Handler)
        scheme = 'http'
        # Optional disposable TLS for the unchanged signed release APK. Use only a
        # rig-generated CA trusted by that disposable AVD; never copy owner TLS keys.
        if os.environ.get('PIN_TLS_CERT'):
            import ssl
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(os.environ['PIN_TLS_CERT'], os.environ['PIN_TLS_KEY'])
            http.socket = tls.wrap_socket(http.socket, server_side=True); scheme = 'https'
        threading.Thread(target=http.serve_forever, daemon=True).start()
        stop = threading.Event()
        for sig in (signal.SIGTERM, signal.SIGINT): signal.signal(sig, lambda *_: stop.set())
        print(json.dumps({'url': f'{scheme}://localhost:{http.server_port}/wizard-os-home/?app-session=wisdom', 'temporary_copy': str(root), 'web': str(web), 'wisdom_source': str(source)}), flush=True)
        try: stop.wait()
        finally: http.shutdown(); http.server_close()

if __name__ == '__main__': main()
