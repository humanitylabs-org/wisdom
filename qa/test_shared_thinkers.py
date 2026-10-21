"""Shared bundle-v1 thinkers; fixtures and all mutations are disposable."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

import library
from qa.test_portable import bundle
from qa.authoring_fixture import JPEG

THINKER = {'id': 'shared-author', 'name': 'Café 道', 'bio': 'Same person', 'rank': 1}
OTHER_JPEG = JPEG[:2] + b'\xff\xfe\x00\x05QA!' + JPEG[2:]


def shared(key, thinker=None, portrait=None, chapter=None, collection=None):
    def edit(m, d):
        d['thinkers'] = [dict(THINKER if thinker is None else thinker)]
        d['entries'][0]['thinker'] = 'shared-author'
        d['collections'][0]['thinker'] = 'shared-author'
        if chapter:
            d['entries'][0]['id'] = chapter
            d['collections'][0]['entries'] = [chapter]
        if collection:
            d['collections'][0]['id'] = collection
    extra = {'art/c/' + (chapter or key + '-chapter') + '.jpg': JPEG}
    if portrait is not None:
        extra['art/p/shared-author.jpg'] = portrait
    if chapter:
        extra['content/' + chapter + '.md'] = b'# Shared chapter\n\nSynthetic test.'
    # For a colliding chapter the generated old payload must be omitted.
    raw = bundle(key, extra=extra, edit=edit)
    if chapter:
        import io, zipfile
        out = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(raw)) as z, zipfile.ZipFile(out, 'w') as dest:
            for n in z.namelist():
                if n != 'content/' + key + '-chapter.md':
                    dest.writestr(n, z.read(n))
        raw = out.getvalue()
    return raw


class SharedThinkers(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_env = os.environ.get('WISDOM_LIBRARY')
        os.environ['WISDOM_LIBRARY'] = self.tmp.name
        self.c = sqlite3.connect(':memory:')
        self.c.row_factory = sqlite3.Row
        library.CACHE.clear()
        library.init(self.c)
        self.c.execute('CREATE TABLE retained_reading(id TEXT, progress INTEGER)')
        self.c.execute("INSERT INTO retained_reading VALUES ('a-chapter',41)")
        self.c.commit()

    def tearDown(self):
        self.c.close()
        library.CACHE.clear()
        self.tmp.cleanup()
        if self.old_env is None:
            os.environ.pop('WISDOM_LIBRARY', None)
        else:
            os.environ['WISDOM_LIBRARY'] = self.old_env

    def install(self, key, **kwargs):
        raw = shared(key, **kwargs)
        library.stage(self.c, raw)
        library.action(self.c, {'id': key, 'action': 'enable'})
        return raw

    def snapshot(self):
        return (list(self.c.iterdump()), {str(p.relative_to(library.root())):
            hashlib.sha256(p.read_bytes()).hexdigest() for p in library.root().rglob('*') if p.is_file()})

    def rejected_unchanged(self, raw, message):
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, message):
            library.stage(self.c, raw)
        self.assertEqual(self.snapshot(), before)

    def test_matching_metadata_canonical_keys_one_row_two_collections(self):
        self.install('a')
        self.install('b', thinker=dict(reversed(list(THINKER.items()))))
        d = library.catalog(self.c)
        self.assertEqual(d['thinkers'], [THINKER])
        self.assertEqual(len(d['entries']), 2)
        self.assertEqual(len(d['collections']), 2)
        self.assertTrue(all(e['thinker'] == 'shared-author' and e['body'] for e in d['entries']))

    def test_conflicting_metadata_is_atomic(self):
        self.install('a', portrait=JPEG)
        for value in (dict(THINKER, name='Different'), dict(THINKER, rank=True), dict(THINKER, extra='new')):
            self.rejected_unchanged(shared('b', thinker=value), 'metadata')

    def test_identical_portrait_bytes(self):
        self.install('a', portrait=JPEG)
        self.install('b', portrait=JPEG)
        self.assertEqual(library.art(self.c, 'p', 'shared-author'), JPEG)

    def test_conflicting_portrait_is_atomic_even_if_other_absent(self):
        self.assertTrue(library.jpeg_ok(OTHER_JPEG))
        self.install('a', portrait=JPEG)
        self.install('b')
        self.rejected_unchanged(shared('c', portrait=OTHER_JPEG), 'portrait')

    def test_optional_absent_portraits_both_and_each_direction(self):
        self.install('a')
        self.install('b')
        self.assertIsNone(library.art(self.c, 'p', 'shared-author'))
        self.install('c', portrait=JPEG)
        self.install('d')
        self.assertEqual(library.art(self.c, 'p', 'shared-author'), JPEG)

    def test_disable_remove_reenable_either_no_orphan_or_state_change(self):
        self.install('a', portrait=JPEG)
        self.install('b')
        reading = list(self.c.execute('SELECT * FROM retained_reading'))
        for key in ('a', 'b'):
            for action in ('disable', 'remove', 'enable'):
                library.action(self.c, {'id': key, 'action': action})
                d = library.catalog(self.c)
                self.assertEqual(len(d['thinkers']), 1)
                self.assertEqual(len(d['entries']), 2 if action == 'enable' else 1)
                self.assertEqual(library.art(self.c, 'p', 'shared-author'), JPEG)
                self.assertEqual(list(self.c.execute('SELECT * FROM retained_reading')), reading)
        for key in ('a', 'b'):
            library.action(self.c, {'id': key, 'action': 'remove'})
        self.assertEqual(library.catalog(self.c)['thinkers'], [])
        self.assertIsNone(library.art(self.c, 'p', 'shared-author'))

    def test_disabled_removed_metadata_and_portrait_still_reserved(self):
        self.install('a', portrait=JPEG)
        for action in ('disable', 'remove'):
            library.action(self.c, {'id': 'a', 'action': action})
            self.rejected_unchanged(shared('b', thinker=dict(THINKER, name='Different')), 'metadata')
            self.rejected_unchanged(shared('b', portrait=OTHER_JPEG), 'portrait')

    def test_chapter_and_collection_collisions_still_atomic(self):
        self.install('a')
        self.rejected_unchanged(shared('b', chapter='a-chapter'), 'collides')
        self.rejected_unchanged(shared('b', collection='a-collection'), 'collides')

    def test_bundle_revision_rejected_identical_retry_preserves_status(self):
        raw = self.install('a')
        self.assertEqual(library.stage(self.c, raw)['status'], 'enabled')
        library.action(self.c, {'id': 'a', 'action': 'remove'})
        self.assertEqual(library.stage(self.c, raw)['status'], 'removed')
        self.rejected_unchanged(shared('a', portrait=JPEG), 'revisions')

    def test_staged_portrait_invisible_and_chapter_art_never_inherited(self):
        self.install('a')
        library.stage(self.c, shared('b', portrait=JPEG))
        self.assertIsNone(library.art(self.c, 'p', 'shared-author'))
        self.assertEqual(len(library.catalog(self.c)['entries']), 1)
        library.action(self.c, {'id': 'b', 'action': 'enable'})
        self.assertEqual(library.art(self.c, 'p', 'shared-author'), JPEG)
        self.assertEqual(library.art(self.c, 'c', 'b-chapter'), JPEG)
        library.action(self.c, {'id': 'b', 'action': 'remove'})
        self.assertEqual(library.art(self.c, 'p', 'shared-author'), JPEG)
        self.assertIsNone(library.art(self.c, 'c', 'b-chapter'))

    def test_catalog_cache_not_mutated_and_corrupt_fallback_not_served(self):
        self.install('a', portrait=JPEG)
        self.install('b')
        d = library.catalog(self.c)
        d['thinkers'][0]['name'] = 'Mutation'
        d['entries'][0]['body'] = 'Mutation'
        self.assertEqual(library.catalog(self.c)['thinkers'], [THINKER])
        library.action(self.c, {'id': 'a', 'action': 'remove'})
        (library.root() / 'a/bundle.zip').write_bytes(b'corrupted')
        self.assertIsNone(library.art(self.c, 'p', 'shared-author'))
        self.assertEqual(len(library.catalog(self.c)['entries']), 1)


if __name__ == '__main__':
    unittest.main()
