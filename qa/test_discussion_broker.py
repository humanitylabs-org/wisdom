import importlib.util
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch


class BrokerCancellation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        env = {'WISDOM_AI_HOME': self.tmp.name, 'WISDOM_AI_TOKEN': 'fixture',
               'WISDOM_AI_CLI': '/fixture/claude', 'WISDOM_AI_CREDENTIALS': self.tmp.name+'/credential'}
        with patch.dict(os.environ, env):
            spec = importlib.util.spec_from_file_location('isolated_broker', Path(__file__).parents[1]/'tools/discussion_broker.py')
            assert spec is not None and spec.loader is not None
            self.b = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.b)

    def tearDown(self):
        self.tmp.cleanup()

    def test_cancel_before_registration_prevents_spawn(self):
        self.b.cancel_run('a'*32)
        with patch.object(self.b.subprocess, 'Popen') as spawn:
            self.assertIsNone(self.b.register_run('a'*32, [], {}))
            spawn.assert_not_called()

    def test_cancel_during_registration_kills_and_waits(self):
        entered, release, finished = threading.Event(), threading.Event(), threading.Event()
        child = Mock()
        def spawn(*args, **kwargs):
            entered.set()
            self.assertTrue(release.wait(3))
            return child
        with patch.object(self.b.subprocess, 'Popen', side_effect=spawn), patch.object(self.b, 'kill') as kill:
            register = threading.Thread(target=lambda: self.b.register_run('a'*32, [], {}))
            cancel = threading.Thread(target=lambda: (self.b.cancel_run('a'*32), finished.set()))
            register.start(); self.assertTrue(entered.wait(3)); cancel.start()
            self.assertFalse(finished.wait(.05)); release.set()
            register.join(3); cancel.join(3)
            self.assertTrue(finished.is_set()); kill.assert_called_once_with(child)
            child.wait.assert_called_once_with(timeout=5)

    def test_failed_termination_is_not_confirmed(self):
        child = Mock(); self.b.RUNS['a'*32] = child
        with patch.object(self.b, 'kill', side_effect=OSError('unavailable')):
            with self.assertRaises(OSError): self.b.cancel_run('a'*32)
        self.assertIn('a'*32, self.b.CANCELLED)

    def test_tombstones_bounded_and_expire(self):
        self.b.CANCELLED.update({str(i): time.monotonic() for i in range(4096)})
        with self.assertRaises(ValueError): self.b.cancel_run('extra')
        self.b.CANCELLED['0'] = time.monotonic()-601
        self.b.cancel_run('extra'); self.assertEqual(len(self.b.CANCELLED), 4096)

    def test_no_search_mode_has_no_tools_or_personal_settings(self):
        args = self.b.args(False)
        self.assertEqual(args[args.index('--tools')+1], '')
        for flag in ['--safe-mode','--strict-mcp-config','--no-session-persistence','--disable-slash-commands']:
            self.assertIn(flag,args)
        self.assertEqual(args[args.index('--setting-sources')+1], '')
        self.assertEqual(self.b.args(True)[args.index('--tools')+1], 'WebSearch,WebFetch')


FAKE_CLI = r"""#!/usr/bin/env python3
import json, os, sys, time
log = os.path.join(os.environ['HOME'], 'log')  # Broker passes only an allow-listed env.
argv = sys.argv[1:]
model = argv[argv.index('--model') + 1]
with open(log + '.spawn', 'a') as f:
    f.write(json.dumps({'pid': os.getpid(), 'at': time.time()}) + '\n')
data = sys.stdin.read()
override = os.path.join(os.path.dirname(log), 'usage')
used = open(override).read().strip() if os.path.exists(override) else model
with open(log, 'a') as f:
    f.write(json.dumps({'argv': argv, 'stdin': data, 'thinking_off': os.environ.get('CLAUDE_CODE_DISABLE_THINKING'),
                        'max_thinking': os.environ.get('MAX_THINKING_TOKENS'), 'token': bool(os.environ.get('CLAUDE_CODE_OAUTH_TOKEN')),
                        'pid': os.getpid()}) + '\n')
for piece in ('Fixture ', 'answer.'):
    print(json.dumps({'type': 'stream_event', 'event': {'type': 'content_block_delta', 'delta': {'type': 'text_delta', 'text': piece}}}), flush=True)
print(json.dumps({'type': 'result', 'result': 'Fixture answer.', 'modelUsage': {used: {}}}), flush=True)
"""


