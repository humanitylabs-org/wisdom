"""Authoring contracts run on the remote worker, never against daily state."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest import mock

import library
from tools import author_collection as bridge
from qa.authoring_fixture import fixture, JPEG, write_json


class Authoring(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root / 'source'
        self.catalog = fixture(self.source)

    def tearDown(self):
        self.tmp.cleanup()

    def export(self, **kwargs):
        return bridge.export_collection(self.source, 'new-study', license='Private/unknown',
                                        attribution='Synthetic QA text and art', **kwargs)

    def change(self, edit):
        edit(self.catalog)
        write_json(self.source / 'content/catalog.json', self.catalog)

    def test_confined_deterministic_importer_compatible(self):
        first = self.export()
        self.assertEqual(first, self.export())
        manifest, catalog, files = library.inspect_bundle(first)
        self.assertEqual(manifest['rights'], 'private')
        self.assertEqual([e['id'] for e in catalog['entries']], self.catalog['collections'][0]['entries'])
        self.assertEqual(len(catalog['collections']), 1)
        self.assertEqual(len(catalog['thinkers']), 1)
        self.assertEqual(set(json.loads(files['content/glosses.json'])), {'道'})
        self.assertEqual(files['art/p/new-study-author.jpg'], JPEG)
        self.assertIn('Café', files['content/new-study-first.md'].decode())
        self.assertFalse(any('unrelated' in name for name in files))
        self.assertFalse(any(b'NOT SELECTED' in value for value in files.values()))

    def test_explicit_selection_and_rights(self):
        for selection in ('missing', '../new-study', 'New-study', ''):
            with self.assertRaises(ValueError):
                bridge.export_collection(self.source, selection, license='Private', attribution='Synthetic')
        for kwargs in ({'license': ''}, {'attribution': ''}, {'rights': 'public'}):
            values = dict(license='Private', attribution='Synthetic', rights='private')
            values.update(kwargs)
            with self.assertRaises(ValueError):
                bridge.export_collection(self.source, 'new-study', **values)

    def test_sections_order_overview_and_duplicates(self):
        for edit in (lambda d: d['collections'][0].update(entries=['new-study-first']),
                     lambda d: d['collections'][0].update(overview='missing'),
                     lambda d: d['collections'][0].update(sections=[], entries=['new-study-first'] * 2)):
            self.catalog = fixture_reset(self.source)
            self.change(edit)
            with self.assertRaises(ValueError):
                self.export()

    def test_missing_chapter_or_thinker_no_partial_output(self):
        (self.source / 'content/new-study-first.md').unlink()
        with self.assertRaises(ValueError):
            self.export()
        self.change(lambda d: d['entries'][0].update(thinker='missing'))
        with self.assertRaises(ValueError):
            self.export()
        self.assertFalse((self.root / 'bundle.zip').exists())

    def test_symlink_leaf_ancestor_and_root_rejected(self):
        chapter = self.source / 'content/new-study-first.md'
        copy = self.root / 'outside.md'
        copy.write_bytes(chapter.read_bytes())
        chapter.unlink()
        chapter.symlink_to(copy)
        with self.assertRaises(OSError):
            self.export()
        chapter.unlink()
        chapter.write_bytes(copy.read_bytes())
        (self.source / 'content').rename(self.source / 'real-content')
        (self.source / 'content').symlink_to(self.source / 'real-content', target_is_directory=True)
        with self.assertRaises(OSError):
            self.export()
        link = self.root / 'linked-source'
        link.symlink_to(self.source, target_is_directory=True)
        with self.assertRaises(OSError):
            bridge.export_collection(link, 'new-study', license='Private', attribution='Synthetic')

    def test_symlink_optional_art_and_gloss_rejected(self):
        for relative in ('content/glosses.json', 'static/wisdom-art/p/new-study-author.jpg'):
            self.catalog = fixture_reset(self.source)
            file = self.source / relative
            copy = self.root / 'copy'
            copy.write_bytes(file.read_bytes())
            file.unlink()
            file.symlink_to(copy)
            with self.assertRaises(OSError):
                self.export()

    def test_metadata_url_and_external_references_rejected(self):
        for edit in (lambda d: d['entries'][0].update(source_url='javascript:alert(1)'),
                     lambda d: d['entries'][0].update(part=True),
                     lambda d: d['entries'][0].update(initial_read='false'),
                     lambda d: d['entries'][0].update(dive_of='unrelated-chapter'),
                     lambda d: d['entries'][0].update(published_at='yesterday'),
                     lambda d: d['collections'][0].update(secret_path='/private/path'),
                     lambda d: d['thinkers'].append(d['thinkers'][0]),
                     lambda d: d['collections'][0]['sections'][0].update(title=[])):
            self.catalog = fixture_reset(self.source)
            self.change(edit)
            with self.assertRaises(ValueError):
                self.export()

    def test_invalid_json_and_gloss_and_jpeg(self):
        for relative, payload in (('content/catalog.json', b'{"entries":[],"entries":[]}'),
                                  ('content/glosses.json', '{"道":{"en":42}}'.encode('utf-8')),
                                  ('static/wisdom-art/p/new-study-author.jpg', b'not jpeg')):
            self.catalog = fixture_reset(self.source)
            (self.source / relative).write_bytes(payload)
            with self.assertRaises(ValueError):
                self.export()

    def test_oversize_and_special_source_files(self):
        chapter = self.source / 'content/new-study-first.md'
        chapter.write_bytes(b'x' * (bridge.LIMIT + 1))
        with self.assertRaises(ValueError):
            self.export()
        chapter.unlink()
        os.mkfifo(chapter)
        with self.assertRaises(ValueError):
            self.export()

    def test_output_retry_no_overwrite_and_symlink_rejected(self):
        destination = self.root / 'bundle.zip'
        raw = self.export()
        self.assertTrue(bridge.save_bundle(destination, raw))
        self.assertFalse(bridge.save_bundle(destination, self.export()))
        with self.assertRaises(ValueError):
            bridge.save_bundle(destination, b'changed')
        self.assertEqual(destination.read_bytes(), raw)
        link = self.root / 'link.zip'
        link.symlink_to(destination)
        with self.assertRaises(OSError):
            bridge.save_bundle(link, raw)
        self.assertEqual(destination.stat().st_mode & 0o777, 0o600)

    def test_actual_importer_retry_and_reserved_thinker_collision(self):
        with mock.patch.dict(os.environ, {'WISDOM_LIBRARY': str(self.root / 'library')}):
            with sqlite3.connect(self.root / 'test.sqlite') as conn:
                conn.row_factory = sqlite3.Row
                library.init(conn)
                raw = self.export()
                one = library.stage(conn, raw)
                self.assertEqual(library.stage(conn, self.export()), one)
                library.action(conn, {'id': 'new-study', 'action': 'enable'})
                self.assertEqual(len(library.catalog(conn)['entries']), 3)
                self.change(lambda d: d['collections'][0].update(id='another-study'))
                collision = bridge.export_collection(self.source, 'another-study', license='Private', attribution='Synthetic')
                with self.assertRaisesRegex(ValueError, 'collides'):
                    library.stage(conn, collision)
                self.assertEqual(len(library.list_bundles(conn)), 1)
                library.action(conn, {'id': 'new-study', 'action': 'disable'})
                with self.assertRaisesRegex(ValueError, 'collides'):
                    library.stage(conn, collision)

    def test_changed_same_bundle_requires_revision(self):
        with mock.patch.dict(os.environ, {'WISDOM_LIBRARY': str(self.root / 'library')}):
            with sqlite3.connect(self.root / 'test.sqlite') as conn:
                conn.row_factory = sqlite3.Row
                library.init(conn)
                library.stage(conn, self.export())
                (self.source / 'content/new-study-first.md').write_text('# Changed\n')
                with self.assertRaisesRegex(ValueError, 'revisions need an explicit migration'):
                    library.stage(conn, self.export())
                self.assertEqual(len(library.list_bundles(conn)), 1)

    def test_endpoint_credentials_and_redirects_rejected(self):
        for endpoint in ('file:///etc', 'https://user:password@example.org',
                         'https://example.org?token=value', 'https://example.org#fragment'):
            with self.assertRaises(ValueError):
                bridge.Target(endpoint)
        self.assertIsNone(bridge.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example'))


def fixture_reset(source):
    import shutil
    shutil.rmtree(source)
    return fixture(source)


if __name__ == '__main__':
    unittest.main()
