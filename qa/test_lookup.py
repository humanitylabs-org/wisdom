"""Contextual AI lookup contracts; synthetic evidence, no paid/live inference."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import threading
import unittest
import urllib.error
import urllib.request
import unittest.mock
from unittest.mock import patch

import lookup
import server

ROOT = Path(__file__).resolve().parents[1]
BODY = '# Fixture\n\nHere **ontology** concerns what exists, not how we know it.\n\nSōtō and dhātu-vāda appear in a different paragraph.\n\n無為 is a Chinese term in this fixture.'
ENTRY = {'id': 'fixture', 'body': BODY, 'body_sha256': hashlib.sha256(BODY.encode()).hexdigest(), 'title': 'Fixture'}
ANSWER = 'The term names the question of what exists and what kind of reality things have. Here it contrasts with questions about how we come to know anything.'


def request(text='ontology', **extra):
    return dict(text=text, entry_id=ENTRY['id'], body_sha256=ENTRY['body_sha256'], **extra)


def response(text=ANSWER, model=lookup.MODEL, events=None):
    return io.BytesIO(b''.join(json.dumps(e).encode() + b'\n' for e in (events if events is not None else [{'type': 'delta', 'text': 'partial'}, {'type': 'done', 'text': text, 'model': model}])))


class LookupContract(unittest.TestCase):
    def setUp(self):
        self.catalog = patch.object(lookup.wisdom, 'catalog', return_value={'entries': [ENTRY]}).start()
        patch.object(lookup.discussions, 'configured', return_value=True).start()
        self.broker = patch.object(lookup.discussions, 'broker_request', side_effect=lambda path, *a, **kw: response() if path == '/lookup' else io.BytesIO(b'{}')).start()
        self.addCleanup(patch.stopall)

    def test_exact_broker_contract_and_no_owner_writes(self):
        with patch.object(server, 'db', side_effect=AssertionError('No owner DB access')), patch.object(lookup.discussions, 'connection', side_effect=AssertionError('No discussions')):
            result = lookup.explain(request(context='Here ontology concerns what exists, not how we know it.'))
        self.assertEqual(result['text'], ANSWER)
        path, payload = self.broker.call_args.args
        self.assertEqual(path, '/lookup')
        self.assertEqual(set(payload), {'run_id', 'system', 'model', 'quote', 'sources', 'source_links_not_read', 'messages', 'web_enabled'})
        self.assertRegex(payload['run_id'], r'^[a-f0-9]{32}$')
        self.assertEqual(payload['model'], 'claude-haiku-4-5')
        self.assertEqual(lookup.discussions.MODEL, 'claude-sonnet-5')  # Ask AI runs on Sonnet.
        self.assertEqual(payload['messages'], [{'role': 'user', 'content': 'Explain the selected term "ontology" as used in this passage, compactly.'}])
        self.assertFalse(payload['web_enabled'])
        self.assertEqual(payload['source_links_not_read'], [])
        self.assertEqual(len(payload['sources']), 1)
        self.assertEqual(payload['sources'][0]['text'], 'Here ontology concerns what exists, not how we know it.')
        self.assertNotIn('Sōtō', json.dumps(payload))
        self.assertIn('never exceeding 70 words', payload['system'])

    def test_unicode_and_rendered_context(self):
        for term in ('Sōtō', 'dhātu-vāda', '無為'):
            with self.subTest(term=term):
                self.assertEqual(lookup.explain(request(term))['text'], ANSWER)
        body = '> A *Sōtō* quotation [1]\n> continues here.'
        self.catalog.return_value = {'entries': [{**ENTRY, 'body': body}]}
        self.assertIn('continues', lookup.context(request('Sōtō', context='A Sōtō quotation continues here.'))[2])

    def test_cover_title_and_summary_are_lookup_context(self):
        # The opener's title and summary are selectable; their own text is the passage.
        entry = dict(ENTRY, title='I will die today', deck='Remembering death is a way of sorting, not a way of brooding.')
        self.catalog.return_value = {'entries': [entry]}
        _, _, passage = lookup.context(request('brooding', context=entry['deck']))
        self.assertEqual(passage, entry['deck'])
        self.assertEqual(lookup.context(request('die', context=entry['title']))[2], entry['title'])
        self.assertTrue(lookup.wisdom.quote_in_entry('I will die today\n\nRemembering death', entry))
        self.assertFalse(lookup.wisdom.quote_in_entry('Remembering life', entry))
        self.assertFalse(lookup.wisdom.quote_in_body('Remembering death', entry['body']))

    def test_orphan_citation_anchors_removed(self):
        self.catalog.return_value = {'entries': [{**ENTRY, 'body': 'An ontology in philosophy [2].'}]}
        self.broker.side_effect = lambda *a, **kw: response(text=ANSWER + ' [2]')
        result = lookup.explain(request(context='An ontology in philosophy [2].'))
        self.assertEqual(result['text'], ANSWER)
        self.assertNotIn('[2]', self.broker.call_args.args[1]['sources'][0]['text'])

    def test_context_disambiguates_same_term(self):
        self.catalog.return_value = {'entries': [{**ENTRY, 'body': 'An ontology in philosophy.\n\nAn ontology in software.'}]}
        with self.assertRaises(ValueError):
            lookup.context(request())
        self.assertEqual(lookup.context(request(context='An ontology in software.'))[2], 'An ontology in software.')

    def test_invalid_and_stale_never_call_model(self):
        for change in ({'text': ''}, {'text': 'x' * 129}, {'text': 'word ' * 9}, {'text': None}, {'text': 'x\x00'}, {'text': 'absent'}, {'text': '!!!'}, {'body_sha256': '0' * 64}, {'body_sha256': 'bad'}, {'entry_id': 'unknown'}, {'context': 'forged ontology'}, {'context': []}, {'context': 'x' * 2401}, {'system': 'override'}, {'web_enabled': True}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                lookup.explain({**request(), **change})
        self.broker.assert_not_called()

    def test_context_size_bounded_and_not_entire_chapter(self):
        body = ('before ' * 1000) + 'ontology' + (' after' * 1000)
        self.catalog.return_value = {'entries': [{**ENTRY, 'body': body}]}
        self.assertLessEqual(len(lookup.context(request())[2]), 1728)

    def test_failures_sanitized_and_no_fallback(self):
        events = [[], [{'type': 'delta', 'text': ANSWER}], [{'type': 'error', 'message': 'secret provider detail'}], [{'type': 'source', 'source': {}}], [None]]
        for stream in events:
            self.broker.side_effect = lambda path, *a, **kw: response(events=stream) if path == '/lookup' else io.BytesIO(b'{}')
            with self.subTest(stream=stream), self.assertRaisesRegex(lookup.Unavailable, '^' + lookup.UNAVAILABLE.replace('.', r'\.') + '$'):
                lookup.explain(request())
        for answer in ('', 'ontology', 'Too short.', 'word ' * 71, 'a' * 701, '# Heading', '- dictionary sense one', '**Bold** explanation here.', 'First paragraph.\nSecond paragraph.', None):
            self.broker.side_effect = lambda path, *a, **kw: response(text=answer)
            with self.subTest(answer=answer), self.assertRaises(lookup.Unavailable):
                lookup.explain(request())
        self.broker.side_effect = lambda *a, **kw: response(model='different-model')
        with self.assertRaises(lookup.Unavailable):
            lookup.explain(request())
        self.broker.side_effect = OSError('secret endpoint')
        with self.assertRaisesRegex(lookup.Unavailable, '^AI explanation unavailable'):
            lookup.explain(request())

    def test_oversize_malformed_stream_cancelled(self):
        for raw in (b'x' * 8193, b'not json\n', b'{"type":"delta","text":"x"}\n' * 513):
            self.broker.side_effect = lambda path, *a, **kw: io.BytesIO(raw if path == '/lookup' else b'{}')
            with self.subTest(size=len(raw)), self.assertRaises(lookup.Unavailable):
                lookup.explain(request())
            self.assertEqual(self.broker.call_args.args[0], '/cancel')

    def test_streams_deltas_then_validated_final(self):
        events = list(lookup.run(request()))
        self.assertEqual(events[0], ('delta', 'partial'))
        self.assertEqual(events[-1][0], 'done')
        self.assertEqual(events[-1][1]['text'], ANSWER)
        self.assertEqual(events[-1][1]['model'], 'claude-haiku-4-5')
        # Streamed text is bounded; a runaway stream fails closed and is cancelled.
        self.broker.side_effect = lambda path, *a, **kw: response(events=[{'type': 'delta', 'text': 'x' * 1401}]) if path == '/lookup' else io.BytesIO(b'{}')
        with self.assertRaises(lookup.Unavailable):
            list(lookup.run(request()))
        self.assertEqual(self.broker.call_args.args[0], '/cancel')
        self.broker.side_effect = lambda path, *a, **kw: response(events=[{'type': 'delta', 'text': None}]) if path == '/lookup' else io.BytesIO(b'{}')
        with self.assertRaises(lookup.Unavailable):
            list(lookup.run(request()))

    def test_closing_stream_early_cancels_broker_run(self):
        self.broker.side_effect = lambda path, *a, **kw: response() if path == '/lookup' else io.BytesIO(b'{}')
        events = lookup.run(request())
        self.assertEqual(next(events), ('delta', 'partial'))
        events.close()  # The reader closed the popover.
        self.assertEqual(self.broker.call_args.args[0], '/cancel')
        self.assertEqual(self.broker.call_args.args[1]['run_id'], self.broker.call_args_list[0].args[1]['run_id'])
        self.assertTrue(lookup.SLOTS.acquire(blocking=False)); lookup.SLOTS.release()

    def test_missing_route_and_busy_fail_closed(self):
        with patch.object(lookup.discussions, 'configured', return_value=False), self.assertRaises(lookup.Unavailable):
            lookup.explain(request())
        with patch.object(lookup, 'SLOTS') as slots:
            slots.acquire.return_value = False
            with self.assertRaises(lookup.Unavailable):
                lookup.explain(request())
            slots.release.assert_not_called()
        self.broker.assert_not_called()

    def test_edition_change_while_inference_runs_is_input_error(self):
        self.catalog.side_effect = [{'entries': [ENTRY]}, {'entries': [{**ENTRY, 'body_sha256': '0' * 64}]}]
        with self.assertRaisesRegex(ValueError, 'edition changed'):
            lookup.explain(request())

    def test_browser_regressions(self):
        run = subprocess.run(['node', 'qa/lookup-contract.cjs'], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        print(run.stdout.strip())


class HttpContract(unittest.TestCase):
    setUp = LookupContract.setUp
    @classmethod
    def setUpClass(cls):
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = 'http://127.0.0.1:' + str(cls.http.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()

    def post(self, payload, headers=None):
        req = urllib.request.Request(self.url + '/api/lookup', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', **(headers or {})})
        try:
            resp = urllib.request.urlopen(req)
        except urllib.error.HTTPError as exc:
            resp = exc
        with resp:
            return resp.status, json.load(resp), resp.headers

    def stream(self, payload, headers=None):
        req = urllib.request.Request(self.url + '/api/lookup/stream', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', **(headers or {})})
        try:
            resp = urllib.request.urlopen(req)
        except urllib.error.HTTPError as exc:
            with exc:
                return exc.status, json.load(exc), exc.headers
        with resp:
            return resp.status, [json.loads(line) for line in resp], resp.headers

    def test_http_stream_route(self):
        code, lines, headers = self.stream(request())
        self.assertEqual(code, 200)
        self.assertEqual(headers['Content-Type'], 'application/x-ndjson')
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(lines[0], {'type': 'delta', 'text': 'partial'})
        self.assertEqual(lines[-1]['type'], 'done')
        self.assertEqual(lines[-1]['text'], ANSWER)
        self.assertEqual(lines[-1]['model'], 'claude-haiku-4-5')
        self.assertEqual(self.stream({**request(), 'body_sha256': '0' * 64})[0], 400)
        self.assertEqual(self.stream(request(), {'Origin': 'https://example.invalid'})[0], 403)
        # Failure after streaming began: one sanitized error line, never the partial as final.
        self.broker.side_effect = lambda path, *a, **kw: response(text='# Heading') if path == '/lookup' else io.BytesIO(b'{}')
        code, lines, _ = self.stream(request())
        self.assertEqual(code, 200)
        self.assertEqual(lines[-1], {'type': 'error', 'status': 503, 'error': lookup.UNAVAILABLE})
        self.assertNotIn('done', [l['type'] for l in lines])
        self.broker.side_effect = OSError('private provider failure')
        self.assertEqual(self.stream(request()), (503, {'error': lookup.UNAVAILABLE}, unittest.mock.ANY))

    def test_http_real_route_status_privacy_and_retired_dictionary(self):
        code, result, headers = self.post(request())
        self.assertEqual(code, 200)
        self.assertEqual(result['text'], ANSWER)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(self.post({**request(), 'body_sha256': '0' * 64})[0], 400)
        self.assertEqual(self.post(request(), {'Origin': 'https://example.invalid'})[0], 403)
        self.broker.side_effect = OSError('private provider failure')
        code, result, _ = self.post(request())
        self.assertEqual(code, 503)
        self.assertEqual(result, {'error': lookup.UNAVAILABLE})
        with self.assertRaises(urllib.error.HTTPError) as failure:
            urllib.request.urlopen(self.url + '/api/dictionary?q=ontology')
        self.assertEqual(failure.exception.code, 404)
        failure.exception.close()


if __name__ == '__main__':
    unittest.main()
