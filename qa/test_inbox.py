"""Wizard OS inbox feed (contract v1): today's reading until any reading today. Synthetic data only."""
import datetime as dt
import json
import os
import sqlite3
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

import server
import wisdom
from qa import test_portable


class Inbox(unittest.TestCase):
    # Reuse the portable fixture (temp data dir, real Handler, synthetic bundle) without inheriting its tests.
    tearDown = test_portable.Portable.tearDown
    call = test_portable.Portable.call
    install = test_portable.Portable.install

    def setUp(self):
        test_portable.Portable.setUp(self)
        os.environ.pop('WISDOM_TIMEZONE', None)
        self.install()

    def raw(self, path, body, typ):
        req = urllib.request.Request(self.url + path, data=body, headers={'Content-Type': typ})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def items(self):
        status, body = self.call('/api/inbox')
        self.assertEqual(status, 200, body)
        self.assertEqual(body['inbox'], 1)
        return body['items']

    def test_feed_lists_todays_reading_with_contract_shape(self):
        items = self.items()
        self.assertEqual(len(items), 1)
        it = items[0]
        day = dt.datetime.now(dt.timezone.utc).date().isoformat()  # WISDOM_TIMEZONE unset -> UTC
        self.assertEqual(it['key'], 'reading:' + day)
        self.assertEqual(it['title'], "Today's reading")
        self.assertIn('A quiet beginning', it['text'])
        self.assertIn('Example Author', it['text'])
        self.assertEqual(it['priority'], 2)
        self.assertEqual(it['open'], '#/read/example-chapter/example-collection')
        midnight = int(dt.datetime.combine(dt.date.fromisoformat(day), dt.time(0), dt.timezone.utc).timestamp())
        self.assertEqual(it['time'], midnight)
        self.assertNotIn('actions', it)
        self.assertLessEqual(set(it), {'key', 'title', 'text', 'time', 'priority', 'open', 'actions'})
        self.assertNotIn('<', it['text'])

    def test_reading_today_drops_item_and_feed_has_no_side_effects(self):
        before = self.call('/api/wisdom')[1]['entries']
        self.items(); self.items()
        self.assertEqual(self.call('/api/wisdom')[1]['entries'], before)  # GET changed nothing
        self.assertEqual(self.call('/api/wisdom/reaction', {'kind': 'entry', 'id': 'example-chapter', 'field': 'progress', 'value': 30})[0], 200)
        self.assertEqual(self.items(), [])

    def test_finishing_a_chapter_drops_item(self):
        self.assertEqual(self.call('/api/wisdom/reaction', {'kind': 'entry', 'id': 'example-chapter', 'field': 'done', 'value': True})[0], 200)
        self.assertEqual(self.items(), [])

    def test_yesterdays_reading_does_not_count_and_new_day_has_new_key(self):
        yesterday = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).isoformat(timespec='seconds')
        with sqlite3.connect(server.DATA / 'wisdom.sqlite') as c:
            c.execute('INSERT INTO wisdom_positions(id,progress,updated_at) VALUES (?,?,?)', ('example-chapter', 40, yesterday))
        items = self.items()
        self.assertEqual(len(items), 1)
        self.assertTrue(items[0]['text'].startswith('Continue: A quiet beginning'))
        tomorrow = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)
        with sqlite3.connect(server.DATA / 'wisdom.sqlite') as c:
            c.row_factory = sqlite3.Row
            nxt = wisdom.inbox(c, now=tomorrow)['items']
        self.assertEqual(nxt[0]['key'], 'reading:' + tomorrow.date().isoformat())

    def test_local_day_follows_wisdom_timezone(self):
        # 23:30 UTC is already the next day in Bangkok: yesterday-UTC reading no longer counts there.
        now = dt.datetime(2026, 10, 30, 23, 30, tzinfo=dt.timezone.utc)
        with sqlite3.connect(server.DATA / 'wisdom.sqlite') as c:
            c.row_factory = sqlite3.Row
            c.execute('INSERT INTO wisdom_positions(id,progress,updated_at) VALUES (?,?,?)', ('example-chapter', 40, '2026-10-30T12:00:00+00:00'))
            with patch.dict(os.environ, {'WISDOM_TIMEZONE': 'UTC'}):
                self.assertEqual(wisdom.inbox(c, now=now)['items'], [])
            with patch.dict(os.environ, {'WISDOM_TIMEZONE': 'Asia/Bangkok'}):
                it = wisdom.inbox(c, now=now)['items'][0]
        self.assertEqual(it['key'], 'reading:2026-10-31')
        self.assertEqual(it['time'], int(dt.datetime(2026, 10, 30, 17, 0, tzinfo=dt.timezone.utc).timestamp()))

    def test_empty_library_has_no_items(self):
        self.assertEqual(self.call('/api/library/action', {'id': 'example', 'action': 'disable'})[0], 200)
        self.assertEqual(self.items(), [])

    def test_act_is_json_only_and_rejects_unknown_actions(self):
        key = self.items()[0]['key']
        self.assertEqual(self.raw('/api/inbox/act', b'key=x', 'application/x-www-form-urlencoded')[0], 415)
        status, body = self.call('/api/inbox/act', {'key': key, 'action': 'done'})
        self.assertEqual((status, body['error']), (400, 'Unknown action'))
        self.assertEqual(self.call('/api/inbox/act', {'key': key, 'action': 'nope', 'text': 'hi'})[0], 400)
        self.assertEqual(self.call('/api/inbox/act', {'key': key})[0], 400)
        self.assertEqual(self.call('/api/inbox/act', {'key': key, 'action': 'done', 'extra': 1})[0], 400)
        self.assertEqual(len(self.items()), 1)  # nothing mutated

    def test_same_owner_boundary_as_other_routes(self):
        status, _ = self.call('/api/inbox/act', {'key': 'k', 'action': 'done'}, headers={'Origin': 'https://evil.example'})
        self.assertEqual(status, 403)
        req = urllib.request.Request(self.url + '/api/inbox', headers={'Host': 'evil.example'})
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req, timeout=10)
        self.assertEqual(e.exception.code, 421)

    def test_feed_is_cheap(self):
        t = time.perf_counter(); self.items()
        self.assertLess(time.perf_counter() - t, 0.2)

    def test_openapi_documents_inbox_routes(self):
        paths = self.call('/openapi.json')[1]['paths']
        self.assertIn('get', paths['/api/inbox'])
        self.assertIn('post', paths['/api/inbox/act'])


if __name__ == '__main__':
    unittest.main()
