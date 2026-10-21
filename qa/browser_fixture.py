"""Disposable browser fixture; requires a real shared core, never a stub.

Run as python -m qa.browser_fixture. All data is synthetic plus approved starter.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import tempfile
import threading


def main():
    core = Path(os.environ['WISDOM_QA_CORE']).read_bytes()
    with tempfile.TemporaryDirectory(prefix='wisdom-browser-') as tmp:
        os.environ.update(WISDOM_DATA=tmp+'/data', WISDOM_LIBRARY=tmp+'/media',
                          WISDOM_SEED_STARTER='1', WISDOM_ADMIT='disabled', WISDOM_BASE='')
        os.environ.pop('WISDOM_COLLECTION_SOURCE', None)
        os.environ.pop('WISDOM_WIZARD_ORIGIN', None)
        import library
        import server
        from qa.test_library_scope import multi_bundle
        server.init()
        with server.db() as c:
            b = library.stage(c, multi_bundle())
            library.action(c, {'id': b['id'], 'action': 'enable'})
        class Handler(server.Handler):
            def do_GET(self):
                if self.path == '/wizard-os-home/core/app-client.js':
                    return self.send(200, core, 'application/javascript')
                return super().do_GET()
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=http.serve_forever, daemon=True).start()
        stop = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        signal.signal(signal.SIGINT, lambda *_: stop.set())
        print(json.dumps({'url': 'http://127.0.0.1:'+str(http.server_port)+'/',
                          'core_sha256': hashlib.sha256(core).hexdigest()}), flush=True)
        try:
            stop.wait()
        finally:
            http.shutdown(); http.server_close()


if __name__ == '__main__':
    main()
