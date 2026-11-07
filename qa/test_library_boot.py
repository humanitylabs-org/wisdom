"""Library-opening regressions; synthetic archives only, never owner content."""
import pathlib
import threading
import time
import unittest
from unittest.mock import patch
import library
import wisdom
import server
from qa import test_portable as portable
from qa.test_portable import bundle


class LibraryBoot(unittest.TestCase):
    setUp = portable.Portable.setUp
    tearDown = portable.Portable.tearDown
    call = portable.Portable.call

    def install_many(self):
        with server.db() as c:
            for n in range(6):
                b = library.stage(c, bundle('opening-'+str(n)))
                library.action(c, {'id': b['id'], 'action': 'enable'})

    def test_metadata_never_verifies_bodies_or_waits_for_library_lock(self):
        self.install_many()
        library.CACHE.clear()  # Actual byte LRU cold, verified navigation retained.
        held, release = threading.Event(), threading.Event()
        def busy():
            with library.LOCK:
                held.set()
                release.wait(5)
        t = threading.Thread(target=busy); t.start(); self.assertTrue(held.wait(1))
        try:
            with patch.object(library, 'package_files', side_effect=AssertionError('full-body barrier')):
                start = time.monotonic()
                code, result = self.call('/api/wisdom/metadata')
                elapsed = time.monotonic()-start
            self.assertEqual(code, 200); self.assertLess(elapsed, 0.5)
            self.assertEqual(len(result['collections']), 6)
            self.assertEqual(len(result['entries']), 6)
            self.assertTrue(result['metadata_only'])
            self.assertTrue(all('body' not in e and len(e['body_sha256']) == 64 for e in result['entries']))
        finally:
            release.set(); t.join(2)

    def test_chapter_verifies_only_its_owning_bundle(self):
        self.install_many(); library.CACHE.clear()
        with patch.object(library, 'package_files', wraps=library.package_files) as verified:
            code, chapter = self.call('/api/wisdom/chapter/opening-0-chapter')
        self.assertEqual(code, 200); self.assertEqual(chapter['id'], 'opening-0-chapter')
        self.assertIn('Quiet attention', chapter['body'])
        self.assertEqual([c.args[0]['id'] for c in verified.call_args_list], ['opening-0'])

    def test_changed_archive_cannot_reuse_navigation_or_readable_bytes(self):
        self.install_many()
        p = pathlib.Path(library.root())/'opening-0/bundle.zip'
        p.write_bytes(b'corrupted fixture')
        code, meta = self.call('/api/wisdom/metadata')
        self.assertEqual(code, 200)
        self.assertNotIn('opening-0-chapter', [e['id'] for e in meta['entries']])
        self.assertTrue(meta['notices'])
        self.assertEqual(self.call('/api/wisdom/chapter/opening-0-chapter')[0], 404)

    def test_full_state_no_duplicate_catalog_for_glosses(self):
        self.install_many()
        with server.db() as c, patch.object(wisdom, 'catalog', wraps=wisdom.catalog) as catalogs:
            full = wisdom.state(c)
        self.assertEqual(catalogs.call_count, 1)
        self.assertTrue(all('body' in e for e in full['entries']))

    def test_restart_rebuilds_verified_projection_before_serving(self):
        self.install_many(); library.NAVIGATION.clear(); library.CACHE.clear()
        server.init()
        with patch.object(library, 'package_files', side_effect=AssertionError('request verified full archive')):
            code, meta = self.call('/api/wisdom/metadata')
        self.assertEqual(code, 200); self.assertEqual(len(meta['entries']), 6)


if __name__ == '__main__':
    unittest.main()
