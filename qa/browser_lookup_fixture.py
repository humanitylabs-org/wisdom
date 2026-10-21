"""Disposable Look up browser fixture: real server.py + lookup.py + a fake streaming broker.

Run as python -m qa.browser_lookup_fixture (WISDOM_QA_CORE=<shared app-client.js>).
The fake broker streams a compact answer in timed deltas so the browser can prove
progressive painting, and records /cancel calls at GET /qa/cancels. No model call.
"""
import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import signal
import tempfile
import threading
import time

ANSWER = ('Here the word names the specific idea the passage is discussing, read in its '
          'own context. It points at what the author means in this sentence.')
CANCELS, LOOKUPS = [], []


class FakeBroker(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/cancel':
            CANCELS.append(data['run_id'])
            raw = b'{"cancelled": true}'
            self.send_response(200); self.send_header('Content-Length', str(len(raw))); self.end_headers()
            return self.wfile.write(raw)
        assert self.path == '/lookup' and data['model'] == 'claude-haiku-4-5', (self.path, data.get('model'))
        LOOKUPS.append({'run_id': data['run_id'], 'quote': data['quote']})
        slow = 'slow' in os.environ.get('WISDOM_QA_PACE', '') or len(LOOKUPS) % 2 == 0
        self.send_response(200); self.send_header('Content-Type', 'application/x-ndjson'); self.end_headers()
        try:
            words = ANSWER.split(' ')
            for i in range(0, len(words), 3):
                time.sleep(.6 if slow else .15)
                piece = ' '.join(words[i:i+3]) + ' '
                self.wfile.write(json.dumps({'type': 'delta', 'text': piece}).encode() + b'\n'); self.wfile.flush()
            self.wfile.write(json.dumps({'type': 'done', 'text': ANSWER, 'model': 'claude-haiku-4-5'}).encode() + b'\n')
        except OSError:
            pass


def main():
    core = Path(os.environ['WISDOM_QA_CORE']).read_bytes()
    broker = ThreadingHTTPServer(('127.0.0.1', 0), FakeBroker)
    threading.Thread(target=broker.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='wisdom-lookup-') as tmp:
        os.environ.update(WISDOM_DATA=tmp+'/data', WISDOM_LIBRARY=tmp+'/media',
                          WISDOM_SEED_STARTER='1', WISDOM_ADMIT='disabled', WISDOM_BASE='',
                          WISDOM_DISCUSS_URL='http://127.0.0.1:%d' % broker.server_port,
                          WISDOM_DISCUSS_TOKEN='fixture')
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
                if self.path == '/qa/cancels':
                    return self.send(200, {'cancels': CANCELS, 'lookups': LOOKUPS})
                return super().do_GET()
        http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=http.serve_forever, daemon=True).start()
        stop = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        signal.signal(signal.SIGINT, lambda *_: stop.set())
        print(json.dumps({'url': 'http://127.0.0.1:'+str(http.server_port)+'/',
                          'core_sha256': hashlib.sha256(core).hexdigest()}), flush=True)
        try:
            stop.wait()
        finally:
            http.shutdown(); http.server_close(); broker.shutdown()


if __name__ == '__main__':
    main()