class BrokerRoutes(unittest.TestCase):
    """Real broker HTTP handler + a fake CLI; proves model pinning per route and the warm spare."""
    def setUp(self):
        import json as _json
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root/'workspace').mkdir()
        cli = root/'claude'; cli.write_text(FAKE_CLI); cli.chmod(0o700)
        cred = root/'credential'
        cred.write_text(_json.dumps({'claudeAiOauth': {'accessToken': 'fixture-token', 'expiresAt': (time.time()+7200)*1000}}))
        self.log = root/'log'
        env = {'WISDOM_AI_HOME': str(root), 'WISDOM_AI_TOKEN': 'fixture', 'WISDOM_AI_CLI': str(cli), 'WISDOM_AI_CREDENTIALS': str(cred)}
        with patch.dict(os.environ, env):
            spec = importlib.util.spec_from_file_location('route_broker', Path(__file__).parents[1]/'tools/discussion_broker.py')
            assert spec is not None and spec.loader is not None
            self.b = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.b)
        self.http = self.b.ThreadingHTTPServer(('127.0.0.1', 0), self.b.Handler)
        threading.Thread(target=self.http.serve_forever, daemon=True).start()
        self.url = 'http://127.0.0.1:%d' % self.http.server_port

    def tearDown(self):
        self.http.shutdown(); self.http.server_close()
        if self.b.SPARE:
            self.b.reap(self.b.SPARE['child'])
        self.tmp.cleanup()

    def payload(self, model, **change):
        import uuid
        data = {'run_id': uuid.uuid4().hex, 'system': 'Fixture lookup system.', 'model': model, 'quote': 'ontology',
                'sources': [{'label': 'passage', 'kind': 'chapter_excerpt', 'text': 'Here ontology concerns what exists.', 'edition': 'a'*64}],
                'source_links_not_read': [], 'messages': [{'role': 'user', 'content': 'Explain the selected term "ontology" as used in this passage, compactly.'}],
                'web_enabled': False}
        data.update(change)
        return data

    def post(self, path, data):
        import json as _json, urllib.request, urllib.error
        req = urllib.request.Request(self.url + path, data=_json.dumps(data).encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer fixture'})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, [_json.loads(x) for x in r]
        except urllib.error.HTTPError as e:
            with e:
                return e.code, _json.load(e)

    def calls(self):
        import json as _json
        return [_json.loads(x) for x in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_each_route_accepts_exactly_its_model(self):
        for path, model in (('/lookup', 'claude-opus-5-5'), ('/lookup', 'claude-sonnet-5'), ('/generate', 'claude-haiku-4-5'), ('/generate', 'claude-opus-5-5')):
            with self.subTest(path=path, model=model):
                self.assertEqual(self.post(path, self.payload(model)), (400, {'error': 'Invalid inference contract'}))
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.b.MODEL, 'claude-sonnet-5')
        self.assertEqual(self.b.LOOKUP_MODEL, 'claude-haiku-4-5')

    def test_lookup_contract_is_narrow(self):
        bad = [{'web_enabled': True}, {'source_links_not_read': [{'url': 'https://x.invalid'}]},
               {'messages': [{'role': 'user', 'content': 'a'}, {'role': 'assistant', 'content': 'b'}]},
               {'messages': [{'role': 'user', 'content': 'x' * 401}]},
               {'sources': [{'label': 'passage', 'kind': 'chapter_excerpt', 'text': 'a'}, {'label': 'b', 'kind': 'chapter_excerpt', 'text': 'b'}]},
               {'sources': [{'label': 'passage', 'kind': 'web', 'text': 'a'}]},
               {'sources': [{'label': 'passage', 'kind': 'chapter_excerpt', 'text': 'x' * 2401}]}, {'quote': 'x' * 129}]
        for change in bad:
            with self.subTest(change=change):
                self.assertEqual(self.post('/lookup', self.payload('claude-haiku-4-5', **change))[0], 400)
        self.assertEqual(self.calls(), [])

    def test_lookup_streams_with_fast_isolated_args(self):
        code, events = self.post('/lookup', self.payload('claude-haiku-4-5'))
        self.assertEqual(code, 200)
        self.assertEqual(events, [{'type': 'delta', 'text': 'Fixture '}, {'type': 'delta', 'text': 'answer.'},
                                  {'type': 'done', 'text': 'Fixture answer.', 'model': 'claude-haiku-4-5'}])
        call = self.calls()[0]; argv = call['argv']
        self.assertEqual(argv[argv.index('--model')+1], 'claude-haiku-4-5')
        self.assertEqual(argv[argv.index('--tools')+1], '')
        self.assertEqual(argv[argv.index('--setting-sources')+1], '')
        self.assertEqual(argv[argv.index('--input-format')+1], 'stream-json')
        for flag in ['--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']:
            self.assertIn(flag, argv)
        self.assertNotIn('--effort', argv)
        self.assertNotIn('WebSearch', ' '.join(argv))
        self.assertEqual((call['thinking_off'], call['max_thinking'], call['token']), ('1', '0', True))
        message = __import__('json').loads(call['stdin'])
        self.assertEqual(message['type'], 'user')
        self.assertIn('Here ontology concerns what exists.', message['message']['content'])

    def test_wrong_reported_model_fails_closed_on_both_routes(self):
        (Path(self.tmp.name)/'usage').write_text('claude-sonnet-5')
        code, events = self.post('/lookup', self.payload('claude-haiku-4-5'))
        self.assertEqual(events[-1], {'type': 'error', 'message': 'The configured model did not answer this request'})
        (Path(self.tmp.name)/'usage').write_text('claude-haiku-4-5')
        code, events = self.post('/generate', self.payload('claude-sonnet-5'))
        self.assertEqual(events[-1], {'type': 'error', 'message': 'The configured model did not answer this request'})

    def test_discussions_keep_opus_and_medium_effort(self):
        code, events = self.post('/generate', self.payload('claude-sonnet-5'))
        self.assertEqual(events[-1], {'type': 'done', 'text': 'Fixture answer.', 'model': 'claude-sonnet-5'})
        call = self.calls()[0]; argv = call['argv']
        self.assertEqual(argv[argv.index('--model')+1], 'claude-sonnet-5')
        self.assertEqual(argv[argv.index('--effort')+1], 'medium')
        self.assertNotIn('--input-format', argv)
        self.assertIsNone(call['thinking_off'])
        self.assertIsNone(self.b.SPARE)  # Discussions never arm the lookup spare.

    def test_warm_spare_serves_next_lookup_once(self):
        self.post('/lookup', self.payload('claude-haiku-4-5'))
        for _ in range(100):
            if self.b.SPARE: break
            time.sleep(.05)
        spare = self.b.SPARE['child']
        self.assertIsNone(spare.poll())
        code, events = self.post('/lookup', self.payload('claude-haiku-4-5'))
        self.assertEqual(events[-1]['type'], 'done')
        self.assertEqual(self.calls()[1]['pid'], spare.pid)  # Second lookup ran on the pre-started process.
        # A changed system prompt never reuses a spare built for another prompt.
        for _ in range(100):
            if self.b.SPARE: break
            time.sleep(.05)
        old = self.b.SPARE['child']
        self.post('/lookup', self.payload('claude-haiku-4-5', system='Different system.'))
        self.assertNotEqual(self.calls()[2]['pid'], old.pid)
        old.wait(timeout=5)

    def test_stale_spare_is_replaced_and_idle_spare_dropped(self):
        self.post('/lookup', self.payload('claude-haiku-4-5'))
        for _ in range(100):
            if self.b.SPARE: break
            time.sleep(.05)
        first = self.b.SPARE['child']
        self.b.SPARE['at'] -= self.b.SPARE_TTL + 1
        self.b.refresh_spare()
        self.assertIsNotNone(first.poll())
        self.assertIsNot(self.b.SPARE['child'], first)
        second = self.b.SPARE['child']
        self.b.SPARE['at'] -= self.b.SPARE_TTL + 1; self.b.LAST_LOOKUP[0] -= self.b.SPARE_IDLE + 1
        self.b.refresh_spare()
        self.assertIsNotNone(second.poll())
        self.assertIsNone(self.b.SPARE)

    def test_credential_near_expiry_is_never_parked(self):
        import json as _json
        Path(self.b.CREDENTIALS).write_text(_json.dumps({'claudeAiOauth': {'accessToken': 't', 'expiresAt': (time.time()+300)*1000}}))
        self.b.arm_spare('Fixture lookup system.')
        self.assertIsNone(self.b.SPARE)


if __name__ == '__main__': unittest.main()
