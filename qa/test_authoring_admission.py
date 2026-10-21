"""Result admission for pinned authorship (#63). Synthetic fixtures; no model calls."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import authoring_admission as admission
import authoring_contract as policy
import collection_revision as revision
import library
import server
import wisdom
from qa.authoring_fixture import fixture
from tools.author_collection import export_collection

KEY = 'new-study'
IDS = [KEY + '-overview', KEY + '-second', KEY + '-first']


SOURCES = json.dumps([{'url': 'https://example.org/source',
                       'text': 'This sentence is a synthetic fixture, not a quotation.'}]).encode()
USAGE = {'claude-opus-5-5': {'canonicalModel': 'claude-opus-5-5', 'provider': 'firstParty', 'outputTokens': 900}}


def cli_result(chapter, body):
    """Raw CLI JSON the pinned helper keeps beside each receipt (receipt option C)."""
    return json.dumps({'is_error': False, 'modelUsage': USAGE,
                       'structured_output': {'chapter_id': chapter, 'body': body.decode()}}).encode()


def evidence(chapter, body):
    return {admission.output_name(chapter): cli_result(chapter, body),
            admission.sources_name(hashlib.sha256(SOURCES).hexdigest()): SOURCES}


def receipt(chapter, body, **changes):
    c = policy.contract()
    record = {'version': 1, 'workflow': c['id'], 'workflow_version': c['version'], 'format': c['format'],
              'workflow_sha256': c['workflow_sha256'], 'prompt_sha256': c['prompt_sha256'],
              'brief_sha256': '1' * 64, 'sources_sha256': hashlib.sha256(SOURCES).hexdigest(), 'input_sha256': '3' * 64,
              'cli_result_sha256': hashlib.sha256(cli_result(chapter, body)).hexdigest(), 'output_sha256': hashlib.sha256(body).hexdigest(),
              'output_tokens_sha256': admission.tokens_sha256(body), 'chapter_id': chapter,
              'provider': 'anthropic', 'model': 'claude-opus-5-5',
              'modelUsage': USAGE,
              'checks': {'words': 500}}
    record.update(changes)
    return record


def rezip(raw, change):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        files = {n: z.read(n) for n in z.namelist()}
    change(files)
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, b in sorted(files.items()):
            z.writestr(n, b)
    return out.getvalue()


class AdmissionCase(unittest.TestCase):
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
        self.receipts = self.p / 'receipts'; self.receipts.mkdir()

    def tearDown(self):
        self.c.close(); self.datapatch.stop(); self.env.stop(); self.tmp.cleanup(); library.CACHE.clear()

    def body(self, chapter):
        return (self.p / 'source/content' / (chapter + '.md')).read_bytes()

    def write_receipts(self, chapters, **changes):
        for chapter in chapters:
            name = self.receipts / (chapter + '.receipt.json')
            name.write_text(json.dumps(receipt(chapter, self.body(chapter), **changes)))
            (self.receipts / (chapter + '.receipt.json.cli.json')).write_bytes(cli_result(chapter, self.body(chapter)))
            (self.receipts / (chapter + '.receipt.json.sources.json')).write_bytes(SOURCES)

    def export(self, receipts=True):
        return export_collection(self.p / 'source', KEY, license='Private QA', attribution='Synthetic',
                                 receipts=self.receipts if receipts else None)

    def assert_nothing_staged(self, raw):
        with self.assertRaisesRegex(ValueError, 'No output admitted'):
            library.stage(self.c, raw)
        self.assertEqual(library.list_bundles(self.c), [])
        self.assertFalse((self.p / 'library' / KEY).exists())

    def test_unreceipted_import_is_admitted_and_labelled_unverified(self):
        b = library.stage(self.c, self.export(receipts=False))
        self.assertEqual(b['authoring']['status'], 'unverified')
        self.assertEqual(library.list_bundles(self.c)[0]['authoring']['status'], 'unverified')

    def test_full_receipts_label_checked_with_provenance(self):
        self.write_receipts(IDS)
        b = library.stage(self.c, self.export())
        a = library.list_bundles(self.c)[0]['authoring']
        self.assertEqual(b['authoring'], a)
        self.assertEqual(a['status'], 'checked')
        self.assertEqual((a['observed_model'], a['observed_provider'], a['override']), ('claude-opus-5-5', 'firstParty', None))
        self.assertEqual(a['chapters_verified'], 3)
        self.assertEqual(a['prompt_sha256'], policy.contract()['prompt_sha256'])

    def test_partial_receipts_label_partial(self):
        self.write_receipts(IDS[:1])
        a = library.stage(self.c, self.export())['authoring']
        self.assertEqual(a['status'], 'partial')
        self.assertEqual(sorted(a['chapters_unverified']), sorted(IDS[1:]))

    def test_wrong_or_malformed_receipts_refuse_whole_bundle(self):
        self.write_receipts(IDS)
        good = self.export()
        member = json.loads(zipfile.ZipFile(io.BytesIO(good)).read(admission.MEMBER))
        first = IDS[2]
        cases = {
            'unexpected effective model': {'modelUsage': {'claude-haiku-4-5': {'canonicalModel': 'claude-haiku-4-5', 'provider': 'firstParty', 'outputTokens': 9}}},
            'mixed helper model': {'modelUsage': dict(member['receipts'][first]['modelUsage'], **{'claude-haiku-4-5': {'outputTokens': 1}})},
            'missing modelUsage': {'modelUsage': None},
            'proxy provider': {'modelUsage': {'claude-opus-5-5': {'canonicalModel': 'claude-opus-5-5', 'provider': 'proxy', 'outputTokens': 9}}},
            'requested model': {'model': 'gpt-6.1-sol'},
            'other prompt': {'prompt_sha256': '0' * 64},
            'other workflow': {'workflow_sha256': '0' * 64},
            'malformed digest': {'input_sha256': 'short'},
            'hand edit': {'output_sha256': '5' * 64, 'output_tokens_sha256': '6' * 64},
        }
        for name, change in cases.items():
            with self.subTest(name):
                def mutate(files, change=change):
                    doc = json.loads(files[admission.MEMBER])
                    doc['receipts'][first] = dict(doc['receipts'][first], **change)
                    files[admission.MEMBER] = json.dumps(doc).encode()
                self.assert_nothing_staged(rezip(good, mutate))
        for name, raw_member in (('not json', b'{'), ('wrong version', b'{"version":2,"receipts":{}}'),
                                 ('unknown chapter', json.dumps({'version': 1, 'receipts': {'other-chapter': {}}}).encode())):
            with self.subTest(name):
                self.assert_nothing_staged(rezip(good, lambda f, r=raw_member: f.update({admission.MEMBER: r})))
        # Prose edited after the receipt was written.
        edited = rezip(good, lambda f: f.update({'content/' + first + '.md': f['content/' + first + '.md'] + b'\nAdded by hand.\n'}))
        self.assert_nothing_staged(edited)
        self.assertEqual(library.stage(self.c, good)['authoring']['status'], 'checked')

    def test_receipted_body_must_pass_runner_shape_checks(self):
        # The #63 acceptance forgery shape: every receipt field copied, output digests
        # recomputed over prose the pinned runner would have rejected on shape alone.
        self.write_receipts(IDS)
        good = self.export()
        first = IDS[2]
        broken = {
            'too short': lambda b: b.split(b'## Why today')[0] + b'## Why today\n\nShort.\n\n## Carry this question\n\nQ?\n\n## Sources\n\n[1] https://example.org/source\n',
            'missing compression line': lambda b: b.replace(b'**My compression: notice before naming.**', b'Notice before naming.'),
            'two movements': lambda b: b.replace(b'**Read.** Preserve the order.', b'Read. Preserve the order.'),
            'section order': lambda b: b.replace(b'## Why today', b'## Why now'),
            'uncited epigraph': lambda b: b.replace(b'not a quotation. [1]', b'not a quotation.'),
            'undefined citation': lambda b: b.replace(b'Return to the page.', b'Return to the page [2].'),
            'unnumbered sources': lambda b: b.replace(b'[1] https://example.org/source', b'https://example.org/source'),
        }
        for name, change in broken.items():
            with self.subTest(name):
                def forge(files, change=change):
                    body = change(files['content/' + first + '.md'])
                    files['content/' + first + '.md'] = body
                    doc = json.loads(files[admission.MEMBER])
                    doc['receipts'][first] = dict(doc['receipts'][first], output_sha256=hashlib.sha256(body).hexdigest(),
                                                  output_tokens_sha256=admission.tokens_sha256(body))
                    files[admission.MEMBER] = json.dumps(doc).encode()
                raw = rezip(good, forge)
                with self.assertRaisesRegex(ValueError, 'compression v1 checks the pinned runner applies'):
                    library.stage(self.c, raw)
                self.assertEqual(library.list_bundles(self.c), [])
        # The same body without a receipt still imports, honestly labelled.
        plain = rezip(self.export(receipts=False), lambda f: f.update({'content/' + first + '.md': broken['two movements'](f['content/' + first + '.md'])}))
        self.assertEqual(library.stage(self.c, plain)['authoring']['status'], 'unverified')

    def test_whitespace_normalised_match_needs_token_digest(self):
        self.write_receipts(IDS)
        good = self.export()
        first = 'content/' + IDS[2] + '.md'
        spaced = rezip(good, lambda f: f.update({first: f[first].replace(b'\n\n', b'\n\n\n')}))
        self.assertEqual(admission.assess(*reversed(library.inspect_bundle(spaced)[1:]))['status'], 'checked')
        def strip(files):
            doc = json.loads(files[admission.MEMBER]); doc['receipts'][IDS[2]].pop('output_tokens_sha256')
            files[admission.MEMBER] = json.dumps(doc).encode()
            files[first] = files[first].replace(b'\n\n', b'\n\n\n')
        self.assert_nothing_staged(rezip(good, strip))

    def test_exporter_fails_before_writing_on_bad_receipt(self):
        self.write_receipts(IDS, modelUsage={'gpt-6.1-sol': {'outputTokens': 3}})
        with self.assertRaisesRegex(ValueError, 'No output admitted'):
            self.export()
        empty = self.p / 'none'; empty.mkdir(); self.receipts = empty
        with self.assertRaisesRegex(ValueError, 'No <chapter_id>.receipt.json'):
            self.export()

    def test_rewrite_admission_refuses_wrong_model_and_keeps_label_on_apply(self):
        old = library.stage(self.c, self.export(receipts=False))
        library.action(self.c, {'id': KEY, 'action': 'enable'}); wisdom.init(self.c); self.c.commit()
        chapter = IDS[2]
        new_body = self.body(chapter).replace(b'notice before naming', b'attend before naming')
        def rewritten(record):
            def change(files):
                files['content/' + chapter + '.md'] = new_body
                files[admission.MEMBER] = admission.build({chapter: record})
                files.update(evidence(chapter, new_body))
            return rezip(self.export(receipts=False), change)
        def args(raw):
            return {'id': KEY, 'collection_id': KEY, 'old_sha256': old['sha256'],
                    'new_sha256': hashlib.sha256(raw).hexdigest(), 'zip_base64': base64.b64encode(raw).decode()}
        bad = rewritten(receipt(chapter, new_body, modelUsage={'claude-sonnet-4-5': {'canonicalModel': 'claude-sonnet-4-5', 'provider': 'firstParty', 'outputTokens': 5}}))
        with self.assertRaisesRegex(ValueError, 'No output admitted'):
            revision.preview(self.c, args(bad))
        self.assertFalse(revision.edition_path(KEY, hashlib.sha256(bad).hexdigest()).exists())
        self.assertEqual(self.c.execute('SELECT count(*) FROM wisdom_revision_previews').fetchone()[0], 0)
        good = rewritten(receipt(chapter, new_body))
        report = revision.preview(self.c, args(good))
        self.assertEqual(report['authoring']['status'], 'partial')
        revision.apply(self.c, dict({k: report[k] for k in ('id', 'collection_id', 'old_sha256', 'new_sha256', 'token')}, confirm=True))
        current = library.list_bundles(self.c)[0]
        self.assertEqual(current['sha256'], hashlib.sha256(good).hexdigest())
        self.assertEqual(current['authoring']['chapters_verified'], 1)
        # The earlier edition and its own (unverified) label are retained.
        editions = dict(self.c.execute('SELECT sha256,manifest FROM wisdom_editions WHERE bundle_id=?', (KEY,)).fetchall())
        self.assertEqual(json.loads(editions[old['sha256']])['authoring']['status'], 'unverified')
        self.assertEqual(json.loads(editions[current['sha256']])['authoring']['status'], 'partial')


if __name__ == '__main__':
    unittest.main()
