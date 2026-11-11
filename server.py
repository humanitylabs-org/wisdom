#!/usr/bin/env python3
"""Wisdom: a private space for deep reading. Collections and episodes.

Standalone app (split out of Wizard Signal). Serves /wisdom/ on loopback behind
the private gateway. No feeds, no collectors, no paid calls."""
import json, mimetypes, os, re, secrets, sqlite3, sys, time, uuid
import urllib.error, urllib.request
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
import contextlib
import wisdom
import discussions, library, mcp_api, lookup

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('WISDOM_DATA', '/data'))
BASE = os.environ.get('WISDOM_BASE', '/wisdom')
PORT = int(os.environ.get('WISDOM_PORT', '9200'))
# The private route adapter rewrites the browser Origin to the legacy apps origin.
ORIGINS = set(filter(None, os.environ.get('WISDOM_ORIGINS', '').split(',')))
HOSTS = {urlsplit(o).netloc for o in ORIGINS}
STATIC = {'sw.js', 'offline-sw.js', 'offline-kit.js', 'offline.js', 'discussions.js', 'discussions.css', 'index.html', 'app.js', 'wisdom.js', 'base.css', 'wisdom.css', 'collections.css', 'app.css',
          'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'manage.js', 'manage.css',
          'wizard-appearance.js', 'wizard-appearance.css', 'wizard-tokens.css', 'wizard-ui.css', 'wizard-sheet.js'}
# Collection requests are built by a real Wizard agent run, admitted exactly like Wizard's own client does
# (wizard-os-home live.js send()): create a wizard-mobile session, then start a run in it.
# WISDOM_ADMIT=stub fakes admission (tests/QA never spawn builds); WISDOM_ADMIT=fail simulates an outage.
WIZARD_ORIGIN = os.environ.get('WISDOM_WIZARD_ORIGIN', '')
ADMIT = os.environ.get('WISDOM_ADMIT', 'disabled')



class AdmissionError(Exception):
    pass


def request_input(text):
    import authoring_contract
    return authoring_contract.request_input(text)


