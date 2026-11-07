"""Offline acceptance only: private COPY of the live library/state, never owner mounts.
Real shared platform bytes; scoped /wisdom/; A/B shell switching is test-only.
"""
import json
import os
from pathlib import Path
import shutil
import signal
import tempfile
import threading


def main():
    seed=Path(os.environ['WISDOM_OFFLINE_SEED']).resolve()
    with tempfile.TemporaryDirectory(prefix='wisdom-offline-') as tmp:
        t=Path(tmp);app=t/'app';app.mkdir();shutil.copytree(Path(__file__).resolve().parents[1]/'static',app/'static')
        (app/'qa').mkdir();shutil.copy2(Path(__file__).with_name('offline-shared-shell.json'),app/'qa/offline-shared-shell.json')
        shutil.copytree(seed/'library',t/'library');(t/'data').mkdir();shutil.copy2(seed/'wisdom.sqlite',t/'data/wisdom.sqlite')
        os.environ.update(WISDOM_DATA=str(t/'data'),WISDOM_LIBRARY=str(t/'library'),WISDOM_BASE='/wisdom',WISDOM_ADMIT='disabled',WISDOM_SEED_STARTER='0')
        for name in ['WISDOM_WIZARD_ORIGIN','WISDOM_COLLECTION_SOURCE','WISDOM_ROUTER_URL','WISDOM_ROUTER_GRANT','WISDOM_DISCUSS_TOKEN']:os.environ.pop(name,None)
        import server
        from tools import offline_shell
        server.ROOT=app;offline_shell.ROOT=app
        script=app/'static/app.js';original=script.read_text()
        def build(marker):
            script.write_text(original+f'\nwindow.__offlineBuild={marker!r};\n')
            (app/'static/sw.js').write_text(offline_shell.worker())
        build('A');server.init()
        class Handler(server.Handler):
            def do_GET(self):
                if self.path.startswith('/wizard-os-home/core/'):
                    name=self.path.rsplit('/',1)[-1]
                    if name in ('app-client.js','app-identity.js'):return self.send(200,(seed/name).read_bytes(),'application/javascript')
                return super().do_GET()
            def do_POST(self):
                if self.path=='/__qa/build-b':build('B');return self.send(200,{'build':'B'})
                return super().do_POST()
        http=server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        threading.Thread(target=http.serve_forever,daemon=True).start()
        stop=threading.Event();signal.signal(signal.SIGTERM,lambda *_:stop.set());signal.signal(signal.SIGINT,lambda *_:stop.set())
        print(json.dumps({'url':f'http://127.0.0.1:{http.server_port}/wisdom/','disposable':str(t),'seed_copy':str(seed)}),flush=True)
        try:stop.wait()
        finally:http.shutdown();http.server_close()

if __name__=='__main__':main()
