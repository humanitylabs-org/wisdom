"""Ask AI as the owner's real Wizard Chats thread (James, 22 Oct 2026).

Wisdom finds or creates one Philosopher session per discussion, migrates empty main-agent
threads, and visibly carries over earlier turns once without repeating them in the reply item.
"""
import contextlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from urllib.parse import urlsplit, parse_qs
from unittest.mock import patch

import discussions as d

ENTRY = {'id': 'chapter-a', 'title': 'Maps', 'body': 'Intro.\n\nThe map is not the territory.', 'body_sha256': 'a'*64,
         'source_url': 'https://example.com/original', 'thinker': 'Korzybski'}
CAT = {'entries': [ENTRY], 'collections': [{'entries': ['chapter-a']}]}


class ChatsThread(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'wisdom.sqlite'
        self.cat = patch('wisdom.catalog', return_value=CAT); self.cat.start()
        with contextlib.closing(sqlite3.connect(self.path)) as c:
            d.init(c, self.path)
        import server
        self.server = server
        self.patches = [patch.object(server, 'DATA', Path(self.tmp.name)), patch.object(server, 'ADMIT', 'live'),
                        patch.object(server, 'WIZARD_ORIGIN', 'http://wizard.invalid'),
                        patch.object(d, 'THREAD_AGENT', 'reader-agent'), patch.object(d, 'THREAD_MODEL', 'reader-model'),
                        patch.object(d, 'THREAD_PROVIDER', 'reader-provider')]
        for p in self.patches: p.start()
        with d.connection() as c:
            self.t = d.create(c, {'entry_id': 'chapter-a', 'body_sha256': 'a'*64, 'start': 8, 'end': 37, 'text': 'The map is not the territory.'})
        self.sessions, self.calls, self.runs = {}, [], {}

    def tearDown(self):
        for p in self.patches: p.stop()
        self.cat.stop(); self.tmp.cleanup()

    def fake(self, method, path, body, headers=None, timeout=10):
        self.calls.append((method, path, body))
        u = urlsplit(path)
        agent = parse_qs(u.query).get('agent', [''])[0]
        sid = u.path.rsplit('/', 1)[1]
        if method == 'GET':
            if (agent, sid) not in self.sessions:
                raise self.server.AdmissionError('Wizard answered HTTP 404 on ' + sid)
            return {'session': self.sessions[agent, sid]}
        if method == 'PATCH':
            self.sessions[agent, sid].update(body)
            return {'session': self.sessions[agent, sid]}
        if u.path.endswith('/runs'):
            key = headers['Idempotency-Key']
            if key not in self.runs:
                self.runs[key] = {'run_id': 'run_' + str(len(self.runs))}
                self.sessions[agent, body['session_id']]['message_count'] = 2
            return self.runs[key]
        self.sessions[agent, body['id']] = {'id': body['id'], 'title': body['title'], 'model': body.get('model'), 'message_count': 0}
        return {'session': self.sessions[agent, body['id']]}

    def test_creates_once_with_pinned_model_and_passage_item(self):
        with patch.object(self.server, '_wizard', self.fake):
            a = self.server.open_discussion_thread(self.t['id'])
            b = self.server.open_discussion_thread(self.t['id'])
        self.assertEqual(a['session_id'], b['session_id'])
        posts = [c for c in self.calls if c[0] == 'POST']
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0][1], '/wizard/hermes/api/sessions?agent=reader-agent')
        self.assertEqual(a['agent'], 'reader-agent')
        self.assertEqual(posts[0][2]['model'], 'reader-model')
        self.assertEqual(posts[0][2]['provider'], 'reader-provider')
        self.assertEqual(posts[0][2]['title'], 'Wisdom · Maps')
        r = a['reply']
        self.assertEqual(r['key'], 'wisdom:' + self.t['id'])
        self.assertRegex(r['key'], r'^[a-z][a-z0-9-]{0,40}:[A-Za-z0-9_-]{1,128}$')  # shell reply.clean contract
        self.assertIn('"The map is not the territory."', r['message'])
        self.assertIn('Intro.', r['message'])  # full chapter text supplied
        self.assertIn('Simplify =', r['message'])  # one-word commands keep their meaning
        self.assertNotIn('no personal assistant identity', r['message'])
        self.assertLessEqual(len(r['message']), 32000)
        with d.connection() as c:
            self.assertEqual(d.listing(c)['threads'][0]['session_id'], a['session_id'])

    def test_empty_configuration_uses_owner_defaults(self):
        self.earlier()
        with patch.object(d, 'THREAD_AGENT', ''), patch.object(d, 'THREAD_MODEL', ''), patch.object(d, 'THREAD_PROVIDER', ''), patch.object(self.server, '_wizard', self.fake):
            result = self.server.open_discussion_thread(self.t['id'])
        self.assertEqual(result['agent'], '')
        for method, path, body in self.calls:
            self.assertNotIn('?agent=', path)
            if method == 'POST':
                self.assertNotIn('model', body)
                self.assertNotIn('provider', body)
                self.assertNotIn('agent', body)
                self.assertNotIn('require_model_lock', body)

    def test_started_thread_gets_no_second_item(self):
        with patch.object(self.server, '_wizard', self.fake):
            a = self.server.open_discussion_thread(self.t['id'])
            self.sessions['reader-agent', a['session_id']]['message_count'] = 2
            b = self.server.open_discussion_thread(self.t['id'])
        self.assertTrue(b['started']); self.assertIsNone(b['reply'])

    def test_earlier_wisdom_turns_carry_over(self):
        with d.connection() as c:
            c.execute("INSERT INTO wisdom_discussion_messages(id,thread_id,role,content,state,created) VALUES('m1',?,'user','What is a map?','complete','x')", (self.t['id'],))
            c.execute("INSERT INTO wisdom_discussion_messages(id,thread_id,role,content,state,created) VALUES('m2',?,'assistant','A model.','complete','x')", (self.t['id'],))
            c.commit()
            msg = d.thread_reply(c, self.t['id'])['message']
        self.assertIn('Owner: What is a map?', msg); self.assertIn('Answer: A model.', msg)

    def earlier(self):
        with d.connection() as c:
            c.execute("INSERT INTO wisdom_discussion_messages(id,thread_id,role,content,state,created) VALUES('prior',?,'user','Earlier question ' || ?, 'complete','x')", (self.t['id'], 'q' * 2000))
            c.commit()

    def test_visible_history_once_and_not_in_reply_item(self):
        self.earlier()
        with patch.object(self.server, '_wizard', self.fake):
            a = self.server.open_discussion_thread(self.t['id'])
            b = self.server.open_discussion_thread(self.t['id'])
        runs = [x for x in self.calls if x[1].startswith('/wizard/hermes/v1/runs')]
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0][1], '/wizard/hermes/v1/runs?agent=reader-agent')
        self.assertIn('q' * 2000, runs[0][2]['input'])  # no historical truncation
        self.assertIn('Quoted passage: The map is not the territory.', runs[0][2]['input'])
        self.assertTrue(runs[0][2]['require_model_lock'])
        self.assertEqual(runs[0][2]['model'], 'reader-model')
        self.assertNotIn('Earlier question', b['reply']['message'])
        self.assertIn('Full chapter text', b['reply']['message'])
        with d.connection() as c:
            self.assertEqual(c.execute('SELECT history_state FROM wisdom_discussion_chats').fetchone()[0], 'admitted')
            self.assertEqual(len(d.get(c, self.t['id'])['messages']), 1)

    def test_empty_main_session_rebound_and_archived_only_once(self):
        with d.connection() as c:
            d.bind_session(c, self.t['id'], 'wizard_old')
            before = dict(c.execute('SELECT * FROM wisdom_discussions').fetchone())
        self.sessions['', 'wizard_old'] = {'id': 'wizard_old', 'message_count': 0}
        self.earlier()
        with patch.object(self.server, '_wizard', self.fake):
            a = self.server.open_discussion_thread(self.t['id'])
            b = self.server.open_discussion_thread(self.t['id'])
        self.assertNotEqual(a['session_id'], 'wizard_old')
        self.assertEqual(a['session_id'], b['session_id'])
        self.assertTrue(self.sessions['', 'wizard_old']['archived'])
        self.assertEqual(len([x for x in self.calls if x[0] == 'PATCH']), 1)
        with d.connection() as c:
            after = dict(c.execute('SELECT * FROM wisdom_discussions').fetchone())
        before.pop('session_id'); after.pop('session_id')
        self.assertEqual(before, after)

    def test_nonempty_main_is_never_archived_or_rebound(self):
        with d.connection() as c:
            d.bind_session(c, self.t['id'], 'wizard_old')
        self.sessions['', 'wizard_old'] = {'id': 'wizard_old', 'message_count': 2}
        with patch.object(self.server, '_wizard', self.fake), self.assertRaises(self.server.AdmissionError):
            self.server.open_discussion_thread(self.t['id'])
        with d.connection() as c:
            self.assertEqual(d.session_of(c, self.t['id']), 'wizard_old')
        self.assertFalse(any(x[0] != 'GET' for x in self.calls))

    def test_lost_create_reuses_bound_id(self):
        def lost(method, path, body, *args, **kw):
            result = self.fake(method, path, body, *args, **kw)
            if method == 'POST':
                raise self.server.AdmissionError('lost response')
            return result
        with patch.object(self.server, '_wizard', lost), self.assertRaises(self.server.AdmissionError):
            self.server.open_discussion_thread(self.t['id'])
        with patch.object(self.server, '_wizard', self.fake):
            a = self.server.open_discussion_thread(self.t['id'])
        self.assertEqual(len([x for x in self.calls if x[0] == 'POST']), 1)
        self.assertEqual(a['session_id'], next(iter(self.sessions))[1])

    def test_lost_history_response_retries_same_idempotency_key(self):
        self.earlier()
        keys = []
        def lost(method, path, body, headers=None, **kw):
            result = self.fake(method, path, body, headers, **kw)
            if path.startswith('/wizard/hermes/v1/runs'):
                keys.append(headers['Idempotency-Key'])
                if len(keys) == 1:
                    raise self.server.AdmissionError('lost run response')
            return result
        with patch.object(self.server, '_wizard', lost):
            with self.assertRaises(self.server.AdmissionError):
                self.server.open_discussion_thread(self.t['id'])
            self.server.open_discussion_thread(self.t['id'])
            self.server.open_discussion_thread(self.t['id'])
        self.assertEqual(keys, ['wisdom-history-' + self.t['id']] * 2)
        self.assertEqual(len(self.runs), 1)

    def test_hosted_client_requires_agent_aware_shell(self):
        src = Path('static/discussions.js').read_text()
        self.assertIn('window.WizardApp.nav?.threadAgents === true', src)
        self.assertIn('{reply:r.reply, ...(r.agent ? {agent:r.agent} : {})', src)
        self.assertIn('WizardApp.nav.threadDrafts === true ? {draft:{text}}', src)
        self.assertIn('if (accepted !== true)', src)

    def test_not_connected_is_honest(self):
        with patch.object(self.server, 'ADMIT', 'disabled'):
            with self.assertRaises(self.server.AdmissionError):
                self.server.open_discussion_thread(self.t['id'])

    def test_long_chapter_is_clipped_to_the_shell_limit(self):
        big = dict(ENTRY, body='Intro.\n\n' + ('word ' * 12000) + '\n\nThe map is not the territory.')
        with patch('wisdom.catalog', return_value={'entries': [big], 'collections': [{'entries': ['chapter-a']}]}), d.connection() as c:
            t = d.create(c, {'entry_id': 'chapter-a', 'body_sha256': 'a'*64, 'scope': 'chapter'})
            r = d.thread_reply(c, t['id'])
        self.assertLessEqual(len(r['message']), 32000)
        self.assertIn('Simplify =', r['message'])
        self.assertTrue(r['title'].startswith('Discuss: '))


if __name__ == '__main__':
    unittest.main()