def _wizard(method, path, body, headers=None, timeout=10):
    req = urllib.request.Request(WIZARD_ORIGIN + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise AdmissionError('Agent Service response exceeded the bounded route receipt')
    except urllib.error.HTTPError as e:
        raise AdmissionError(f'Wizard answered HTTP {e.code} on {path.rsplit("/", 1)[-1]}') from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise AdmissionError(f'Wizard could not be reached ({getattr(e, "reason", e)})') from e
    try:
        value = json.loads(raw or b'{}')
        if not isinstance(value, dict):
            raise AdmissionError('Agent Service returned no route receipt object')
        return value
    except ValueError:
        return {}


def verify_runtime(run, confirmed=False):
    import authoring_contract
    route = authoring_contract.contract()
    meta = run.get('runtime')
    if not isinstance(meta, dict) or meta.get('model') != route['model'] or meta.get('provider') != route['provider'] or meta.get('model_lock') not in (('confirmed',) if confirmed else ('accepted', 'confirmed')):
        raise AdmissionError('Pinned author route was not verified by Agent Service; no fallback. Reconcile this run before retrying.')
    return meta


def admit(text, mode=None, seq=None):
    """Explicit pinned run; unknown acknowledgement blocks automatic replay."""
    import authoring_contract
    mode = mode or ADMIT
    sid = f'wizard_{int(time.time() * 1000)}_{secrets.token_hex(6)}'
    if mode == 'stub':
        return 'stub_' + sid, 'stub_run'
    if mode == 'fail':
        raise AdmissionError('Wizard could not be reached (stubbed outage)')
    if mode != 'live' or not WIZARD_ORIGIN:
        raise AdmissionError('Collection generation is not configured. Your request stays saved; configure the pinned anthropic / claude-opus-5-5 route. No fallback author is permitted.')
    route = authoring_contract.contract()
    payload = {'session_id': sid, 'input': request_input(text), 'provider': route['provider'],
               'model': route['model'], 'require_model_lock': True}
    if seq is None:
        raise AdmissionError('Durable request identity required')
    with library.LOCK, db() as c:
        if c.execute('SELECT 1 FROM wisdom_request_routes WHERE seq=?', (seq,)).fetchone():
            raise AdmissionError('Previous pinned admission exists; reconcile its exact run, do not launch a duplicate')
        c.execute('INSERT INTO wisdom_request_routes(seq,session_id,payload) VALUES (?,?,?)', (seq, sid, json.dumps(payload)))
    _wizard('POST', '/wizard/hermes/api/sessions', {'source': 'wizard-mobile', 'id': sid,
            'model': route['model'], 'provider': route['provider'], 'require_model_lock': True})
    run = _wizard('POST', '/wizard/hermes/v1/runs', payload,
                  {'Idempotency-Key': 'wisdom-author-' + sid}, timeout=20)
    with library.LOCK, db() as c:
        c.execute('UPDATE wisdom_request_routes SET response=? WHERE seq=?', (json.dumps(run), seq))
    verify_runtime(run)
    rid = run.get('run_id') or run.get('id')
    if not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', rid):
        raise AdmissionError('Pinned admission did not return a valid run identity')
    return sid, rid


def open_discussion_thread(ident):
    """Ask AI as the owner's real Wizard Chats thread: create (once) and return it with its first-turn item."""
    if ADMIT != 'live' or not WIZARD_ORIGIN:
        raise AdmissionError('Wizard Chats is not connected to Wisdom on this install.')
    agent = discussions.THREAD_AGENT
    from urllib.parse import urlencode
    suffix = '?' + urlencode({'agent': agent}) if agent else ''
    def lookup(sid, query=''):
        try:
            result = _wizard('GET', '/wizard/hermes/api/sessions/' + sid + query, None).get('session') or {}
            if result.get('id') not in (None, sid):
                raise AdmissionError('Wizard returned a different thread')
            return result
        except AdmissionError as e:
            if 'HTTP 404' not in str(e):
                raise
            return None
    # Serialize bind/migrate/admit. Persist identities BEFORE network writes, including a lost response.
    with library.LOCK, discussions.LOCK, db() as c:
        sid = discussions.session_of(c, ident)
        route = c.execute('SELECT * FROM wisdom_discussion_chats WHERE thread_id=?', (ident,)).fetchone()
        title = discussions.thread_title(c, ident)
        if not route:
            session = lookup(sid, suffix) if sid else None
            orphan = None
            if sid and session is None:
                old = lookup(sid)
                if old is not None:
                    if int(old.get('message_count') or 0) != 0:
                        raise AdmissionError('This earlier Chats thread has messages; it must be preserved and reconciled before moving agents.')
                    orphan, sid = sid, None
            sid = sid or f'wizard_{int(time.time() * 1000)}_{secrets.token_hex(6)}'
            c.execute('UPDATE wisdom_discussions SET session_id=? WHERE id=?', (sid, ident))
            c.execute('INSERT INTO wisdom_discussion_chats(thread_id,session_id,agent,orphan_session_id) VALUES(?,?,?,?)',
                      (ident, sid, agent, orphan))
            c.commit()
        route = c.execute('SELECT * FROM wisdom_discussion_chats WHERE thread_id=?', (ident,)).fetchone()
        sid = route['session_id']
        agent = route['agent'] or ''
        suffix = '?' + urlencode({'agent': agent}) if agent else ''
        model = {k: v for k, v in {'model': discussions.THREAD_MODEL, 'provider': discussions.THREAD_PROVIDER}.items() if v}
        session = lookup(sid, suffix)
        if session is None:
            # Same id on every retry; never create another session after an uncertain create.
            session = _wizard('POST', '/wizard/hermes/api/sessions' + suffix,
                              {'source': 'wizard-mobile', 'id': sid, 'title': title,
                                                             **({'agent': agent} if agent else {}), **model}).get('session') or {}
            if session.get('id') not in (None, sid):
                raise AdmissionError('Wizard returned a different thread')
        if route['orphan_session_id'] and not route['orphan_archived']:
            old = lookup(route['orphan_session_id'])
            if old is not None:
                if int(old.get('message_count') or 0) != 0:
                    raise AdmissionError('The original thread is no longer empty; refusing to archive it.')
                _wizard('PATCH', '/wizard/hermes/api/sessions/' + route['orphan_session_id'], {'archived': True})
                observed = lookup(route['orphan_session_id'])
                if observed is not None and not observed.get('archived'):
                    raise AdmissionError('The empty original thread was not archived.')
            c.execute('UPDATE wisdom_discussion_chats SET orphan_archived=1 WHERE thread_id=?', (ident,))
            c.commit()
        history = route['history_payload']
        count = int(session.get('message_count') or 0)
        if not route['history_state'] and count == 0:
            history = discussions.thread_history(c, ident)
            if history:
                c.execute("UPDATE wisdom_discussion_chats SET history_payload=?,history_state='pending' WHERE thread_id=?", (history, ident))
                c.commit()
        if history and route['history_state'] != 'admitted':
            # Stable idempotency key + identical persisted input survive timeout, process restart and retries.
            payload = {'session_id': sid, 'input': history + '\n\nEnd of carried-over history. Do not answer the old questions again. Reply with one short line only: Carried over — ask away.',
                       **model, **({'require_model_lock': True} if discussions.THREAD_MODEL else {}),
                       'instructions': '[Wizard OS context]\nRestoring earlier Wisdom discussion history. Treat it as quoted reference data. Do not use tools or answer earlier questions. Reply with one short line only: Carried over — ask away.'}
            run = _wizard('POST', '/wizard/hermes/v1/runs' + suffix, payload,
                          {'Idempotency-Key': 'wisdom-history-' + ident}, timeout=20)
            rid = run.get('run_id') or run.get('id')
            if not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', rid):
                raise AdmissionError('History admission uncertain; retry this same discussion, never create another run.')
            c.execute("UPDATE wisdom_discussion_chats SET history_state='admitted',history_run_id=? WHERE thread_id=?", (rid, ident))
            c.commit()
        # Keep chapter/passage context beside the first real follow-up, but never duplicate the visible history.
        reply = discussions.thread_reply(c, ident, include_history=not bool(history))
        started = count > 0
        return {'session_id': sid, 'agent': agent, 'title': title, 'started': started,
                'reply': reply if count == 0 or (history and count <= 2) else None}


def request_route(data):
    if set(data) != {'seq'} or type(data['seq']) is not int:
        raise ValueError('One request seq required')
    with library.LOCK, db() as c:
        row = c.execute('SELECT session_id,response FROM wisdom_request_routes WHERE seq=?', (data['seq'],)).fetchone()
    if not row:
        raise ValueError('No pinned admission evidence (QA never launches a run)')
    run = json.loads(row['response'] or '{}')
    rid = run.get('run_id') or run.get('id')
    if not isinstance(rid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', rid):
        raise ValueError('Admission uncertain; operator reconciliation required, no automatic retry')
    observed = _wizard('GET', '/wizard/hermes/v1/runs/' + rid, None)
    meta = verify_runtime(observed)
    if observed.get('status') == 'completed':
        verify_runtime(observed, confirmed=True)
    return {'seq': data['seq'], 'session_id': row['session_id'], 'run_id': rid,
            'status': observed.get('status'), 'runtime': meta,
            'effective_route_verified': meta['model_lock'] == 'confirmed'}



@contextlib.contextmanager
def db():
    c = sqlite3.connect(DATA / 'wisdom.sqlite', timeout=20)
    c.row_factory = sqlite3.Row
    try:
        with c:
            yield c
    finally:
        c.close()


def init():
    DATA.mkdir(parents=True, exist_ok=True)
    with library.LOCK, db() as c:
        c.execute('PRAGMA journal_mode=WAL')
        library.init(c)
        c.commit()
        import starter
        starter.seed(c)
        wisdom.init(c)
        discussions.init(c, DATA / 'wisdom.sqlite')


def submit_request(data):
    # New request {text} (optionally qa:true, never admitted), or a retry {seq} of a saved one.
    if set(data) <= {'seq'} and type(data.get('seq')) is int:
        with library.LOCK, db() as c:
            req = wisdom.get_request(c, data['seq'])
        if req['status'] == 'building':
            with library.LOCK, db() as c:
                return 200, {'sent': True, 'request': req, 'requests': wisdom.requests(c)}
    elif set(data) <= {'text', 'qa'} and data.get('qa', False) in (True, False):
        text = wisdom.request_text(data)
        with library.LOCK, db() as c:  # durable before any hand-off is attempted
            seq = wisdom.add_request(c, text, qa=bool(data.get('qa')))
            req = wisdom.get_request(c, seq)
    else:
        raise ValueError('Send {text} or {seq}')
    try:
        sid, run = admit(req['text'], 'stub' if req['status'] == 'qa' else None, seq=req['seq'])
    except AdmissionError as e:
        with library.LOCK, db() as c:
            req = wisdom.mark_request(c, req['seq'], error=str(e))
            return 502, {'sent': False, 'saved': True, 'error': str(e), 'request': req, 'requests': wisdom.requests(c)}
    with library.LOCK, db() as c:
        req = wisdom.mark_request(c, req['seq'], session_id=sid, run_id=run)
        return 200, {'sent': True, 'request': req, 'requests': wisdom.requests(c)}

class Handler(BaseHTTPRequestHandler):
    server_version = 'Wisdom'

    def log_message(self, fmt, *args):
        pass

    def send(self, code, data, ctype='application/json', headers=None):
        raw = json.dumps(data).encode() if ctype == 'application/json' else data
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(raw)))
        # One Cache-Control only: a caller's own (art, fonts) replaces the default instead of adding to it, since a
        # browser that sees both obeys no-store and re-downloads every picture on every visit.
        if not any(k.lower() == 'cache-control' for k in (headers or {})):
            self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Robots-Tag', 'noindex, nofollow')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def route(self):
        path = urlsplit(self.path).path
        if path == BASE:
            return ''
        if path.startswith(BASE + '/'):
            return path[len(BASE):]
        return path

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.host_ok()[0]:
            return self.send(421, {'error': 'Unknown host. Open Wisdom through your Wizard.'})
        path = self.route()
        if path == '':
            return self.send(308, b'', 'text/plain', {'Location': BASE + '/'})
        if path == '/openapi.json':
            return self.send(200, json.loads((ROOT/'openapi.json').read_text()))
        if path in ('/api/health', '/healthz'):
            try:
                with library.LOCK, db() as c:
                    c.execute('SELECT count(*) FROM wisdom_bundles').fetchone()
                return self.send(200, {'ok': True, 'app': 'wisdom', 'storage': 'ready'})
            except sqlite3.Error:
                return self.send(503, {'ok': False, 'app': 'wisdom', 'error': 'Wisdom storage is unavailable. Check the app-data mount and permissions; do not reset the library.'})
        if path == '/api/authoring/contract':
            import authoring_toolkit
            try:
                return self.send(200, authoring_toolkit.describe())
            except (ValueError, OSError):
                return self.send(503, {'error': 'Installed author toolkit unavailable; no fallback'})
        if path == '/api/library':
            with library.LOCK, db() as c:
                return self.send(200, {'bundles': library.list_bundles(c), 'source': library.source()})
        if path == '/mcp':
            return self.send(405, {'error': 'Use POST for stateless MCP'})
        if path == '/api/wisdom/metadata':
            with db() as c:
                return self.send(200, wisdom.state(c, metadata=True))
        match = re.fullmatch(r'/api/wisdom/chapter/([a-z0-9-]{1,64})', path)
        if match:
            with db() as c:
                try:
                    return self.send(200, wisdom.chapter(c, match[1]))
                except (ValueError, OSError):
                    return self.send(404, {'error': 'Chapter unavailable; reopen your library'})
        if path == '/api/wisdom':
            with library.LOCK, db() as c:
                return self.send(200, wisdom.state(c))
        if path == '/api/discussions' or re.fullmatch(r'/api/discussions/[a-f0-9]{32}', path):
            with db() as c:
                c.row_factory = sqlite3.Row
                try:
                    out = discussions.listing(c) if path == '/api/discussions' else discussions.get(c, path.rsplit('/', 1)[1])
                    return self.send(200, out)
                except ValueError as e:
                    return self.send(404, {'error': str(e)})
        if path == '/api/wisdom/dives':
            with library.LOCK, db() as c:
                return self.send(200, {'dives': wisdom.dives(c)})
        if path.startswith('/wisdom-art/'):
            m = re.fullmatch(r'/wisdom-art/(p|c|f)/([a-z0-9-]{1,64})\.(jpg|woff2)', path)
            if not m:
                return self.send(404, {'error': 'Not found'})
            if m[1] in ('p', 'c') and m[3] == 'jpg':
                with library.LOCK, db() as c:
                    raw = library.art(c, m[1], m[2])
                if raw is not None:
                    return self.send(200, raw, 'image/jpeg', {'Cache-Control': 'private, max-age=86400'})
                return self.send(404, {'error': 'Not found'})
            file = ROOT / 'static/wisdom-art' / m[1] / f'{m[2]}.{m[3]}'
            if not file.is_file():
                return self.send(404, {'error': 'Not found'})
            return self.send(200, file.read_bytes(), 'font/woff2' if m[3] == 'woff2' else 'image/jpeg',
                             {'Cache-Control': 'private, max-age=86400'})
        name = 'index.html' if path == '/' else path.lstrip('/')
        if name not in STATIC:
            return self.send(404, {'error': 'Not found'})
        file = ROOT / 'static' / name
        if not file.exists():
            return self.send(404, {'error': 'Not found'})
        typ = 'application/manifest+json' if name.endswith('.webmanifest') else (mimetypes.guess_type(file)[0] or 'application/octet-stream')
        return self.send(200, file.read_bytes(), typ)

    def host_ok(self):
        """DNS-rebinding guard for reads and writes: the Host must be a configured Wizard origin host,
        or box-local (loopback on any published port, or the container's service name)."""
        host = self.headers.get('Host', '')
        name = host.split(']')[0] + ']' if host.startswith('[') else host.rsplit(':', 1)[0]
        local = name in {'127.0.0.1', 'localhost', '[::1]', 'wisdom'}
        return host in HOSTS or local, local, host

    def allowed_write(self):
        ok, local, host = self.host_ok()
        origin = self.headers.get('Origin')
        allowed = ORIGINS | ({f'http://{host}'} if local else set())
        return ok and (not origin or origin in allowed) and self.headers.get('Sec-Fetch-Site') != 'cross-site'

    def offline_mutation(self, c, path, data, fn):
        """Idempotency receipt and edit commit together; replay after a lost reply is safe.

        Lazy schema: a read-only launch/update never changes owner state.
        Receipts store only a payload digest and highlight id, not another library copy.
        """
        key = self.headers.get('X-Wizard-Offline-Id')
        if not key:
            return fn(c, data)
        if not re.fullmatch(r'[a-f0-9-]{36}', key):
            raise ValueError('Invalid offline operation id')
        import hashlib
        digest = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        c.execute('CREATE TABLE IF NOT EXISTS wisdom_offline_receipts (id TEXT PRIMARY KEY, path TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL)')
        old = c.execute('SELECT path,digest,result FROM wisdom_offline_receipts WHERE id=?', (key,)).fetchone()
        if old:
            if old[0] != path or old[1] != digest:
                raise ValueError('Offline operation id already used for a different change')
            if path.endswith('/reaction'):
                return wisdom.state(c)
            return dict(json.loads(old[2]), highlights=wisdom.highlights(c))
        # _highlight relies on the same library.LOCK held by do_POST, without
        # the convenience wrapper's inner commit splitting edit from receipt.
        result = wisdom._highlight(c, data) if path.endswith('/highlight') else fn(c, data)
        receipt = {k: v for k, v in result.items() if k in ('id', 'removed', 'merged')}
        c.execute('INSERT INTO wisdom_offline_receipts VALUES (?,?,?,?)', (key, path, digest, json.dumps(receipt)))
        return result

    def do_POST(self):
        if not self.allowed_write():
            return self.send(403, {'error': 'Origin not allowed'})
        ctype = self.headers.get('Content-Type', '').split(';')[0].strip().lower()
        if self.route() == '/api/library/stage':
            if ctype != 'application/zip':
                return self.send(415, {'error': 'ZIP document bundle required'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= library.MAX:
                    raise ValueError('Bundle too large or empty')
                with library.LOCK, db() as c:
                    out = library.stage(c, self.rfile.read(length))
                return self.send(200, out)
            except (ValueError, OSError) as e:
                return self.send(400, {'error': str(e)})
        if ctype != 'application/json':
            return self.send(415, {'error': 'JSON required'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= (library.MAX * 2 if self.route() in ('/mcp', '/api/library/revision/preview') else 65536 if self.route().startswith('/api/discussions') else 16384):
                raise ValueError('Invalid request size')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('JSON object required')
            path = self.route()
            if path == '/api/lookup':
                try:
                    return self.send(200, lookup.explain(data))
                except lookup.Unavailable:
                    return self.send(503, {'error': lookup.UNAVAILABLE})
            if path == '/api/lookup/stream':
                return self.lookup_stream(data)
            if path == '/api/discussions':
                with library.LOCK, discussions.LOCK, db() as c:
                    c.row_factory = sqlite3.Row
                    return self.send(200, discussions.create(c, data))
            discussion_thread = re.fullmatch(r'/api/discussions/([a-f0-9]{32})/thread', path)
            if discussion_thread:
                if data:
                    raise ValueError('Opening a discussion thread takes no fields')
                try:
                    return self.send(200, open_discussion_thread(discussion_thread.group(1)))
                except AdmissionError as e:
                    return self.send(503, {'error': str(e)})
            discussion_action = re.fullmatch(r'/api/discussions/([a-f0-9]{32})/(ask|stop)', path)
            if discussion_action:
                ident, action = discussion_action.groups()
                return self.send(200, discussions.submit(ident, data) if action == 'ask' else discussions.stop(ident))
            if path == '/mcp':
                code, out = mcp_api.dispatch(data)
                return self.send(code, out)
            if path == '/api/authoring/toolkit':
                import authoring_toolkit
                return self.send(200, authoring_toolkit.download(data))
            if path in ('/api/library/revision/preview', '/api/library/revision/apply'):
                import collection_revision
                with library.LOCK, db() as c:
                    out = collection_revision.preview(c, data) if path.endswith('/preview') else collection_revision.apply(c, data)
                return self.send(200, out)
            if path == '/api/wisdom/request/route':
                return self.send(200, request_route(data))
            if path in ('/api/library/export/preview', '/api/library/export'):
                import collection_export
                with library.LOCK, db() as c:
                    if path.endswith('/preview'):
                        return self.send(200, collection_export.preview(c, data))
                    details, raw = collection_export.download(c, data)
                return self.send(200, raw, 'application/zip',
                    {'Content-Disposition': 'attachment; filename="' + details['id'] + '.zip"',
                     'X-Content-SHA256': details['sha256']})
            if path in ('/api/library/action', '/api/library/source'):
                with library.LOCK, db() as c:
                    if path.endswith('/source'):
                        if set(data) != {'id'}:
                            raise ValueError('One source id required')
                        out = library.import_source(c, data['id'])
                    else:
                        out = library.action(c, data)
                    wisdom.init(c)
                return self.send(200, out)
            if path == '/api/wisdom/reaction':
                with library.LOCK, db() as c:
                    result = self.offline_mutation(c, path, data, wisdom.react)
                    c.commit()
                    return self.send(200, result)
            if path == '/api/wisdom/highlight':
                with library.LOCK, db() as c:
                    result = self.offline_mutation(c, path, data, wisdom.highlight)
                    c.commit()  # A successful response must already be durable.
                    return self.send(200, result)
            if path == '/api/wisdom/request':
                return self.request_post(data)
            return self.send(404, {'error': 'Not found'})
        except OSError:
            return self.send(400, {'error': 'Collection files unavailable; no export or library change completed'})
        except (ValueError, TypeError, AdmissionError, json.JSONDecodeError) as e:
            return self.send(400, {'error': str(e)})

    def lookup_stream(self, data):
        """NDJSON: provisional {type:'delta',text}…, then exactly one done or error line."""
        events = lookup.run(data)
        try:
            first = next(events)  # Input errors still get a plain 400 before streaming.
        except lookup.Unavailable:
            return self.send(503, {'error': lookup.UNAVAILABLE})
        except StopIteration:
            return self.send(503, {'error': lookup.UNAVAILABLE})
        self.close_connection = True
        self.send_response(200)
        for k, v in (('Content-Type', 'application/x-ndjson'), ('Cache-Control', 'no-store'),
                     ('X-Content-Type-Options', 'nosniff'), ('X-Robots-Tag', 'noindex, nofollow'),
                     ('X-Accel-Buffering', 'no'), ('Connection', 'close'),
                     ('Referrer-Policy', 'strict-origin-when-cross-origin'),
                     ('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'")):
            self.send_header(k, v)
        self.end_headers()
        def line(value):
            self.wfile.write(json.dumps(value, ensure_ascii=False).encode() + b'\n')
            self.wfile.flush()
        try:
            item = first
            while True:
                kind, value = item
                line({'type': 'delta', 'text': value} if kind == 'delta' else {'type': 'done', **value})
                if kind == 'done':
                    break
                item = next(events)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Reader closed the popover; closing the generator cancels inference.
        except (lookup.Unavailable, StopIteration):
            self.stream_error(line, 503, lookup.UNAVAILABLE)
        except (ValueError, TypeError) as e:
            self.stream_error(line, 400, str(e))
        finally:
            events.close()

    @staticmethod
    def stream_error(line, status, message):
        try:
            line({'type': 'error', 'status': status, 'error': message})
        except OSError:
            pass

    def request_post(self, data):
        code, out = submit_request(data)
        return self.send(code, out)



def main():
    init()
    ThreadingHTTPServer(('0.0.0.0' if os.environ.get('WISDOM_CONTAINER') == '1' else '127.0.0.1', PORT), Handler).serve_forever()

# ---- wizard.app-switches/1 ------------------------------------------------------------------------------------------
# Owner feature switches for the Tracker's Try it (wizard-os docs/APP_SWITCHES.md). Shared block: the same text ships in
# every Wizard app (template: wizard-app-manager templates/hello-wizard). Every new feature ships behind a switch, off by
# default: append it to SWITCHES with the issue it delivers, e.g.
#   {'id': 'compact-header', 'name': 'Compact top bar', 'description': '...', 'default': False,
#    'issues': ['humanitylabs-org/<repo>#20']}
# and gate the feature on switch_on('compact-header'). State lives on the box (DATA_DIR/switches.json), so the app's
# page, the Tracker (through the App Manager) and the agent see one state. GET/POST /api/switches, owner only: the
# box's Tailscale Serve owner login with X-Wizard-Switch: 1; never a bearer, agent grant or box-local host.
import json as _sw_json
import os as _sw_os
import re as _sw_re
import threading as _sw_threading
from pathlib import Path as _SwPath
from urllib.parse import urlsplit as _sw_urlsplit

SWITCHES = []
_SW_CONTRACT = 'wizard.app-switches/1'
_SW_ROUTE = _sw_re.compile(r'(?:/[a-z0-9][a-z0-9-]{0,62})?/api/switches/?')
_SW_LOCAL = {'localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'}
_sw_lock = _sw_threading.Lock()


def _sw_file():
    return _SwPath(_sw_os.environ.get('WIZARD_SWITCHES_DIR') or _sw_os.environ.get('DATA_DIR') or '/data') / 'switches.json'


def _sw_saved():
    try:
        saved = _sw_json.loads(_sw_file().read_text())
    except (OSError, ValueError):
        return {}
    return saved if isinstance(saved, dict) else {}


def switches_doc():
    saved = _sw_saved()
    return {'contract': _SW_CONTRACT, 'switches': [
        dict(s, on=saved[s['id']] if isinstance(saved.get(s['id']), bool) else bool(s.get('default'))) for s in SWITCHES]}


def switch_on(switch_id):
    return next((s['on'] for s in switches_doc()['switches'] if s['id'] == switch_id), False)


def _sw_set(switch_id, on):
    with _sw_lock:
        ids = {s['id'] for s in SWITCHES}
        saved = {k: v for k, v in _sw_saved().items() if k in ids and isinstance(v, bool)}
        saved[switch_id] = on
        f = _sw_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_name(f.name + '.tmp')
        tmp.write_text(_sw_json.dumps(saved))
        _sw_os.replace(tmp, f)
    return switches_doc()


def _sw_owner(h, write):
    hd = h.headers
    if hd.get('Authorization') or hd.get('X-Wizard-Switch') != '1':
        return False
    if (hd.get('Sec-Fetch-Site') or 'same-origin').lower() not in ('same-origin', 'none'):
        return False
    host = (hd.get('Host') or '').strip().lower()
    name = host.split(']')[0] + ']' if host.startswith('[') else host.rsplit(':', 1)[0]
    if not name or name in _SW_LOCAL or '.' not in name:      # box-local and container hosts never prove the owner
        return False
    origin = hd.get('Origin')
    trusted = {o.strip() for o in (_sw_os.environ.get('WIZARD_TRUSTED_ORIGINS') or '').split(',') if o.strip()}
    if origin and _sw_urlsplit(origin).netloc.lower() != host and origin not in trusted:
        return False
    if write and not origin:
        return False
    logins = [x.strip() for x in (hd.get_all('Tailscale-User-Login') or [])]
    owners = {x.strip().lower() for x in (_sw_os.environ.get('WIZARD_OWNER_LOGINS') or '').split(',') if x.strip()}
    return len(logins) == 1 and '@' in logins[0] and (not owners or logins[0].lower() in owners)


def _sw_send(h, code, doc):
    body = _sw_json.dumps(doc).encode()
    h.send_response(code)
    h.send_header('Content-Type', 'application/json')
    h.send_header('Cache-Control', 'no-store')
    h.send_header('Content-Length', str(len(body)))
    h.end_headers()
    if h.command != 'HEAD':
        h.wfile.write(body)


def _sw_handle(h):
    """Serve /api/switches (or /<app>/api/switches) and return True; False for every other request."""
    if not _SW_ROUTE.fullmatch(_sw_urlsplit(h.path).path):
        return False
    if h.command in ('GET', 'HEAD'):
        if not _sw_owner(h, False):
            _sw_send(h, 403, {'error': "Only this Wizard's owner can see these switches.", 'code': 'owner_only'})
        else:
            _sw_send(h, 200, switches_doc())
        return True
    if not _sw_owner(h, True):
        _sw_send(h, 403, {'error': "Only this Wizard's owner can change these switches.", 'code': 'owner_only'})
        return True
    try:
        if (h.headers.get('Content-Type') or '').split(';')[0].strip() != 'application/json':
            raise ValueError
        size = int(h.headers.get('Content-Length') or '0')
        if size <= 0 or size > 4096:
            raise ValueError
        body = _sw_json.loads(h.rfile.read(size))
        if not isinstance(body, dict) or not isinstance(body.get('id'), str) or not isinstance(body.get('on'), bool) \
                or set(body) - {'id', 'on'}:
            raise ValueError
    except (ValueError, TypeError):
        _sw_send(h, 400, {'error': 'Send JSON {"id": "...", "on": true|false}', 'code': 'invalid_input'})
        return True
    if body['id'] not in {s['id'] for s in SWITCHES}:
        _sw_send(h, 404, {'error': 'No such switch', 'code': 'unknown_switch'})
        return True
    try:
        _sw_send(h, 200, _sw_set(body['id'], body['on']))
    except OSError:
        _sw_send(h, 500, {'error': 'storage_failure'})
    return True


def wizard_switches_install(handler_cls):
    """Route the switch endpoint ahead of the app's own GET/HEAD/POST handlers."""
    for method in ('do_GET', 'do_HEAD', 'do_POST'):
        orig = getattr(handler_cls, method, None)
        if getattr(orig, '_wizard_switches', False):
            continue

        def wrapped(self, _orig=orig):
            if _sw_handle(self):
                return None
            if _orig is None:
                return self.send_error(501)
            return _orig(self)
        wrapped._wizard_switches = True
        setattr(handler_cls, method, wrapped)
    return handler_cls
# ---- end wizard.app-switches/1 ---------------------------------------------------------------------------------------

wizard_switches_install(Handler)


if __name__ == '__main__':
    main()
