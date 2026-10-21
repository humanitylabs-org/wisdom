"""Real HTTP fake-router tests: transport, admission, no broker fallback."""
import contextlib
import io
import json
import os
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import model_router as r
import discussions as d
from qa.test_discussions import Discussions


class RouterTransport(unittest.TestCase):
    def setUp(self):
        self.status, self.events, self.received = 200, [], []
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args): pass
            def do_POST(self):
                owner.received.append((self.path, dict(self.headers), json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                self.send_response(owner.status)
                self.send_header('Content-Type', 'text/event-stream' if owner.status == 200 else 'application/json')
                self.end_headers()
                if owner.status != 200:
                    self.wfile.write(json.dumps({'code': 'needs_owner', 'fix_url': r.FIX}).encode())
                else:
                    for event in owner.events:
                        self.wfile.write(('data: ' + json.dumps(event) + '\n\n').encode())
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.env = patch.dict(os.environ, {'WISDOM_ROUTER_URL': 'http://127.0.0.1:' + str(self.server.server_port), 'WISDOM_ROUTER_GRANT': 'synthetic-grant'})
        self.env.start()
        self.payload = {'system': 'Only this text.', 'quote': 'map', 'sources': [], 'source_links_not_read': [], 'messages': [{'role':'user','content':'Explain'}], 'web_enabled': False}

    def tearDown(self):
        self.env.stop()
        self.server.shutdown()
        self.server.server_close()

    def done(self, model=r.PINS['ask-ai'], chosen='match'):
        return {'type':'done','model':model,'tested_on':r.PINS['ask-ai'],'chosen':chosen,'provider':'claude','tier':'standard','usage':{}}

    def test_match_and_exact_request_contract(self):
        self.events = [{'type':'delta','text':'A map represents reality.'}, self.done()]
        with r.request('ask-ai', self.payload, 2) as response:
            events = [json.loads(x) for x in response]
        self.assertEqual(events[-1]['model'], r.PINS['ask-ai'])
        path, headers, body = self.received[0]
        self.assertEqual(path, '/v1/models/ask-ai/run')
        self.assertEqual(headers['X-Wizard-Grant'], 'synthetic-grant')
        self.assertEqual(set(body), {'system','messages','max_tokens','stream','abilities'})
        self.assertNotIn('model', body)
        self.assertNotIn('web_search', body['abilities'])

    def test_needs_owner(self):
        self.status = 409
        with self.assertRaises(r.Fault) as caught:
            r.request('ask-ai', self.payload, 2)
        self.assertEqual(caught.exception.code, 'needs_owner')
        self.assertEqual(str(caught.exception), 'Connect a model to use Ask AI')

    def test_wrong_effective_model_and_missing_done(self):
        for events in [[self.done('wrong')], [{'type':'delta','text':'unverified'}]]:
            self.events = events
            with self.assertRaises(r.Fault), r.request('ask-ai', self.payload, 2) as response:
                list(response)

    def test_explicit_swap(self):
        self.events = [self.done('replacement', 'owner-swap')]
        with r.request('ask-ai', self.payload, 2) as response:
            self.assertEqual(json.loads(list(response)[0])['model'], 'replacement')

    def test_down_is_clean(self):
        with patch.dict(os.environ, {'WISDOM_ROUTER_URL':'http://127.0.0.1:1'}), self.assertRaises(r.Fault) as caught:
            r.request('ask-ai', self.payload, 1)
        self.assertNotIn('127.0.0.1', str(caught.exception))

    def test_missing_grant_fails_closed(self):
        with patch.dict(os.environ, {'WISDOM_ROUTER_GRANT':''}), self.assertRaises(r.Fault):
            r.request('ask-ai', self.payload, 1)
        self.assertEqual(self.received, [])


class DiscussionRouter(Discussions):
    def test_router_failure_discards_provisional_and_preserves_question(self):
        t = self.create()
        with patch.object(threading.Thread, 'start'):
            out = d.submit(t['id'], {'question':'Explain','request_id':'router_0001','web_enabled':False})
        uid = out['messages'][-1]['id']
        with d.connection() as c:
            c.execute('UPDATE wisdom_discussion_messages SET content=? WHERE id=?', ('unverified',uid))
        with patch.dict(os.environ, {'WISDOM_ROUTER_URL':'http://router'}), patch.object(r, 'request', side_effect=r.Fault('needs_owner')), patch.object(d,'broker_request') as broker:
            d.generate(t['id'], uid, d.ACTIVE[uid])
            broker.assert_not_called()
        with d.connection() as c:
            result = d.get(c, t['id'])
        self.assertEqual(result['messages'][-1]['content'], '')
        self.assertEqual(result['messages'][-1]['error_code'], 'needs_owner')
        self.assertEqual(result['messages'][0]['content'], 'Explain')

    def test_router_completion_provenance_persists(self):
        for chosen, model in [('match',d.MODEL),('owner-swap','approved-model')]:
            t = self.create()
            with patch.dict(os.environ, {'WISDOM_ROUTER_URL':'http://router'}), patch.object(threading.Thread, 'start'):
                out = d.submit(t['id'], {'question':'Explain','request_id':'proof_'+chosen,'web_enabled':False})
            uid = out['messages'][-1]['id']
            done={'type':'done','text':'The selected passage means this.','model':model,'provider':'claude','tested_on':d.MODEL,'chosen':chosen,'tier':'standard','usage':{'output_tokens':6}}
            with patch.dict(os.environ, {'WISDOM_ROUTER_URL':'http://router'}), patch.object(r,'request',return_value=io.BytesIO((json.dumps(done)+'\n').encode())), patch.object(d,'broker_request') as broker:
                d.generate(t['id'],uid,d.ACTIVE[uid])
                broker.assert_not_called()
            with d.connection() as c:
                message=d.get(c,t['id'])['messages'][-1]
            self.assertEqual(message['state'],'complete')
            self.assertEqual(message['model'],model)
            self.assertEqual(message['chosen'],chosen)
            self.assertEqual(message['tested_on'],d.MODEL)

    def test_router_stop_keeps_fence_until_worker_finishes(self):
        t=self.create()
        with patch.dict(os.environ,{'WISDOM_ROUTER_URL':'http://router'}), patch.object(threading.Thread,'start'):
            out=d.submit(t['id'],{'question':'Explain','request_id':'stop_router','web_enabled':False})
            uid=out['messages'][-1]['id']
            stopped=d.stop(t['id'])
            self.assertTrue(stopped['active'])
            self.assertEqual(stopped['messages'][-1]['content'],'')
            with self.assertRaises(ValueError):d.submit(t['id'],{'question':'Another','request_id':'stop_retry','web_enabled':False})
            d.generate(t['id'],uid,d.ACTIVE[uid])
        with d.connection() as c:
            self.assertEqual(d.get(c,t['id'])['messages'][-1]['state'],'stopped')

    def test_router_unset_uses_broker(self):
        with patch.dict(os.environ, {'WISDOM_ROUTER_URL':''}):
            self.test_stream_and_verified_source_persist()
