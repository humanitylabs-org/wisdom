"""Synthetic reproductions of staged export and earlier-edition highlight gates."""
import hashlib
import json
import unittest
import urllib.request

import collection_export
import library
import server
from qa import test_portable
from qa.test_shared_thinkers import shared, OTHER_JPEG
from qa.authoring_fixture import JPEG

# Matches the offline migration contract. No personal text or snapshots belong here.
HISTORY_SCHEMA = '''CREATE TABLE IF NOT EXISTS wisdom_highlight_history (
 seq INTEGER PRIMARY KEY, entry_id TEXT NOT NULL,
 original_start INTEGER NOT NULL, original_end INTEGER NOT NULL,
 original_text TEXT NOT NULL, source_body TEXT NOT NULL,
 source_body_sha256 TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('unresolved','reanchored')),
 reason TEXT NOT NULL)'''
REASON = 'Earlier edition — passage not present in current text'


def seed_history(c):
    c.execute(HISTORY_SCHEMA)
    ids = []
    for i in range(4):
        quote = 'Earlier synthetic passage number ' + str(i + 1) + ' is preserved.'
        source = ' ' * (i * 30) + quote + '\nPRIVATE_SYNTHETIC_OLD_BODY'
        start, end = i * 30, i * 30 + len(quote)
        seq = c.execute('INSERT INTO wisdom_highlights(entry_id,start,end,text,created_at) VALUES (?,?,?,?,?)',
                        ('example-chapter', start, end, quote, '2025-01-01T00:00:00Z')).lastrowid
        c.execute('INSERT INTO wisdom_highlight_history VALUES (?,?,?,?,?,?,?,?,?)',
                  (seq, 'example-chapter', start, end, quote, source,
                   hashlib.sha256(source.encode()).hexdigest(), 'unresolved', REASON))
        ids.append(seq)
    return ids


