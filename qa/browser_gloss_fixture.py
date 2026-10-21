"""Disposable synthetic library whose section opens on a glossed drop cap (道)."""
import hashlib
import json
import os
from pathlib import Path
import signal
import tempfile
import threading


def main():
    core = Path(os.environ['WISDOM_QA_CORE']).read_bytes()
    with tempfile.TemporaryDirectory(prefix='wisdom-gloss-') as tmp:
        os.environ.update(WISDOM_DATA=tmp+'/data', WISDOM_LIBRARY=tmp+'/media',
                          WISDOM_STARTER_DIR=tmp+'/no-starter', WISDOM_ADMIT='disabled', WISDOM_BASE='')
        os.environ.pop('WISDOM_COLLECTION_SOURCE', None)
        os.environ.pop('WISDOM_WIZARD_ORIGIN', None)
        import server
        import library
        from qa.test_portable import bundle
        body = ('# A quiet beginning\n\n'
                '## Reading it slowly\n\n'
                '道 **is a pun.** The character means a road, and it also means to say. '
                'The way that can be walked, or told, is not the lasting one.\n\n'
                + 'Read slowly and return to the moment. '*30
                + '\n\n## Sources\n\n[1] https://example.org\n')
        server.init()
        with server.db() as c:
            library.stage(c, bundle(extra={'content/example-chapter.md': body}))
            library.action(c, {'id': 'example', 'action': 'enable'})
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
