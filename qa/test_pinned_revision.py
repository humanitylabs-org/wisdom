"""Synthetic focused authoring/revision tests. No model calls or owner data."""
import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

import authoring_contract as policy
import collection_revision as revision
import library
import mcp_api
import server
import wisdom
from qa.authoring_fixture import fixture
from tools.author_collection import export_collection, Target
from tools.author_chapter import author


def altered(raw, callback):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        files = {n: z.read(n) for n in z.namelist()}
    callback(files)
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, b in files.items():
            z.writestr(n, b)
    return out.getvalue()


def edit_catalog(files, fn):
    d = json.loads(files['content/catalog.json']); fn(d)
    files['content/catalog.json'] = json.dumps(d).encode()


class StateCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {'WISDOM_DATA': str(self.p / 'data'), 'WISDOM_LIBRARY': str(self.p / 'library'),
                                         'WISDOM_STARTER': 'disabled', 'WISDOM_LEGACY_QA': '0'})
        self.env.start()
        (self.p / 'data').mkdir()
        self.datapatch = patch.object(server, 'DATA', self.p / 'data'); self.datapatch.start()
        self.c = sqlite3.connect(self.p / 'data/wisdom.sqlite'); self.c.row_factory = sqlite3.Row
        library.init(self.c); self.c.commit(); wisdom.init(self.c); self.c.commit()
        fixture(self.p / 'source')
        self.raw = export_collection(self.p / 'source', 'new-study', license='Private QA', attribution='Synthetic')
        self.bundle = library.stage(self.c, self.raw)
        library.action(self.c, {'id': 'new-study', 'action': 'enable'})
        wisdom.init(self.c); self.c.commit()
        self.chapter = 'new-study-first'
        self.new = altered(self.raw, lambda f: f.update({'content/' + self.chapter + '.md': b'# A revised synthetic chapter\nCompletely different text.'}))

    def tearDown(self):
        self.c.close(); self.datapatch.stop(); self.env.stop(); self.tmp.cleanup(); library.CACHE.clear()

    def args(self, raw=None, old=None):
        raw = raw or self.new
        return {'id': 'new-study', 'collection_id': 'new-study', 'old_sha256': old or self.bundle['sha256'],
                'new_sha256': hashlib.sha256(raw).hexdigest(), 'zip_base64': base64.b64encode(raw).decode()}

    def apply_args(self, p):
        return dict({k: p[k] for k in ('id', 'collection_id', 'old_sha256', 'new_sha256', 'token')}, confirm=True)

    def test_revision_preserves_state_and_original_highlight_through_two_editions(self):
        original = library.package_files(self.bundle)[2]['content/' + self.chapter + '.md']
        wisdom.react(self.c, {'kind': 'entry', 'id': self.chapter, 'field': 'saved', 'value': True})
        wisdom.react(self.c, {'kind': 'entry', 'id': self.chapter, 'field': 'progress', 'value': 43})
        h = wisdom.highlight(self.c, {'action': 'add', 'entry_id': self.chapter, 'start': 0, 'end': 9, 'text': 'Synthetic', 'body_sha256': hashlib.sha256(original).hexdigest()})
        self.c.commit()
        before = [tuple(r) for r in self.c.execute('SELECT * FROM wisdom_reactions')]
        preview = revision.preview(self.c, self.args())
        self.assertEqual(library.list_bundles(self.c)[0]['sha256'], self.bundle['sha256'])
        self.assertEqual(preview, revision.preview(self.c, self.args()))
        applied = revision.apply(self.c, self.apply_args(preview))
        self.assertFalse(applied['replay'])
        self.assertTrue(revision.apply(self.c, self.apply_args(preview))['replay'])
        self.assertEqual(before, [tuple(r) for r in self.c.execute('SELECT * FROM wisdom_reactions')])
        self.assertEqual(self.c.execute('SELECT progress FROM wisdom_positions WHERE id=?', (self.chapter,)).fetchone()[0], 43)
        self.c.execute("UPDATE wisdom_highlight_history SET reason='Earlier edition — owner-verified original note' WHERE seq=?", (h['id'],))
        self.c.commit()
        historical = dict(self.c.execute('SELECT * FROM wisdom_highlight_history WHERE seq=?', (h['id'],)).fetchone())
        self.assertEqual(historical['source_body'].encode(), original)
        self.assertEqual(historical['source_body_sha256'], hashlib.sha256(original).hexdigest())
        self.assertEqual(wisdom.highlights(self.c)[0]['text'], 'Synthetic')
        self.assertEqual(wisdom.highlights(self.c)[0]['anchor_status'], 'unresolved')
        # New overlapping quote must not merge/delete an older-edition quote.
        wisdom.highlight(self.c, {'action': 'add', 'entry_id': self.chapter, 'start': 0, 'end': 9, 'text': 'A revised', 'body_sha256': next(e['body_sha256'] for e in wisdom.catalog()['entries'] if e['id'] == self.chapter)})
        self.c.commit()
        newer = altered(self.new, lambda f: f.update({'content/' + self.chapter + '.md': b'Third synthetic edition.'}))
        p2 = revision.preview(self.c, self.args(newer, preview['new_sha256']))
        revision.apply(self.c, self.apply_args(p2))
        self.assertEqual(dict(self.c.execute('SELECT * FROM wisdom_highlight_history WHERE seq=?', (h['id'],)).fetchone()), historical)
        self.assertEqual(len(wisdom.highlights(self.c)), 2)
        self.assertEqual(library.package_files(self.bundle)[2]['content/' + self.chapter + '.md'], original)
        with self.assertRaisesRegex(ValueError, 'Stale'):
            revision.apply(self.c, self.apply_args(preview))
        self.assertEqual((library.root() / 'new-study/bundle.zip').read_bytes(), self.raw)
        self.assertEqual(self.c.execute('SELECT count(*) FROM wisdom_editions').fetchone()[0], 3)

    def test_epigraph_author_survives_import_revision_and_state(self):
        author = 'A. E. Waite'
        def attribute(files):
            edit_catalog(files, lambda d: d['entries'][0].update(epigraph_author=author))
        raw = altered(self.raw, attribute)
        self.assertEqual(library.inspect_bundle(raw)[1]['entries'][0]['epigraph_author'], author)
        before = wisdom.state(self.c)
        p = revision.preview(self.c, self.args(raw))
        revision.apply(self.c, self.apply_args(p))
        library.CACHE.clear()
        after = wisdom.state(self.c)
        attributed = next(e for e in after['entries'] if e.get('epigraph_author') == author)
        original = next(e for e in before['entries'] if e['id'] == attributed['id'])
        self.assertEqual({k: v for k, v in attributed.items() if k != 'epigraph_author'}, original)
        self.assertEqual(before['highlights'], after['highlights'])
        self.assertEqual(before['thinkers'], after['thinkers'])
        current = library.list_bundles(self.c)[0]
        self.assertEqual(library.package_files(current)[1]['entries'][0]['epigraph_author'], author)
        # Initial import uses the same preservation path, not only revision.
        library.CACHE.clear()
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'WISDOM_LIBRARY': tmp}):
            with sqlite3.connect(':memory:') as fresh:
                fresh.row_factory = sqlite3.Row
                library.init(fresh)
                library.stage(fresh, raw)
                library.action(fresh, {'id': 'new-study', 'action': 'enable'})
                self.assertEqual(library.catalog(fresh)['entries'][0]['epigraph_author'], author)

    def test_confirmation_stale_binding_tamper_and_cross_bundle_fail(self):
        p = revision.preview(self.c, self.args())
        for delta in ({'confirm': False}, {'confirm': 1}, {'id': 'wrong'}, {'collection_id': 'wrong'}, {'old_sha256': '0' * 64}):
            with self.subTest(delta=delta), self.assertRaises(ValueError):
                revision.apply(self.c, dict(self.apply_args(p), **delta))
        with self.assertRaisesRegex(ValueError, 'Stale'):
            revision.preview(self.c, dict(self.args(), old_sha256='0' * 64))
        with self.assertRaises(ValueError):
            revision.preview(self.c, dict(self.args(), collection_id='other'))
        staged = revision.edition_path('new-study', p['new_sha256']) / 'bundle.zip'
        staged.write_bytes(self.raw)
        with self.assertRaisesRegex(ValueError, 'digest'):
            revision.apply(self.c, self.apply_args(p))
        self.assertEqual(library.list_bundles(self.c)[0]['sha256'], self.bundle['sha256'])

    def test_ids_thinkers_portraits_and_dangerous_archive_rejected(self):
        transforms = [
            lambda f: f.update({'../escape': b'bad'}),
            lambda f: edit_catalog(f, lambda d: d['thinkers'][0].update(name='Wrong person')),
            lambda f: edit_catalog(f, lambda d: d['collections'][0].update(id='wrong')),
            lambda f: edit_catalog(f, lambda d: d['entries'].pop()),
            lambda f: f.pop('art/p/new-study-author.jpg'),
        ]
        for fn in transforms:
            with self.subTest(fn=fn), self.assertRaises(ValueError):
                revision.preview(self.c, self.args(altered(self.raw, fn)))
        self.assertEqual(library.list_bundles(self.c)[0]['sha256'], self.bundle['sha256'])

    def test_shared_thinker_and_glossary_isolation_and_competing_preview(self):
        other_source = self.p / 'other-source'
        fixture(other_source, 'other-study')
        catalog_path = other_source / 'content/catalog.json'
        d = json.loads(catalog_path.read_text())
        original = json.loads((self.p / 'source/content/catalog.json').read_text())['thinkers'][0]
        d['thinkers'][0] = original
        for e in d['entries']:
            if e['thinker'] == 'other-study-author': e['thinker'] = original['id']
        d['collections'][0]['thinker'] = original['id']
        catalog_path.write_text(json.dumps(d))
        (other_source / 'static/wisdom-art/p/other-study-author.jpg').rename(other_source / 'static/wisdom-art/p/new-study-author.jpg')
        raw = export_collection(other_source, 'other-study', license='Private QA', attribution='Synthetic')
        other = library.stage(self.c, raw)
        library.action(self.c, {'id': other['id'], 'action': 'enable'})
        before = copy.deepcopy(next(col for col in library.catalog(self.c)['collections'] if col['id'] == 'other-study'))
        def change_gloss(files):
            g = json.loads(files['content/glosses.json']); g['道']['en'] = 'Wrong shared definition'
            files['content/glosses.json'] = json.dumps(g).encode()
        with self.assertRaisesRegex(ValueError, 'shared glossary'):
            revision.preview(self.c, self.args(altered(self.new, change_gloss)))
        first = revision.preview(self.c, self.args())
        second_bytes = altered(self.new, lambda f: f.update({'content/' + self.chapter + '.md': b'Competing edition'}))
        second = revision.preview(self.c, self.args(second_bytes))
        revision.apply(self.c, self.apply_args(first))
        with self.assertRaisesRegex(ValueError, 'Stale'):
            revision.apply(self.c, self.apply_args(second))
        self.assertEqual(next(b for b in library.list_bundles(self.c) if b['id'] == other['id']), dict(other, status='enabled'))
        self.assertEqual(next(col for col in library.catalog(self.c)['collections'] if col['id'] == 'other-study'), before)

    def test_scope_and_removed_status_and_restart_are_preserved_safely(self):
        library.set_collection_scope(self.c, 'new-study', 'new-study', expected_sha256=self.bundle['sha256'], scope='shared', provenance='qa')
        library.action(self.c, {'id': 'new-study', 'action': 'remove'})
        p = revision.preview(self.c, self.args())
        revision.apply(self.c, self.apply_args(p))
        self.c.close()
        self.c = sqlite3.connect(self.p / 'data/wisdom.sqlite'); self.c.row_factory = sqlite3.Row
        library.init(self.c); wisdom.init(self.c); self.c.commit()
        b = library.list_bundles(self.c)[0]
        self.assertEqual(b['status'], 'removed')
        self.assertEqual(library.collection_scope(self.c, b, 'new-study')['library_scope'], 'private')
        self.assertEqual(library.catalog(self.c)['entries'], [])
        library.action(self.c, {'id': 'new-study', 'action': 'enable'})
        self.assertEqual(len(library.catalog(self.c)['entries']), 3)
        # An explicit rollback uses the retained original ZIP and current digest.
        restore = revision.preview(self.c, self.args(self.raw, p['new_sha256']))
        revision.apply(self.c, self.apply_args(restore))
        self.assertEqual(library.list_bundles(self.c)[0]['sha256'], self.bundle['sha256'])
        with self.assertRaisesRegex(ValueError, 'Stale'):
            revision.apply(self.c, self.apply_args(p))
        fresh = revision.preview(self.c, self.args())
        self.assertNotEqual(fresh['token'], p['token'])
        revision.apply(self.c, self.apply_args(fresh))

    def test_failed_transaction_retains_original_pointer_and_history(self):
        p = revision.preview(self.c, self.args())
        self.c.execute("CREATE TRIGGER reject_revision BEFORE UPDATE OF sha256 ON wisdom_bundles BEGIN SELECT RAISE(FAIL,'synthetic failure'); END")
        self.c.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            revision.apply(self.c, self.apply_args(p))
        self.assertEqual(library.list_bundles(self.c)[0]['sha256'], self.bundle['sha256'])
        self.assertEqual(self.c.execute('SELECT count(*) FROM wisdom_editions').fetchone()[0], 0)

    def test_http_mcp_and_existing_cli_round_trip_readback(self):
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True); thread.start()
        endpoint = 'http://127.0.0.1:' + str(http.server_port)
        try:
            contract = Target(endpoint, 'mcp').call('', tool='wisdom_authoring_contract')
            self.assertEqual(contract['model'], 'claude-opus-5-5')
            z = self.p / 'new.zip'; z.write_bytes(self.new)
            p = self.p / 'preview.json'
            cli = [sys.executable, 'tools/author_collection.py']
            cmd = cli + ['revision-preview', '--bundle', str(z), '--collection', 'new-study', '--old-sha256', self.bundle['sha256'], '--endpoint', endpoint, '--transport', 'api', '--output', str(p)]
            run = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            cmd = cli + ['revision-apply', '--preview', str(p), '--endpoint', endpoint, '--transport', 'mcp', '--confirm']
            run = subprocess.run(cmd, capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(json.loads(run.stdout)['readback']['sha256'], hashlib.sha256(self.new).hexdigest())
            state = Target(endpoint, 'mcp').call('', tool='wisdom_state')
            self.assertEqual(next(e['body'] for e in state['entries'] if e['id'] == self.chapter), '# A revised synthetic chapter\nCompletely different text.')
        finally:
            http.shutdown(); http.server_close(); thread.join()

    def test_qa_no_work_live_pin_and_effective_route_verification(self):
        with patch.object(server, '_wizard') as network:
            status, response = server.submit_request({'text': 'Synthetic request', 'qa': True})
            self.assertEqual(status, 200); network.assert_not_called()
        meta = {'model': 'claude-opus-5-5', 'provider': 'anthropic', 'model_lock': 'accepted'}
        run = {'run_id': 'run_synthetic', 'runtime': meta, 'status': 'running'}
        with patch.object(server, 'ADMIT', 'live'), patch.object(server, 'WIZARD_ORIGIN', 'https://example.invalid'), patch.object(server, '_wizard', side_effect=[{}, run]) as network:
            status, response = server.submit_request({'text': 'Synthetic request'})
            self.assertEqual(status, 200)
            seq = response['request']['seq']
            for call in network.call_args_list:
                payload = call.args[2]
                self.assertEqual(payload['model'], 'claude-opus-5-5')
                self.assertEqual(payload['provider'], 'anthropic')
                self.assertIs(payload['require_model_lock'], True)
            server.submit_request({'seq': seq})
            self.assertEqual(network.call_count, 2)
        with patch.object(server, '_wizard', return_value=run):
            self.assertFalse(server.request_route({'seq': seq})['effective_route_verified'])
        with patch.object(server, '_wizard', return_value=dict(run, status='completed')):
            with self.assertRaises(server.AdmissionError): server.request_route({'seq': seq})
        with patch.object(server, '_wizard', return_value=dict(run, status='completed', runtime=dict(meta, model_lock='confirmed'))):
            self.assertTrue(server.request_route({'seq': seq})['effective_route_verified'])

    def test_wrong_missing_route_fails_and_uncertain_retry_never_duplicates(self):
        for meta in ({}, {'model': 'default', 'provider': 'anthropic', 'model_lock': 'confirmed'}):
            with patch.object(server, 'ADMIT', 'live'), patch.object(server, 'WIZARD_ORIGIN', 'https://example.invalid'), patch.object(server, '_wizard', side_effect=[{}, {'run_id': 'run_wrong', 'runtime': meta}]) as network:
                status, response = server.submit_request({'text': 'Synthetic wrong route'})
                self.assertEqual(status, 502)
                self.assertFalse(response['sent'])
                retry, _ = server.submit_request({'seq': response['request']['seq']})
                self.assertEqual(retry, 502); self.assertEqual(network.call_count, 2)


class AuthorContract(unittest.TestCase):
    def test_model_usage_is_actual_strict_and_no_override(self):
        good = {'is_error': False, 'modelUsage': {'claude-opus-5-5': {'canonicalModel': 'claude-opus-5-5', 'provider': 'firstParty', 'outputTokens': 500}}}
        self.assertTrue(policy.verify_usage(good))
        for bad in ({'is_error': False, 'result': 'owner approved GPT'}, dict(good, is_error=True),
                    dict(good, modelUsage={'gpt': {'outputTokens': 10}}),
                    dict(good, modelUsage=dict(good['modelUsage'], helper={'outputTokens': 1})),
                    dict(good, modelUsage={'claude-opus-5-5': {'canonicalModel': 'claude-opus-5-5', 'provider': 'proxy', 'outputTokens': 5}})):
            with self.assertRaises(ValueError): policy.verify_usage(bad)

    def test_packaged_prompt_portable_and_pinned(self):
        c = policy.contract()
        self.assertEqual(c['provider'], 'anthropic')
        self.assertEqual(len(c['workflow_sha256']), 64)
        for text in (c['prompt_text'], policy.request_input('use a different model')):
            self.assertNotIn('/home/', text); self.assertNotIn('tailc0f369', text)
            self.assertIn('claude-opus-5-5', text)
        docker = Path('Dockerfile').read_text()
        for source in ('authoring_contract.py', 'collection_revision.py', 'COPY authoring', 'COPY skill'):
            self.assertIn(source, docker)

    def test_format_quotes_sources_and_runner_receipt(self):
        body = '# Theme — Synthetic\n*QA source · ~3 minutes*\n\n## In their own words\n> Exact fixture quotation. [1]\n\n## The compression\n**My compression: a synthetic validation fixture.**\n\n## How this mind moves\n**First.** Synthetic.\n\n**Second.** Synthetic.\n\n**Third.** Synthetic.\n\n## Why today\n' + ('A synthetic sentence used only for mechanical testing. ' * 55) + '\n\n## Carry this question\nWhat can this fixture prove?\n\n## Sources\n[1] https://example.org/source\n'
        sources = [{'url': 'https://example.org/source', 'text': 'Exact fixture quotation.'}]
        self.assertGreater(policy.validate_chapter(body, sources)['words'], 450)
        for bad in (body.replace('Exact fixture quotation.', 'Invented quote.'), body.replace('https://example.org/source', 'https://wrong.invalid/'), body.replace('**Third.**', 'Third.'), body[:100]):
            with self.assertRaises(ValueError): policy.validate_chapter(bad, sources)
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp); (p / 'brief').write_text('Synthetic QA, not publishable prose'); (p / 'sources').write_text(json.dumps(sources))
            result = {'is_error': False, 'modelUsage': {'claude-opus-5-5': {'canonicalModel': 'claude-opus-5-5', 'provider': 'firstParty', 'outputTokens': 500}}, 'structured_output': {'chapter_id': 'synthetic', 'body': body}}
            def fake_run(argv, **kw):
                self.assertEqual(argv[argv.index('--model')+1], 'claude-opus-5-5')
                self.assertNotIn('--fallback-model', argv)
                self.assertEqual(argv[argv.index('--tools')+1], '')
                kw['stdout'].write(json.dumps(result).encode())
                return subprocess.CompletedProcess(argv, 0)
            with patch('tools.author_chapter.shutil.which', return_value='/synthetic/claude'), patch('tools.author_chapter.subprocess.run', side_effect=fake_run), patch.dict(os.environ, {'ANTHROPIC_BASE_URL': 'https://api.anthropic.com'}):
                record = author('synthetic', p / 'brief', p / 'sources', p / 'output.md', p / 'receipt.json')
            self.assertEqual(record['output_sha256'], hashlib.sha256((p / 'output.md').read_bytes()).hexdigest())
            self.assertEqual(json.loads((p / 'receipt.json').read_text())['workflow_sha256'], policy.contract()['workflow_sha256'])
            result['structured_output']['body'] = 'Too short, must not become an accepted chapter.'
            calls = []
            def counting_run(argv, **kw):
                calls.append((json.loads(kw['input']), float(argv[argv.index('--max-budget-usd')+1])))
                return fake_run(argv, **kw)
            with patch('tools.author_chapter.shutil.which', return_value='/synthetic/claude'), patch('tools.author_chapter.subprocess.run', side_effect=counting_run), patch.dict(os.environ, {'ANTHROPIC_BASE_URL': 'https://api.anthropic.com'}):
                with self.assertRaisesRegex(ValueError, 'NO EDITION.*received.*Do not write chapter Markdown or assemble a receipt yourself'):
                    author('synthetic', p / 'brief', p / 'sources', p / 'failed.md', p / 'failed.json')
            # Same pinned route asked three times; each retry carries the check's error.
            self.assertEqual(len(calls), 3)
            self.assertNotIn('revision_request', calls[0][0])
            self.assertIn('received', calls[1][0]['revision_request']['failed_check'])
            self.assertEqual(calls[2][0]['revision_request']['previous_body'], result['structured_output']['body'])
            self.assertTrue(all(budget <= 5 for _, budget in calls))
            self.assertFalse((p / 'failed.md').exists())
            self.assertFalse((p / 'failed.json').exists())
            self.assertFalse((p / 'failed.json.cli.json').exists())
            kept = sorted((p / 'rejected').glob('synthetic.attempt-*.rejected.json'))
            self.assertEqual(len(kept), 3)
            first = json.loads(kept[0].read_text())
            self.assertTrue(first['status'].startswith('REJECTED'))
            self.assertEqual(json.loads(first['cli_result']), result)
            # A rejected first draft recovered by the same pinned route becomes the edition.
            good = dict(result, structured_output={'chapter_id': 'synthetic', 'body': body})
            replies = [result, good]
            def recovering_run(argv, **kw):
                kw['stdout'].write(json.dumps(replies.pop(0)).encode())
                return subprocess.CompletedProcess(argv, 0)
            with patch('tools.author_chapter.shutil.which', return_value='/synthetic/claude'), patch('tools.author_chapter.subprocess.run', side_effect=recovering_run), patch.dict(os.environ, {'ANTHROPIC_BASE_URL': 'https://api.anthropic.com'}):
                record = author('synthetic', p / 'brief', p / 'sources', p / 'second.md', p / 'second.json')
            self.assertEqual((record['attempt'], record['rejected_attempts']), (2, 1))
            self.assertEqual((p / 'second.md').read_text(), body)
            self.assertEqual(len(list((p / 'rejected').glob('*.rejected.json'))), 4)
            # A wrong route is never retried and leaves no edition.
            wrong = dict(good, modelUsage={'claude-haiku-4-5': {'canonicalModel': 'claude-haiku-4-5', 'provider': 'firstParty', 'outputTokens': 5}})
            replies = [wrong, good]
            with patch('tools.author_chapter.shutil.which', return_value='/synthetic/claude'), patch('tools.author_chapter.subprocess.run', side_effect=recovering_run), patch.dict(os.environ, {'ANTHROPIC_BASE_URL': 'https://api.anthropic.com'}):
                with self.assertRaisesRegex(ValueError, 'modelUsage'):
                    author('synthetic', p / 'brief', p / 'sources', p / 'third.md', p / 'third.json')
            self.assertEqual(len(replies), 1)
            self.assertFalse((p / 'third.md').exists())
            # Missing destination folders are created before the paid call (acceptance finding).
            replies = [result, good]
            with patch('tools.author_chapter.shutil.which', return_value='/synthetic/claude'), patch('tools.author_chapter.subprocess.run', side_effect=recovering_run), patch.dict(os.environ, {'ANTHROPIC_BASE_URL': 'https://api.anthropic.com'}):
                author('synthetic', p / 'brief', p / 'sources', p / 'new' / 'out.md', p / 'new' / 'receipts' / 'r.json')
            self.assertTrue((p / 'new' / 'receipts' / 'r.json').is_file())
            self.assertEqual(len(list((p / 'new' / 'receipts' / 'rejected').glob('*.rejected.json'))), 1)


if __name__ == '__main__':
    unittest.main()