class ReleaseGates(unittest.TestCase):
    url: str
    setUp = test_portable.Portable.setUp
    tearDown = test_portable.Portable.tearDown
    call = test_portable.Portable.call
    install = test_portable.Portable.install

    def export(self, key):
        code, preview = self.call('/api/library/export/preview', {'id': key})
        self.assertEqual(code, 200, preview)
        req = urllib.request.Request(self.url + '/api/library/export',
            data=json.dumps({'id': key, 'sha256': preview['sha256'], 'confirm': True}).encode(),
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as response:
            raw = response.read()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), preview['sha256'])
        return preview, library.inspect_bundle(raw)[2]

    def test_shared_export_never_inherits_staged_private_portrait(self):
        with server.db() as c:
            target = library.stage(c, shared('target'))
            library.action(c, {'id': 'target', 'action': 'enable'})
            library.set_collection_scope(c, 'target', 'target-collection', expected_sha256=target['sha256'],
                                         scope='shared', provenance='operator-reviewed')
            private = library.stage(c, shared('private', portrait=OTHER_JPEG))
            self.assertEqual(private['status'], 'staged')
            self.assertEqual(library.collection_scope(c, private, 'private-collection')['library_scope'], 'private')
        state = self.call('/api/wisdom')[1]
        self.assertEqual(state['collections'][0]['library_scope'], 'shared')
        self.assertIsNone(state['thinkers'][0]['portrait'])
        preview, files = self.export('target-collection')
        self.assertEqual(preview['library_scope'], 'shared')
        self.assertNotIn('art/p/shared-author.jpg', {f['name'] for f in preview['files']})
        self.assertNotIn('art/p/shared-author.jpg', files)
        self.assertNotIn(OTHER_JPEG, files.values())

    def test_enabled_disabled_removed_portrait_policy_retained(self):
        with server.db() as c:
            library.stage(c, shared('target')); library.action(c, {'id': 'target', 'action': 'enable'})
            library.stage(c, shared('donor', portrait=JPEG)); library.action(c, {'id': 'donor', 'action': 'enable'})
        for action in ('enable', 'disable', 'remove'):
            with self.subTest(action=action):
                self.call('/api/library/action', {'id': 'donor', 'action': action})
                self.assertIsNotNone(self.call('/api/wisdom')[1]['thinkers'][0]['portrait'])
                preview, files = self.export('target-collection')
                self.assertIn('art/p/shared-author.jpg', {f['name'] for f in preview['files']})
                self.assertEqual(files['art/p/shared-author.jpg'], JPEG)

    def test_default_history_schema_is_safe_and_init_idempotent(self):
        with server.db() as c:
            fields = {r[1] for r in c.execute('PRAGMA table_info(wisdom_highlight_history)')}
            self.assertEqual(fields, {'seq', 'entry_id', 'original_start', 'original_end', 'original_text',
                                      'source_body', 'source_body_sha256', 'status', 'reason'})
            c.execute('INSERT INTO wisdom_highlight_history(seq,entry_id,original_start,original_end,original_text,source_body,source_body_sha256) VALUES (1,?,?,?,?,?,?)',
                      ('example-chapter', 0, 3, 'Old', 'Old', hashlib.sha256(b'Old').hexdigest()))
            self.assertEqual(c.execute('SELECT status FROM wisdom_highlight_history').fetchone()[0], 'unresolved')
        server.init()
        with server.db() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM wisdom_highlight_history').fetchone()[0], 1)

    def test_history_api_overlap_restart_export_and_explicit_delete(self):
        self.install()
        with server.db() as c:
            # Exercise the exact pre-existing migration table, without new defaults.
            c.execute('DROP TABLE wisdom_highlight_history')
            ids = seed_history(c)
            original = [tuple(r) for r in c.execute('SELECT * FROM wisdom_highlight_history ORDER BY seq')]
        server.init()
        state = self.call('/api/wisdom')[1]
        self.assertEqual(len(state['highlights']), 4)
        for row in state['highlights']:
            self.assertEqual(row['anchor_status'], 'unresolved')
            self.assertEqual(row['reason'], REASON)
            self.assertNotIn('source_body', row)
        payload = {'action': 'add', 'entry_id': 'example-chapter', 'start': 0, 'end': 140, 'text': 'Quiet attention', 'body_sha256': state['entries'][0]['body_sha256']}
        code, added = self.call('/api/wisdom/highlight', payload)
        self.assertEqual(code, 200)
        self.assertEqual(added['merged'], 0)
        self.assertEqual(len(added['highlights']), 5)
        self.assertEqual(added['highlights'][0]['anchor_status'], 'current')
        # Current anchors still merge normally, without touching the four old ones.
        added = self.call('/api/wisdom/highlight', dict(payload, end=141))[1]
        self.assertEqual(added['merged'], 1)
        self.assertEqual(len(added['highlights']), 5)
        with server.db() as c:
            self.assertEqual([tuple(r) for r in c.execute('SELECT * FROM wisdom_highlight_history ORDER BY seq')], original)
        _, files = self.export('example-collection')
        for marker in (b'PRIVATE_SYNTHETIC_OLD_BODY', b'Earlier synthetic passage', b'anchor_status', b'wisdom_highlight_history'):
            self.assertNotIn(marker, b'\n'.join(files.values()))
        for action in ('disable', 'remove', 'enable'):
            self.call('/api/library/action', {'id': 'example', 'action': action})
        server.init()
        self.assertEqual(len(self.call('/api/wisdom')[1]['highlights']), 5)
        code, removed = self.call('/api/wisdom/highlight', {'action': 'remove', 'id': ids[0]})
        self.assertEqual(code, 200); self.assertEqual(len(removed['highlights']), 4)
        with server.db() as c:
            self.assertEqual([tuple(r) for r in c.execute('SELECT * FROM wisdom_highlight_history ORDER BY seq')], original[1:])
        self.assertEqual(self.call('/api/wisdom/highlight', {'action': 'remove', 'id': ids[0]})[0], 400)


if __name__ == '__main__':
    unittest.main()
