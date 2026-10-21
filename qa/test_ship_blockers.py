"""Release blocker regressions. Synthetic state only; no live CLI/provider calls."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch
import zipfile

import authoring_toolkit as toolkit
import collection_revision as revision
import library
import server
import wisdom
from qa import test_pinned_revision as fixtures
from qa.authoring_fixture import fixture
from tools.author_collection import Target, export_collection


class Blockers(unittest.TestCase):
    c: sqlite3.Connection
    chapter: str
    p: Path
    raw: bytes
    new: bytes
    bundle: dict
    setUp = fixtures.StateCase.setUp
    tearDown = fixtures.StateCase.tearDown
    args = fixtures.StateCase.args
    apply_args = fixtures.StateCase.apply_args

    def body(self, chapter=None):
        return next(e for e in wisdom.catalog()['entries'] if e['id'] == (chapter or self.chapter))

    def quote(self, chapter=None, text='Quiet attention', **changes):
        e = self.body(chapter)
        return dict({'action': 'add', 'entry_id': e['id'], 'start': 0, 'end': len(text),
                     'text': text, 'body_sha256': e['body_sha256']}, **changes)

    def revise(self, raw=None, old=None):
        p = revision.preview(self.c, self.args(raw, old))
        revision.apply(self.c, self.apply_args(p))
        return p

    def test_stale_A_after_B_then_C_and_legacy_rejection_preserve_state(self):
        a = self.quote()
        initial = wisdom.highlight(self.c, a)
        wisdom.react(self.c, {'kind': 'entry', 'id': self.chapter, 'field': 'saved', 'value': True})
        self.c.commit()
        p = self.revise()
        self.c.execute('UPDATE wisdom_highlight_history SET reason=? WHERE seq=?', ('Owner note retained', initial['id']))
        self.c.commit()
        before = [tuple(r) for r in self.c.execute('SELECT * FROM wisdom_highlight_history')]
        current_b = self.quote(text='Completely different text.')
        legacy = {k: v for k, v in a.items() if k != 'body_sha256'}
        for rejected in (a, legacy, dict(a, body_sha256=current_b['body_sha256'])):
            with self.assertRaisesRegex(ValueError, 'edition|absent'):
                wisdom.highlight(self.c, rejected)
        b = wisdom.highlight(self.c, current_b)
        third = fixtures.altered(self.new, lambda f: f.update({'content/' + self.chapter + '.md': b'Third edition only.'}))
        self.revise(third, p['new_sha256'])
        rows = {r['seq']: dict(r) for r in self.c.execute('SELECT * FROM wisdom_highlight_history')}
        self.assertEqual(tuple(self.c.execute('SELECT * FROM wisdom_highlight_history WHERE seq=?', (initial['id'],)).fetchone()), before[0])
        self.assertEqual(rows[b['id']]['source_body_sha256'], current_b['body_sha256'])
        self.assertNotIn(a['text'], rows[b['id']]['source_body'])
        self.assertEqual(len(wisdom.highlights(self.c)), 2)
        self.assertTrue(all(h['anchor_status'] == 'unresolved' for h in wisdom.highlights(self.c)))
        self.assertEqual(self.c.execute('SELECT saved FROM wisdom_reactions WHERE id=?', (self.chapter,)).fetchone()[0], 1)

    def test_unchanged_body_digest_survives_revision_but_missing_identity_fails(self):
        q = self.quote(chapter='new-study-second')
        self.revise()
        self.assertEqual(self.body('new-study-second')['body_sha256'], q['body_sha256'])
        self.assertEqual(wisdom.highlight(self.c, q)['highlights'][0]['anchor_status'], 'current')
        with self.assertRaisesRegex(ValueError, 'edition required'):
            wisdom.highlight(self.c, {k: v for k, v in q.items() if k != 'body_sha256'})
        # Metadata cannot spoof the actual body digest returned to a reader.
        forged = fixtures.altered(self.new, lambda f: fixtures.edit_catalog(f, lambda d: d['entries'][0].update(body_sha256='0' * 64)))
        self.revise(forged, hashlib.sha256(self.new).hexdigest())
        for e in wisdom.catalog()['entries']:
            self.assertEqual(e['body_sha256'], hashlib.sha256(e['body'].encode()).hexdigest())

    def test_quote_presence_handles_rendered_markdown_and_rejects_absent_text(self):
        body = '## Heading\n\n**Bold.** Café and [linked *literal*](https://example.org).\n\n- first\n- second\n\n> Quoted\n> line'
        for quote in ('Bold. Café and linked *literal*.', 'first\n\nsecond', 'Quotedline'):
            self.assertTrue(wisdom.quote_in_body(quote, body), quote)
        self.assertFalse(wisdom.quote_in_body('Absent forged quotation', body))

    def test_concurrent_add_holds_revision_until_committed_then_snapshots_A(self):
        q = self.quote()
        p = revision.preview(self.c, self.args())
        entered, release, attempting, done = (threading.Event() for _ in range(4))
        results, errors = {}, []
        original = wisdom._highlight
        def paused(c, d):
            result = original(c, d)
            entered.set()
            if not release.wait(5):
                raise RuntimeError('Test synchronization timed out')
            return result
        def add():
            try:
                with server.db() as c:
                    results['highlight'] = wisdom.highlight(c, q)
            except BaseException as e:
                errors.append(e)
        def apply():
            attempting.set()
            try:
                with server.db() as c:
                    results['revision'] = revision.apply(c, self.apply_args(p))
            except BaseException as e:
                errors.append(e)
            finally:
                done.set()
        with patch.object(wisdom, '_highlight', side_effect=paused):
            t1 = threading.Thread(target=add); t1.start()
            try:
                self.assertTrue(entered.wait(5))
                t2 = threading.Thread(target=apply); t2.start()
                self.assertTrue(attempting.wait(5))
                self.assertFalse(done.wait(.1), 'Revision escaped highlight mutation lock')
            finally:
                release.set(); t1.join(5)
                if 't2' in locals(): t2.join(5)
        self.assertFalse(errors, errors)
        row = self.c.execute('SELECT * FROM wisdom_highlight_history').fetchone()
        self.assertEqual(row['source_body_sha256'], q['body_sha256'])
        self.assertEqual(row['original_text'], q['text'])
        self.assertEqual(wisdom.highlights(self.c)[0]['anchor_status'], 'unresolved')

    def test_concurrent_revision_first_rechecks_A_after_waiting(self):
        q = self.quote()
        p = revision.preview(self.c, self.args())
        attempted, done = threading.Event(), threading.Event()
        errors = []
        def add():
            attempted.set()
            try:
                with server.db() as c: wisdom.highlight(c, q)
            except ValueError as e: errors.append(str(e))
            finally: done.set()
        with library.LOCK:
            t = threading.Thread(target=add); t.start()
            self.assertTrue(attempted.wait(5))
            self.assertFalse(done.wait(.1))
            revision.apply(self.c, self.apply_args(p))
        t.join(5)
        self.assertTrue(done.is_set())
        self.assertEqual(len(errors), 1)
        self.assertIn('edition changed', errors[0])
        self.assertEqual(wisdom.highlights(self.c), [])

    def test_directory_fsync_precedes_pointer_commit_and_retry(self):
        events = []
        real = revision.os.fsync
        def fsync(fd):
            events.append(('dir' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file', None))
            return real(fd)
        self.c.set_trace_callback(lambda sql: events.append(('sql', sql)))
        with patch.object(revision.os, 'fsync', side_effect=fsync):
            p = revision.preview(self.c, self.args())
            commit = next(i for i, e in enumerate(events) if e == ('sql', 'COMMIT'))
            self.assertGreaterEqual(sum(e[0] == 'dir' for e in events[:commit]), 5)
            self.assertEqual(events[0][0] in ('sql', 'file'), True)
            events.clear()
            revision.apply(self.c, self.apply_args(p))
            pointer = next(i for i, e in enumerate(events) if e[0] == 'sql' and e[1].startswith('UPDATE wisdom_bundles'))
            self.assertGreaterEqual(sum(e[0] == 'dir' for e in events[:pointer]), 4)
            self.assertIn(('file', None), events[:pointer])
        self.c.set_trace_callback(None)
        self.assertTrue(revision.edition_path('new-study', p['new_sha256']).exists())
        self.assertEqual((library.root() / 'new-study/bundle.zip').read_bytes(), self.raw)

    def test_fsync_failure_does_not_commit_preview_or_apply(self):
        with patch.object(revision, 'sync_directory', side_effect=OSError('synthetic fsync failure')):
            with self.assertRaises(OSError): revision.preview(self.c, self.args())
        self.assertEqual(self.c.execute('SELECT count(*) FROM wisdom_revision_previews').fetchone()[0], 0)
        p = revision.preview(self.c, self.args())
        with patch.object(revision, 'sync_directory', side_effect=OSError('synthetic fsync failure')):
            with self.assertRaises(OSError): revision.apply(self.c, self.apply_args(p))
        self.assertEqual(library.list_bundles(self.c)[0]['sha256'], self.bundle['sha256'])
        self.assertEqual(self.c.execute('SELECT applied FROM wisdom_revision_previews').fetchone()[0], 0)
        self.assertEqual(wisdom.highlights(self.c), [])

    def http(self):
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True); thread.start()
        self.addCleanup(lambda: (http.shutdown(), http.server_close(), thread.join()))
        return 'http://127.0.0.1:' + str(http.server_port)

    def test_highlight_http_mcp_stale_and_current(self):
        target = Target(self.http(), 'mcp')
        q = self.quote()
        self.revise()
        with self.assertRaises(ValueError): target.call('', tool='wisdom_highlight', args=q)
        legacy = {k: v for k, v in q.items() if k != 'body_sha256'}
        with self.assertRaises(ValueError): target.call('', tool='wisdom_highlight', args=legacy)
        current = self.quote(text='Completely different text.')
        out = target.call('', tool='wisdom_highlight', args=current)
        self.assertEqual(out['highlights'][0]['anchor_status'], 'current')
        self.assertEqual(target.call('', tool='wisdom_state')['highlights'], out['highlights'])

    def test_installed_skill_only_download_all_dependencies_and_synthetic_author(self):
        endpoint = self.http()
        installed = self.p / 'fresh-agent'; installed.mkdir()
        # Exactly WAM's installed artifact; no adjacent docs or repo on PYTHONPATH.
        shutil.copyfile('skill/SKILL.md', installed / 'SKILL.md')
        skill = (installed / 'SKILL.md').read_text()
        bootstrap = re.search(r'```python\n(# wisdom-toolkit-bootstrap-v1.*?)\n```', skill, re.S)[1]
        script = installed / 'fetch_toolkit.py'; script.write_text(bootstrap)
        dest = installed / 'toolkit'
        env = dict(os.environ, PYTHONPATH='', PYTHONNOUSERSITE='1', WISDOM_ENDPOINT=endpoint, WISDOM_TOOLKIT_DIR=str(dest))
        run = subprocess.run([sys.executable, str(script)], cwd=installed, env=env, text=True, capture_output=True, timeout=10)
        self.assertEqual(run.returncode, 0, run.stderr)
        receipt = json.loads(run.stdout)
        c = Target(endpoint, 'mcp').call('', tool='wisdom_authoring_contract')
        self.assertEqual(receipt['toolkit_sha256'], c['toolkit']['sha256'])
        self.assertEqual(receipt['files'], sorted(toolkit.FILES))
        # Transport corruption and a mid-flight release change both fail before
        # any downloaded executable file is written or imported.
        good_download = toolkit.download
        for field, bad in (('zip_base64', base64.b64encode(b'corrupt').decode()), ('contract_sha256', '0' * 64)):
            def wrong_response(data, field=field, bad=bad):
                return dict(good_download(data), **{field: bad})
            failed_dest = installed / ('rejected-' + field)
            with patch.object(toolkit, 'download', side_effect=wrong_response):
                rejected = subprocess.run([sys.executable, str(script)], cwd=installed,
                    env=dict(env, WISDOM_TOOLKIT_DIR=str(failed_dest)), text=True, capture_output=True, timeout=10)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertFalse(failed_dest.exists())
        for f in c['toolkit']['files']:
            self.assertEqual(hashlib.sha256((dest / f['path']).read_bytes()).hexdigest(), f['sha256'])
        for name, text in c['documentation'].items():
            self.assertEqual((dest / name).read_text(), text)
        for name in ('author_collection', 'author_chapter'):
            help_run = subprocess.run([sys.executable, 'tools/' + name + '.py', '--help'], cwd=dest, env=env, text=True, capture_output=True)
            self.assertEqual(help_run.returncode, 0, help_run.stderr)
        # The pre-existing synthetic invocation checks strict model usage, formatting,
        # rejected raw-output retention and receipt hashes, now using downloaded code.
        # Copy only this test method's source, never imports from the source checkout.
        import inspect
        method = inspect.getsource(fixtures.AuthorContract.test_format_quotes_sources_and_runner_receipt)
        check = ('import unittest, json, hashlib, tempfile, subprocess, os\nfrom pathlib import Path\nfrom unittest.mock import patch\n'
                 'import authoring_contract as policy\nfrom tools.author_chapter import author\n'
                 'class Synthetic(unittest.TestCase):\n' + method + '\nunittest.main()\n')
        (dest / 'synthetic_check.py').write_text(check)
        run = subprocess.run([sys.executable, 'synthetic_check.py'], cwd=dest, env=env, text=True, capture_output=True, timeout=10)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        # Export a synthetic document using only the downloaded helper/dependencies.
        fixture(installed / 'input')
        run = subprocess.run([sys.executable, 'tools/author_collection.py', 'export', '--source', str(installed / 'input'), '--collection', 'new-study', '--output', str(installed / 'document.zip'), '--license', 'Synthetic', '--attribution', 'QA'], cwd=dest, env=env, text=True, capture_output=True, timeout=10)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        library.inspect_bundle((installed / 'document.zip').read_bytes())

    def test_toolkit_deterministic_stale_allowlist_import_separation(self):
        c, raw = toolkit.snapshot()
        self.assertEqual(toolkit.snapshot(), (c, raw))
        request = {'contract_sha256': c['contract_sha256'], 'toolkit_sha256': c['toolkit']['sha256']}
        self.assertEqual(base64.b64decode(toolkit.download(request)['zip_base64']), raw)
        for key in request:
            with self.assertRaisesRegex(ValueError, 'Stale'):
                toolkit.download(dict(request, **{key: '0' * 64}))
        with self.assertRaises(ValueError): toolkit.download(dict(request, path='../../secret'))
        for name in toolkit.FILES:
            malicious = fixtures.altered(self.raw, lambda f: f.update({name: b'print("untrusted")'}))
            with self.assertRaises(ValueError): library.stage(self.c, malicious)
        # A normal approved document import is independent of executable release bytes.
        fixture(self.p / 'another', 'another')
        library.stage(self.c, export_collection(self.p / 'another', 'another', license='QA', attribution='QA'))
        self.assertEqual(toolkit.snapshot(), (c, raw))
        target = Target(self.http(), 'mcp')
        self.assertEqual(target.call('', tool='wisdom_authoring_toolkit', args=request), toolkit.download(request))
        with self.assertRaises(ValueError):
            target.call('', tool='wisdom_authoring_toolkit', args=dict(request, toolkit_sha256='0' * 64))


if __name__ == '__main__':
    unittest.main()
