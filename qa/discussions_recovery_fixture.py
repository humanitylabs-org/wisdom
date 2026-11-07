"""Disposable real-reader host for popup/recovery UI contract tests.

No inference credentials or owner library. Shared code is read unchanged from
WISDOM_QA_SHELL (a manifest-pinned copy of the installed shell's web directory).
The host is explicitly a proxy, not installed-shell acceptance.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import tempfile
import threading
from urllib.parse import urlsplit, unquote


def main():
    shell = Path(os.environ['WISDOM_QA_SHELL']).resolve()
    with tempfile.TemporaryDirectory(prefix='wisdom-popup-') as tmp:
        os.environ.update(WISDOM_DATA=tmp+'/data', WISDOM_LIBRARY=tmp+'/media',
                          WISDOM_SEED_STARTER='1', WISDOM_ADMIT='disabled', WISDOM_BASE='')
        for key in ('WISDOM_COLLECTION_SOURCE', 'WISDOM_WIZARD_ORIGIN', 'WISDOM_DISCUSS_URL', 'WISDOM_DISCUSS_TOKEN'):
            os.environ.pop(key, None)
        import library
        import server
        from qa.test_library_scope import multi_bundle
        server.init()
        with server.db() as c:
            bundle = library.stage(c, multi_bundle())
            library.action(c, {'id': bundle['id'], 'action': 'enable'})

        class Handler(server.Handler):
            def do_GET(self):
                path = unquote(urlsplit(self.path).path)
                if path.startswith('/wizard-os-home/'):
                    asset = (shell / path.removeprefix('/wizard-os-home/')).resolve()
                    if not asset.is_relative_to(shell) or not asset.is_file():
                        return self.send(404, b'', 'text/plain')
                    mime = {'.js':'application/javascript', '.css':'text/css', '.json':'application/json'}.get(asset.suffix, 'application/octet-stream')
                    return self.send(200, asset.read_bytes(), mime)
                if path == '/qa-host.css':
                    return self.send(200, b'html,body,.win{margin:0;width:100%;height:100%;overflow:hidden;background:var(--bg)}iframe{border:0;width:100%;height:100%;display:block}', 'text/css')
                if path == '/qa-registry.js':
                    return self.send(200, b"window.WizCore={apps:()=>({APPS:[{id:'wisdom-qa',url:'/index.html'}]})};", 'application/javascript')
                if path == '/qa-host':
                    return self.send(200, HOST.encode(), 'text/html; charset=utf-8')
                return super().do_GET()
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=http.serve_forever, daemon=True).start()
        stop = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        signal.signal(signal.SIGINT, lambda *_: stop.set())
        print(json.dumps({'url':'http://127.0.0.1:'+str(http.server_port)+'/', 'disposable':tmp,
                          'app_client_sha256':hashlib.sha256((shell/'core/app-client.js').read_bytes()).hexdigest(),
                          'app_services_sha256':hashlib.sha256((shell/'core/app-services.js').read_bytes()).hexdigest(),
                          'scope':'synthetic API + real reader + shared client/services/appearance host; proxy, not installed shell'}), flush=True)
        try:
            stop.wait()
        finally:
            http.shutdown()
            http.server_close()


HOST = '''<!doctype html><html data-skin="nebula"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="/wizard-os-home/core/skins.css">
<link rel="stylesheet" href="/qa-host.css">
<script src="/qa-registry.js"></script><script src="/wizard-os-home/core/appearance-host.js"></script>
<script src="/wizard-os-home/core/app-services.js"></script>
</head><body><div class="win"><iframe title="Wisdom test reader" src="/index.html"></iframe></div></body></html>'''

if __name__ == '__main__':
    main()
