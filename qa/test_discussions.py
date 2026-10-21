import json
import contextlib
import io
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

import discussions as d

ENTRY = {'id': 'chapter-a', 'title': 'Maps', 'body': 'The map is not the territory.', 'body_sha256': 'a'*64, 'source_url': 'https://example.com/original', 'thinker': 'thinker'}
CAT = {'entries': [ENTRY], 'collections': [{'entries': ['chapter-a']}]}


class Discussions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)/'wisdom.sqlite'
        self.cat = patch('wisdom.catalog', return_value=CAT)
        self.cat.start()
        self.env = patch.dict(os.environ, {'WISDOM_DISCUSS_URL': 'http://broker', 'WISDOM_DISCUSS_TOKEN': 'fixture'})
        self.env.start()
        with contextlib.closing(sqlite3.connect(self.path)) as c:
            d.init(c, self.path)
        self.anchor = {'entry_id': ENTRY['id'], 'body_sha256': ENTRY['body_sha256'], 'start': 0, 'end': 27, 'text': ENTRY['body']}

    def tearDown(self):
        d.ACTIVE.clear()
        self.cat.stop()
        self.env.stop()
        self.tmp.cleanup()

    def test_passage_prompt_explains_highlight_not_chapter(self):
        # James, 19 Oct: Explain on a highlighted sentence answers about that sentence, briefly.
        self.assertTrue(d.SYSTEM.startswith('The reader highlighted the passage'))
        for rule in ('Do not summarise, retell or survey the chapter', 'at most 120 words', 'no headings or lists'):
            self.assertIn(rule, d.SYSTEM)
        self.assertTrue(d.CHAPTER_SYSTEM.startswith('Discuss the whole chapter with the reader'))
        self.assertNotIn('highlighted', d.CHAPTER_SYSTEM)
        self.assertLessEqual(len(d.SYSTEM), 5000)  # broker contract limit

    def create(self):
        with d.connection() as c:
            return d.create(c, self.anchor)

    def test_open_is_idle_and_idempotent(self):
        t = self.create()
        self.assertEqual(self.create()['id'], t['id'])
        self.assertEqual(t['messages'], [])
        self.assertFalse(t['active'])
        with d.connection() as c:
            self.assertEqual(len(d.listing(c)['threads']), 1)

    def test_invalid_edition_quote_and_fields(self):
        for change in [{'body_sha256': 'b'*64}, {'text': 'not in source'}, {'start': True}, {'model': 'other'}]:
            with self.subTest(change=change), d.connection() as c:
                with self.assertRaises(ValueError):
                    d.create(c, self.anchor | change)

    def test_snapshot_survives_revision_and_removal(self):
        t = self.create()
        with patch('wisdom.catalog', return_value={'entries': [], 'collections': []}), d.connection() as c:
            self.assertTrue(d.get(c, t['id'])['detached'])
            raw = json.loads(c.execute('SELECT snapshot FROM wisdom_discussions').fetchone()[0])
            self.assertEqual(raw['body'], ENTRY['body'])

    def test_submission_replay_and_active_fence(self):
        t = self.create()
        request = {'question': 'Explain', 'request_id': 'request_0001', 'web_enabled': False}
        with patch.object(threading.Thread, 'start'):
            out = d.submit(t['id'], request)
            self.assertTrue(out['active'])
            self.assertEqual(len(d.submit(t['id'], request)['messages']), 2)
            with self.assertRaises(ValueError):
                d.submit(t['id'], request | {'question': 'Different'})
            with self.assertRaises(ValueError):
                d.submit(t['id'], request | {'request_id': 'request_0002'})

    def test_prompt_is_thread_scoped_and_sources_explicit(self):
        t = self.create()
        with patch.object(threading.Thread, 'start'):
            d.submit(t['id'], {'question': 'Explain', 'request_id': 'request_0001', 'web_enabled': False})
        with d.connection() as c:
            context = d.context(c, t['id'])
        self.assertEqual(context['model'], 'claude-sonnet-5')
        self.assertFalse(context['web_enabled'])
        self.assertEqual(context['sources'][0]['text'], ENTRY['body'])
        self.assertEqual(context['source_links_not_read'], ['https://example.com/original'])
        self.assertEqual(context['messages'], [{'role': 'user', 'content': 'Explain'}])
        self.assertNotIn('SOUL.md', json.dumps(context))

    def test_whole_chapter_discussion(self):
        chapter = {'entry_id': ENTRY['id'], 'body_sha256': ENTRY['body_sha256'], 'scope': 'chapter'}
        passage = self.create()
        with d.connection() as c:
            t = d.create(c, chapter)
            self.assertEqual(d.create(c, chapter)['id'], t['id'])
            self.assertNotEqual(t['id'], passage['id'])
            self.assertEqual((t['scope'], t['quote'], t['start'], t['end']), ('chapter', '', 0, 0))
            self.assertEqual(d.get(c, passage['id'])['scope'], 'passage')
            self.assertEqual(sorted(x['scope'] for x in d.listing(c)['threads']), ['chapter', 'passage'])
            for bad in [chapter | {'start': 0}, chapter | {'text': 'The map'}, chapter | {'scope': 'book'}, chapter | {'body_sha256': 'b'*64}]:
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    d.create(c, bad)
        with patch.object(threading.Thread, 'start'):
            d.submit(t['id'], {'question': 'Big idea?', 'request_id': 'request_0009', 'web_enabled': False})
        with d.connection() as c:
            context = d.context(c, t['id'])
        self.assertTrue(context['system'].startswith('Discuss the whole chapter'))
        self.assertEqual(context['sources'][0]['text'], ENTRY['body'])
        self.assertEqual(context['quote'], '')

    def test_stream_and_verified_source_persist(self):
        t = self.create()
        with patch.object(threading.Thread, 'start'):
            out = d.submit(t['id'], {'question': 'Explain', 'request_id': 'request_0001', 'web_enabled': True})
        mid = out['messages'][-1]['id']
        events = [{'type': 'delta', 'text': 'It represents reality. '}, {'type': 'source', 'source': {'url': 'https://example.com/read', 'title': 'Read', 'label': 'web'}}, {'type': 'done', 'text': 'See [chapter](#/read/chapter-a) and [source](https://example.com/read).', 'model': d.MODEL}]
        class Response:
            def __enter__(self): return self
            def __exit__(self, *a): pass
            def __iter__(self): return iter(json.dumps(e).encode() for e in events)
        with patch.object(d, 'broker_request', return_value=Response()):
            d.generate(t['id'], mid, d.ACTIVE[mid])
        with d.connection() as c:
            result = d.get(c, t['id'])
        self.assertFalse(result['active'])
        self.assertEqual(result['messages'][-1]['state'], 'complete')
        self.assertEqual(len(result['messages'][-1]['sources']), 2)

    def test_sectioned_collection_context(self):
        t = self.create()
        with patch.object(threading.Thread, 'start'):
            d.submit(t['id'], {'question': 'Explain how a representation describes territory', 'request_id': 'request_0001', 'web_enabled': False})
        other = ENTRY | {'id': 'chapter-b', 'title': 'Other map', 'body': 'A map describes territory but never becomes territory.'}
        sectioned = {'entries': [ENTRY, other], 'collections': [{'sections': [{'entries': ['chapter-a', 'chapter-b']}]}]}
        with patch('wisdom.catalog', return_value=sectioned), d.connection() as c:
            payload = d.context(c, t['id'])
        self.assertEqual(len(payload['sources']), 2)

    def test_failure_retains_question_partial_and_no_fake_complete(self):
        t = self.create()
        with patch.object(threading.Thread, 'start'):
            out = d.submit(t['id'], {'question': 'Explain', 'request_id': 'request_0001', 'web_enabled': False})
        mid = out['messages'][-1]['id']
        with d.connection() as c:
            c.execute('UPDATE wisdom_discussion_messages SET content=? WHERE id=?', ('partial', mid))
        with patch.object(d, 'broker_request', side_effect=OSError('sensitive-internal-address')):
            d.generate(t['id'], mid, d.ACTIVE[mid])
        with d.connection() as c:
            result = d.get(c, t['id'])
        self.assertEqual(result['messages'][-1]['state'], 'failed')
        self.assertEqual(result['messages'][-1]['content'], 'partial')
        self.assertNotIn('sensitive-internal-address', result['messages'][-1]['error'])
        self.assertEqual(result['messages'][0]['content'], 'Explain')

    def test_restart_marks_interrupted(self):
        t = self.create()
        with patch.object(threading.Thread, 'start'):
            d.submit(t['id'], {'question': 'Explain', 'request_id': 'request_0001', 'web_enabled': False})
        with d.connection() as c:
            d.init(c, self.path)
            out = d.get(c, t['id'])
        self.assertFalse(out['active'])
        self.assertEqual(out['messages'][-1]['state'], 'interrupted')

    def test_stop_delivery_failure_is_retryable_not_confirmed(self):
        t = self.create()
        with patch.object(threading.Thread, 'start'):
            out = d.submit(t['id'], {'question': 'Explain', 'request_id': 'request_0001', 'web_enabled': False})
        uid = out['messages'][-1]['id']
        with patch.object(d, 'broker_request', side_effect=OSError('offline')):
            out = d.stop(t['id'])
        self.assertTrue(out['active'])
        self.assertEqual(out['messages'][-1]['state'], 'cancel_unconfirmed')
        self.assertTrue(d.ACTIVE[uid].is_set())
        with patch.object(d, 'broker_request') as broker:
            d.generate(t['id'], uid, d.ACTIVE[uid])
            broker.assert_not_called()
        with patch.object(d, 'broker_request', return_value=io.BytesIO(b'{"cancelled":true}')):
            out = d.stop(t['id'])
        self.assertFalse(out['active'])
        self.assertEqual(out['messages'][-1]['state'], 'stopped')


if __name__ == '__main__':
    unittest.main()
