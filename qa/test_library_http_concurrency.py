"""Synthetic HTTP concurrency on the real server/router, gated full send, no owner data."""
import concurrent.futures
import json
import threading
import unittest
import urllib.request
from unittest.mock import patch
import server
import library
from qa.test_library_boot import LibraryBoot


class HTTPConcurrency(LibraryBoot):
    def test_real_metadata_and_chapter_respond_while_full_response_pending(self):
        self.install_many()
        compute = getattr(self, '_gate_computation', False)
        if compute: library.CACHE.clear()
        arrived = threading.Event(); release = threading.Event(); inspect_once = threading.Lock()
        inspect = library.inspect_bundle
        def gated_inspect(raw):
            if compute and inspect_once.acquire(blocking=False):
                arrived.set()
                if not release.wait(4): raise RuntimeError('full computation gate deadline')
            return inspect(raw)
        send = server.Handler.send
        def gated(handler, status, payload, *args, **kwargs):
            if handler.path == '/api/wisdom' and not compute:
                arrived.set()
                if not release.wait(4): raise RuntimeError('full response gate deadline')
            return send(handler, status, payload, *args, **kwargs)
        from http.server import ThreadingHTTPServer
        httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True); thread.start()
        base = 'http://127.0.0.1:'+str(httpd.server_port)
        def get(path):
            with urllib.request.urlopen(base+path, timeout=3) as r: return json.load(r)
        try:
            with patch.object(server.Handler, 'send', gated), patch.object(library, 'inspect_bundle', gated_inspect), concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                full = pool.submit(get, '/api/wisdom')
                try:
                    self.assertTrue(arrived.wait(2))
                    meta = get('/api/wisdom/metadata'); self.assertTrue(meta['metadata_only'])
                    entry = meta['entries'][0]
                    body = get('/api/wisdom/chapter/'+entry['id'])
                    self.assertEqual(body['body_sha256'], entry['body_sha256'])
                    self.assertTrue(body['body'])
                    self.assertFalse(full.done(), 'full response remains pending during both real requests')
                finally: release.set()
                self.assertTrue(full.result(3)['entries'])
        finally:
            release.set();httpd.shutdown();httpd.server_close();thread.join(2)

    def test_real_metadata_and_chapter_respond_during_full_computation(self):
        self._gate_computation = True
        self.test_real_metadata_and_chapter_respond_while_full_response_pending()

for name in list(vars(LibraryBoot)):
    if name.startswith('test_') and name not in vars(HTTPConcurrency): setattr(HTTPConcurrency, name, None)
del LibraryBoot
if __name__ == '__main__': unittest.main()
