"""Disposable browser fixture with one four-chapter collection; requires a real shared core, never a stub.

Run as python -m qa.browser_chapters_fixture. All data is synthetic. Used by browser suites that turn pages
across chapters (qa/browser_forward_next_chapter_cover.cjs).
"""
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import tempfile
import threading
import zipfile

WORDS = ('Quiet attention begins with one thing and returns to it again. The reader keeps the line in view, '
         'turns the page, and finds the thought still waiting there. ')


def chapters_bundle(key='turns', count=4, repeat=14):
    m = {'version': 1, 'id': key, 'title': 'Turning pages', 'license': 'CC0 (synthetic QA text)',
         'attribution': 'Synthetic engine QA fixture', 'rights': 'redistributable'}
    ids = [f'{key}-{i}' for i in range(1, count + 1)]
    d = {'thinkers': [{'id': key + '-author', 'name': 'Example Author', 'series': 'Example', 'bio': 'Test', 'url': 'https://example.org'}],
         'entries': [{'id': i, 'title': f'Chapter {n} of the turning test', 'thinker': key + '-author', 'part': n,
                      'deck': 'Synthetic reader text', 'source_url': 'https://example.org'} for n, i in enumerate(ids, 1)],
         'collections': [{'id': key + '-collection', 'title': 'Turning pages', 'kind': 'Collection', 'form': 'Book',
                          'by': 'Example Author', 'thinker': key + '-author', 'bio': 'Test', 'entries': ids}]}
    files = {'collection.json': json.dumps(m).encode(), 'content/catalog.json': json.dumps(d).encode()}
    for n, i in enumerate(ids, 1):
        body = f'# Chapter {n} of the turning test\n\n' + '\n\n'.join(f'## Part {p}\n\n' + WORDS * repeat for p in range(1, 4))
        files[f'content/{i}.md'] = body.encode()
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, b in files.items():
            info = zipfile.ZipInfo(n, (1980, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED; z.writestr(info, b)
    return out.getvalue()


def main():
    core = Path(os.environ['WISDOM_QA_CORE']).read_bytes()
    with tempfile.TemporaryDirectory(prefix='wisdom-chapters-') as tmp:
        os.environ.update(WISDOM_DATA=tmp+'/data', WISDOM_LIBRARY=tmp+'/media', WISDOM_SEED_STARTER='0',
                          WISDOM_ADMIT='disabled', WISDOM_BASE='', WISDOM_STARTER_DIR=tmp+'/no-starter')
        os.environ.pop('WISDOM_COLLECTION_SOURCE', None)
        os.environ.pop('WISDOM_WIZARD_ORIGIN', None)
        import library
        import server
        server.init()
        with server.db() as c:
            b = library.stage(c, chapters_bundle())
            library.action(c, {'id': b['id'], 'action': 'enable'})
        class Handler(server.Handler):
            def do_GET(self):
                if self.path == '/wizard-os-home/core/app-client.js':
                    return self.send(200, core, 'application/javascript')
                if self.path == '/wizard-os-home/core/app-identity.js':
                    identity = Path(os.environ.get('WISDOM_QA_IDENTITY', str(Path(os.environ['WISDOM_QA_CORE']).with_name('app-identity.js')))).read_bytes()
                    return self.send(200, identity, 'application/javascript')
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
