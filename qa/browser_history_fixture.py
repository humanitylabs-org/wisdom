"""Disposable synthetic history with the real HTTP server and shared core."""
import hashlib
import json
import os
from pathlib import Path
import signal
import tempfile
import threading


def main():
    core = Path(os.environ['WISDOM_QA_CORE']).read_bytes()
    evidence = Path(os.environ['WISDOM_QA_EVIDENCE'])
    with tempfile.TemporaryDirectory(prefix='wisdom-history-') as tmp:
        os.environ.update(WISDOM_DATA=tmp+'/data', WISDOM_LIBRARY=tmp+'/media',
                          WISDOM_STARTER_DIR=tmp+'/no-starter', WISDOM_ADMIT='disabled', WISDOM_BASE='')
        os.environ.pop('WISDOM_COLLECTION_SOURCE', None)
        os.environ.pop('WISDOM_WIZARD_ORIGIN', None)
        import server
        import library
        from qa.test_portable import bundle
        from qa.test_release_gates import seed_history
        server.init()
        with server.db() as c:
            library.stage(c, bundle()); library.action(c, {'id': 'example', 'action': 'enable'})
            ids = seed_history(c)
            before = [dict(r) for r in c.execute('SELECT * FROM wisdom_highlight_history ORDER BY seq')]
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
        from qa.test_pinned_revision import altered
        import base64
        raw_a = bundle()
        raw_b = altered(raw_a, lambda f: f.update({'content/example-chapter.md': f['content/example-chapter.md'].replace(b'Quiet attention', b'Different attention')}))
        raw_c = altered(raw_b, lambda f: f.update({'content/example-chapter.md': f['content/example-chapter.md'].replace(b'Different attention', b'Present attention')}))
        revisions = [{'id': 'example', 'collection_id': 'example-collection',
                      'old_sha256': hashlib.sha256(old).hexdigest(), 'new_sha256': hashlib.sha256(new).hexdigest(),
                      'zip_base64': base64.b64encode(new).decode()} for old, new in ((raw_a, raw_b), (raw_b, raw_c))]
        print(json.dumps({'url': 'http://127.0.0.1:'+str(http.server_port)+'/', 'ids': ids,
                          'core_sha256': hashlib.sha256(core).hexdigest(), 'revisions': revisions}), flush=True)
        try:
            stop.wait()
        finally:
            http.shutdown(); http.server_close()
            with server.db() as c:
                after = [dict(r) for r in c.execute('SELECT * FROM wisdom_highlight_history ORDER BY seq')]
                highlights = [dict(r) for r in c.execute('SELECT * FROM wisdom_highlights ORDER BY seq')]
            (evidence/'history-db.json').write_text(json.dumps(dict(before=before, after=after, highlights=highlights), indent=2))


if __name__ == '__main__':
    main()
