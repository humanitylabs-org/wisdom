"""Passage notes: set, clear, merge-preserving, validation, MCP and pre-note databases."""
import json, os, pathlib, re, sqlite3, tempfile, unittest
from unittest.mock import patch
import library, mcp_api, server, starter, wisdom
from qa.test_portable import bundle

ENTRY = 'example-chapter'  # synthetic CC0 fixture from qa.test_portable


class Notes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.p = pathlib.Path(self.tmp.name)
        self.env = patch.dict(os.environ, {'WISDOM_DATA': str(self.p / 'data'), 'WISDOM_LIBRARY': str(self.p / 'media'),
                                           'WISDOM_STARTER_DIR': str(self.p / 'no-starter')})
        self.env.start(); self.data = patch.object(server, 'DATA', self.p / 'data'); self.data.start()
        server.init()
        with library.LOCK, server.db() as c:
            staged = library.stage(c, bundle())
            library.approve_source(c, staged, 'qa:synthetic')
            library.action(c, {'id': staged['id'], 'action': 'enable'})
            c.commit()
        with server.db() as c:
            self.entry = next(e for e in wisdom.catalog()['entries'] if e['id'] == ENTRY)
        words = re.findall(r'[A-Za-z]{4,}', self.entry['body'])
        self.a, self.b = words[10], words[30]

    def tearDown(self):
        self.data.stop(); self.env.stop(); self.tmp.cleanup()

    def call(self, d):
        with server.db() as c:
            out = wisdom.highlight(c, d); c.commit(); return out

    def add(self, text, start, end, **extra):
        return self.call(dict(action='add', entry_id=ENTRY, start=start, end=end, text=text,
                              body_sha256=self.entry['body_sha256'], **extra))

    def note_of(self, out, hid):
        return next(h for h in out['highlights'] if h['id'] == hid)['note']

    def test_add_with_note_then_edit_and_clear(self):
        out = self.add(self.a, 0, 5, note='  Why does this land?  ')
        hid = out['id']; self.assertEqual(self.note_of(out, hid), 'Why does this land?')
        out = self.call({'action': 'note', 'id': hid, 'note': 'Edited thought'})
        self.assertEqual(self.note_of(out, hid), 'Edited thought')
        out = self.call({'action': 'note', 'id': hid, 'note': ''})
        self.assertEqual(self.note_of(out, hid), '')
        self.assertEqual(next(h for h in out['highlights'] if h['id'] == hid)['text'], self.a)

    def test_plain_highlight_has_empty_note_and_legacy_payload_still_works(self):
        out = self.add(self.a, 0, 5); self.assertEqual(self.note_of(out, out['id']), '')

    def test_merge_keeps_every_note_in_passage_order(self):
        first = self.add(self.a, 0, 5, note='First')['id']
        second = self.add(self.b, 10, 15, note='Second')['id']
        out = self.add(self.a, 0, 15, note='Third')
        self.assertEqual(len(out['highlights']), 1); self.assertEqual(out['merged'], 2)
        self.assertEqual(self.note_of(out, out['id']), 'First\n\nSecond\n\nThird')
        # Extending again with no new note keeps the combined note unchanged, without duplication.
        again = self.add(self.a, 0, 20)
        self.assertEqual(self.note_of(again, again['id']), 'First\n\nSecond\n\nThird')
        self.assertNotIn(first, [h['id'] for h in again['highlights']]); self.assertNotIn(second, [h['id'] for h in again['highlights']])

    def test_validation(self):
        hid = self.add(self.a, 0, 5)['id']
        for bad in ({'action': 'note', 'id': hid}, {'action': 'note', 'id': str(hid), 'note': 'x'},
                    {'action': 'note', 'id': hid, 'note': 5}, {'action': 'note', 'id': hid, 'note': 'x' * 8001},
                    {'action': 'note', 'id': 99999, 'note': 'x'}, {'action': 'note', 'id': hid, 'note': 'x', 'extra': 1}):
            with self.assertRaises(ValueError, msg=bad): self.call(bad)
        with self.assertRaises(ValueError): self.add(self.a, 0, 5, note=['x'])
        with server.db() as c:
            self.assertEqual(c.execute('SELECT note FROM wisdom_highlights WHERE seq=?', (hid,)).fetchone()[0], '')

    def test_remove_deletes_the_note_with_its_highlight(self):
        hid = self.add(self.a, 0, 5, note='Gone')['id']
        self.assertEqual(self.call({'action': 'remove', 'id': hid})['highlights'], [])

    def test_mcp_note_action(self):
        hid = self.add(self.a, 0, 5)['id']
        status, out = mcp_api.dispatch({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                                        'params': {'name': 'wisdom_highlight', 'arguments': {'action': 'note', 'id': hid, 'note': 'Via MCP'}}})
        self.assertFalse(out['result']['isError'], out)
        self.assertEqual(self.note_of(json.loads(out['result']['content'][0]['text']), hid), 'Via MCP')
        tool = next(t for t in mcp_api.TOOLS if t['name'] == 'wisdom_highlight')
        self.assertIn('note', tool['inputSchema']['properties']['action']['enum'])

    def test_pre_note_database_upgrades_in_place(self):
        with server.db() as c:
            c.execute('DROP TABLE wisdom_highlights')
            c.execute('CREATE TABLE wisdom_highlights(seq INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL)')
            c.execute("INSERT INTO wisdom_highlights(entry_id,start,end,text,created_at) VALUES ('example-chapter',0,5,?,'old')", (self.a,)); c.commit()
        server.init()
        with server.db() as c:
            h = wisdom.state(c)['highlights']
        self.assertEqual([(x['text'], x['note'], x['created_at']) for x in h], [(self.a, '', 'old')])


if __name__ == '__main__':
    unittest.main()
