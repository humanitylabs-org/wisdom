"""Narrow review regressions: transaction publication, clean enable error, bounded misses.
Synthetic archives/databases only. No owner state or model route.
"""
import concurrent.futures
import hashlib
import sqlite3
import threading
import unittest
from unittest.mock import patch

import collection_revision as revision
import library
from qa.test_pinned_revision import StateCase


class RevisionPublication(StateCase):
    # Reuse the owning exact revision fixture, not its inherited test suite.
    def test_publish_keeps_prior_snapshot_until_and_after_commit(self):
        self.c.execute('PRAGMA journal_mode=WAL')
        preview = revision.preview(self.c, self.args())
        original = library.remember_navigation
        observed = []
        def publish(*args, **kwargs):
            token = original(*args, **kwargs)
            with sqlite3.connect(self.p / 'data/wisdom.sqlite') as reader:
                reader.row_factory = sqlite3.Row
                bundle = library.list_bundles(reader)[0]
                observed.append(bundle['sha256'])
                nav = library.package_navigation(bundle)[1]
                self.assertTrue(any(e['id'] == self.chapter for e in nav['entries']))
            return token
        with patch.object(library, 'remember_navigation', publish):
            revision.apply(self.c, self.apply_args(preview))
        self.assertIn(self.bundle['sha256'], observed)
        library.package_navigation(self.bundle)  # previously captured DB snapshot remains valid
        library.package_navigation(library.list_bundles(self.c)[0])

    def test_commit_failure_retains_prior_projection_and_cleans_pending(self):
        self.c.execute('PRAGMA journal_mode=WAL')
        preview = revision.preview(self.c, self.args())
        class FailCommit:
            def __getattr__(_, key): return getattr(self.c, key)
            def commit(_): raise sqlite3.OperationalError('synthetic commit failure')
        before = set(library.NAVIGATION)
        with self.assertRaisesRegex(sqlite3.OperationalError, 'synthetic'):
            revision.apply(FailCommit(), self.apply_args(preview))
        self.assertEqual(before, set(library.NAVIGATION))
        library.package_navigation(self.bundle)
        self.assertEqual(library.list_bundles(self.c)[0]['sha256'], self.bundle['sha256'])

    def test_unreadable_enable_fails_cleanly_without_status_or_personal_state_write(self):
        library.action(self.c, {'id':'new-study','action':'disable'})
        before = list(self.c.iterdump())
        with patch.object(library, 'package_files', side_effect=FileNotFoundError('synthetic missing mount')):
            with self.assertRaisesRegex(ValueError, 'enable was not applied'):
                library.action(self.c, {'id':'new-study','action':'enable'})
        self.assertEqual(before, list(self.c.iterdump()))

    def test_miss_verifications_have_two_slots_independent_of_library_lock(self):
        # Same physical archive may be requested simultaneously after LRU eviction.
        library.CACHE.clear()
        count = 0; peak = 0; lock = threading.Lock(); two = threading.Event(); release = threading.Event()
        inspect = library.inspect_bundle
        def verify(raw):
            nonlocal count, peak
            with lock:
                count += 1; peak = max(peak, count)
                if count == 2: two.set()
            self.assertTrue(release.wait(3))
            try: return inspect(raw)
            finally:
                with lock: count -= 1
        with patch.object(library, 'inspect_bundle', verify), concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            with library.LOCK:
                futures = [pool.submit(library.package_files, self.bundle, navigation=False) for _ in range(6)]
                try:
                    self.assertTrue(two.wait(2), 'verification must progress while global LOCK held')
                    self.assertEqual(peak, 2)
                    library.package_navigation(self.bundle)  # no slot or byte verification
                finally: release.set()
            for f in futures: f.result(3)
        self.assertEqual(peak, 2)


# Do not accidentally rerun imported base tests under this module's discovery.
for name in list(vars(StateCase)):
    if name.startswith('test_') and name not in vars(RevisionPublication):
        setattr(RevisionPublication, name, None)
del StateCase
if __name__ == '__main__': unittest.main()
