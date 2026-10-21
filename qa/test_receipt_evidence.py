"""Option C: author receipts travel with the raw author output and source text, and
admission rechecks them. Synthetic fixtures only; no model calls.

The two forgeries come from the #63 clean-box acceptance (wizard-os
docs/evidence/wisdom-63-t_bf8aff5d.md, section 4): a real receipt copied over
(a) the author's own quotation-failing draft and (b) the accepted chapter plus one
added sentence. Both were admitted before; both must now be refused.
"""
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
import collection_export
import library
import server
import wisdom
from qa.authoring_fixture import fixture
from tools.author_collection import export_collection

KEY = 'new-study'
IDS = [KEY + '-overview', KEY + '-second', KEY + '-first']
SOURCES = [{'url': 'https://example.org/source',
            'text': 'Preface. This sentence is a synthetic fixture, not a quotation. Then the text goes on.'}]
USAGE = {'claude-opus-5-5': {'canonicalModel': 'claude-opus-5-5', 'provider': 'firstParty', 'outputTokens': 900}}
FAILED_QUOTE = '“emptiness is good, substance is bad.”'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def cli_result(chapter, body, usage=USAGE):
    """Shape of the Claude CLI JSON the pinned helper keeps as <receipt>.cli.json."""
    return (json.dumps({'type': 'result', 'is_error': False, 'modelUsage': usage, 'total_cost_usd': 0.05,
                        'structured_output': {'chapter_id': chapter, 'body': body.decode('utf-8')}},
                       ensure_ascii=False, indent=1) + '\n').encode('utf-8')


def receipt(chapter, body, cli_raw, sources_raw, **changes):
    c = policy.contract()
    record = {'version': 1, 'workflow': c['id'], 'workflow_version': c['version'], 'format': c['format'],
              'workflow_sha256': c['workflow_sha256'], 'prompt_sha256': c['prompt_sha256'],
              'brief_sha256': '1' * 64, 'sources_sha256': sha(sources_raw), 'input_sha256': '3' * 64,
              'cli_result_sha256': sha(cli_raw), 'output_sha256': sha(body),
              'output_tokens_sha256': admission.tokens_sha256(body), 'chapter_id': chapter,
              'provider': 'anthropic', 'model': 'claude-opus-5-5', 'modelUsage': USAGE, 'checks': {'words': 500}}
    record.update(changes)
    return record


def members(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        return {n: z.read(n) for n in z.namelist()}


def rezip(raw, change):
    files = members(raw)
    change(files)
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for n, b in sorted(files.items()):
            z.writestr(n, b)
    return out.getvalue()


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {'WISDOM_DATA': str(self.p / 'data'), 'WISDOM_LIBRARY': str(self.p / 'library'),
                                         'WISDOM_STARTER': 'disabled', 'WISDOM_LEGACY_QA': '0'})
        self.env.start()
        (self.p / 'data').mkdir()
        self.datapatch = patch.object(server, 'DATA', self.p / 'data'); self.datapatch.start()
        self.c = self.db('data')
        fixture(self.p / 'source')
        self.receipts = self.p / 'receipts'; self.receipts.mkdir()
        self.sources_raw = json.dumps(SOURCES, ensure_ascii=False).encode()

    def db(self, name):
        (self.p / name).mkdir(exist_ok=True)
        c = sqlite3.connect(self.p / name / 'wisdom.sqlite'); c.row_factory = sqlite3.Row
        library.init(c); c.commit(); wisdom.init(c); c.commit()
        return c

    def tearDown(self):
        self.c.close(); self.datapatch.stop(); self.env.stop(); self.tmp.cleanup(); library.CACHE.clear()

    def body(self, chapter):
        return (self.p / 'source/content' / (chapter + '.md')).read_bytes()

    def write_receipts(self, chapters, evidence=True, **changes):
        """What tools/author_chapter.py leaves beside each receipt."""
        for chapter in chapters:
            body = self.body(chapter)
            cli = cli_result(chapter, body)
            name = self.receipts / (chapter + '.receipt.json')
            name.write_text(json.dumps(receipt(chapter, body, cli, self.sources_raw, **changes)))
            if evidence:
                Path(str(name) + '.cli.json').write_bytes(cli)
                Path(str(name) + '.sources.json').write_bytes(self.sources_raw)

    def export(self, receipts=True):
        return export_collection(self.p / 'source', KEY, license='Private QA', attribution='Synthetic',
                                 receipts=self.receipts if receipts else None)

    def assess(self, raw):
        _, catalog, files = library.inspect_bundle(raw)
        return admission.assess(files, catalog)

    def assert_refused(self, raw, pattern='No output admitted'):
        with self.assertRaisesRegex(ValueError, pattern):
            library.stage(self.c, raw)
        self.assertEqual(library.list_bundles(self.c), [])


class EvidenceTravels(Case):
    def test_export_carries_raw_output_and_deduplicated_source_text(self):
        self.write_receipts(IDS)
        files = members(self.export())
        for chapter in IDS:
            self.assertEqual(json.loads(files['authoring/output/' + chapter + '.json'])['structured_output']['body'],
                             self.body(chapter).decode())
        # One packet shared by three chapters is carried once, named by its digest.
        self.assertEqual([n for n in files if n.startswith('authoring/sources/')],
                         ['authoring/sources/' + sha(self.sources_raw) + '.json'])
        self.assertEqual(files['authoring/sources/' + sha(self.sources_raw) + '.json'], self.sources_raw)

    def test_full_evidence_is_labelled_checked_never_signed(self):
        self.write_receipts(IDS)
        a = library.stage(self.c, self.export())['authoring']
        self.assertEqual(a['status'], 'checked')
        self.assertEqual(a['chapters_verified'], 3)
        self.assertTrue(a['source_text_included'])
        self.assertIn('not a cryptographic signature', a['evidence_kind'])
        self.assertNotIn('signed', json.dumps(a).replace('not a cryptographic signature', ''))
        self.assertEqual(library.list_bundles(self.c)[0]['authoring'], a)

    def test_receipts_without_evidence_are_not_checked(self):
        self.write_receipts(IDS, evidence=False)
        # The exporter refuses rather than silently dropping the receipts.
        with self.assertRaisesRegex(ValueError, 'raw author output and source text'):
            self.export()
        # An older-format ZIP (receipts only) still imports, honestly unverified.
        old = rezip(self.export(receipts=False), lambda f: f.update({admission.MEMBER: admission.build(
            {k: json.loads((self.receipts / (k + '.receipt.json')).read_text()) for k in IDS})}))
        a = library.stage(self.c, old)['authoring']
        self.assertEqual(a['status'], 'unverified')
        self.assertIn('raw author output and source text', a['reason'])

    def test_mixed_evidence_is_partial(self):
        self.write_receipts(IDS)
        def drop(files):
            files.pop('authoring/output/' + IDS[0] + '.json')
        a = library.stage(self.c, rezip(self.export(), drop))['authoring']
        self.assertEqual(a['status'], 'partial')
        self.assertEqual(a['chapters_unverified'], [IDS[0]])

    def test_in_app_export_carries_evidence_and_says_source_text_is_included(self):
        self.write_receipts(IDS)
        library.stage(self.c, self.export())
        library.action(self.c, {'id': KEY, 'action': 'enable'}); wisdom.init(self.c); self.c.commit()
        details, raw = collection_export.build(self.c, KEY)
        self.assertEqual(details['source_text']['chapters'], 3)
        self.assertEqual(details['source_text']['packets'], 1)
        self.assertGreater(details['source_text']['bytes'], len(self.sources_raw))
        self.assertIn('source text', details['notice'])
        self.assertIn('anyone you share', details['notice'].lower())
        # Re-import on another installation rechecks and keeps the label.
        other = self.db('other')
        with patch.dict(os.environ, {'WISDOM_LIBRARY': str(self.p / 'other-library')}):
            library.init(other)
            self.assertEqual(library.stage(other, raw)['authoring']['status'], 'checked')
        other.close()

    def test_in_app_export_without_receipts_says_nothing_extra_is_included(self):
        library.stage(self.c, self.export(receipts=False))
        library.action(self.c, {'id': KEY, 'action': 'enable'}); wisdom.init(self.c); self.c.commit()
        details, raw = collection_export.build(self.c, KEY)
        self.assertIsNone(details['source_text'])
        self.assertFalse(any(n.startswith('authoring/') for n in members(raw)))


class ForgeriesFromTheAcceptance(Case):
    def forge(self, chapter, new_body, rewrite_output=False, rewrite_sources=None):
        """forge.py from the acceptance: copy every receipt field, swap the body, recompute
        output digests. Optionally go further and rebuild the raw output / source packet too."""
        self.write_receipts(IDS)
        good = self.export()

        def change(files):
            files['content/' + chapter + '.md'] = new_body
            doc = json.loads(files[admission.MEMBER])
            fields = {'output_sha256': sha(new_body), 'output_tokens_sha256': admission.tokens_sha256(new_body)}
            if rewrite_output:
                cli = cli_result(chapter, new_body)
                files['authoring/output/' + chapter + '.json'] = cli
                fields['cli_result_sha256'] = sha(cli)
            if rewrite_sources is not None:
                for name in [n for n in files if n.startswith('authoring/sources/')]:
                    files.pop(name)
                for k in IDS:
                    files['authoring/sources/' + sha(rewrite_sources) + '.json'] = rewrite_sources
                    doc['receipts'][k]['sources_sha256'] = sha(rewrite_sources)
            doc['receipts'][chapter] = dict(doc['receipts'][chapter], **fields)
            files[admission.MEMBER] = json.dumps(doc).encode()
        return rezip(good, change)

    def failing_draft(self, chapter):
        return self.body(chapter).replace(b'Return to the page.', ('Return to the page. ' + FAILED_QUOTE + ' [1]').encode())

    def test_added_sentence_over_real_receipt_is_refused(self):
        chapter = IDS[2]
        raw = self.forge(chapter, self.body(chapter).replace(b'Preserve the order.', b'Preserve the order. One more line.'))
        self.assert_refused(raw, 'raw author output')

    def test_quotation_failing_draft_over_real_receipt_is_refused(self):
        chapter = IDS[2]
        self.assert_refused(self.forge(chapter, self.failing_draft(chapter)), 'raw author output')

    def test_quotation_failing_draft_with_rebuilt_raw_output_is_refused_by_source_recheck(self):
        chapter = IDS[2]
        raw = self.forge(chapter, self.failing_draft(chapter), rewrite_output=True)
        self.assert_refused(raw, 'Quotation not present verbatim')

    def test_documented_limit_full_fabrication_is_checked_not_signed(self):
        # Not a signature: someone who rebuilds the raw output AND the source packet
        # consistently still passes. The label must say exactly that.
        chapter = IDS[2]
        sources = json.dumps([{'url': 'https://example.org/source', 'text': SOURCES[0]['text'] + ' ' + FAILED_QUOTE.strip('“”')}]).encode()
        a = self.assess(self.forge(chapter, self.failing_draft(chapter), rewrite_output=True, rewrite_sources=sources))
        self.assertEqual(a['status'], 'checked')
        self.assertIn('not a cryptographic signature', a['evidence_kind'])


class EvidenceMismatch(Case):
    def mutate(self, change):
        self.write_receipts(IDS)
        return rezip(self.export(), change)

    def test_evidence_must_match_its_receipt(self):
        chapter = IDS[1]
        out = 'authoring/output/' + chapter + '.json'
        def other_usage(f):
            f[out] = cli_result(chapter, self.body(chapter), {'claude-haiku-4-5': {'canonicalModel': 'claude-haiku-4-5', 'provider': 'firstParty', 'outputTokens': 9}})
            doc = json.loads(f[admission.MEMBER]); doc['receipts'][chapter]['cli_result_sha256'] = sha(f[out])
            f[admission.MEMBER] = json.dumps(doc).encode()
        def wrong_chapter(f):
            f[out] = cli_result(IDS[0], self.body(chapter))
            doc = json.loads(f[admission.MEMBER]); doc['receipts'][chapter]['cli_result_sha256'] = sha(f[out])
            f[admission.MEMBER] = json.dumps(doc).encode()
        def renamed_packet(f):
            name = next(n for n in f if n.startswith('authoring/sources/'))
            f['authoring/sources/' + '0' * 64 + '.json'] = f.pop(name)
        def edited_packet(f):
            name = next(n for n in f if n.startswith('authoring/sources/'))
            f[name] = f[name].replace(b'Preface.', b'Foreword.')
        def malformed_packet(f):
            name = next(n for n in f if n.startswith('authoring/sources/'))
            f['authoring/sources/' + sha(b'[]') + '.json'] = b'[]'
            doc = json.loads(f[admission.MEMBER])
            for k in IDS:
                doc['receipts'][k]['sources_sha256'] = sha(b'[]')
            f.pop(name); f[admission.MEMBER] = json.dumps(doc).encode()
        def stray_output(f):
            f['authoring/output/unknown-chapter.json'] = b'{}'
        def stray_packet(f):
            f['authoring/sources/' + sha(b'[1]') + '.json'] = b'[1]'
        def output_without_receipt(f):
            doc = json.loads(f[admission.MEMBER]); doc['receipts'].pop(chapter)
            f[admission.MEMBER] = json.dumps(doc).encode()
        cases = {'raw output byte change': (lambda f: f.update({out: f[out] + b' '}), 'raw author output'),
                 'other observed model in raw output': (other_usage, 'observed model'),
                 'raw output for another chapter': (wrong_chapter, 'raw author output'),
                 'packet name is not its digest': (renamed_packet, 'source text'),
                 'edited packet': (edited_packet, 'source text'),
                 'malformed packet': (malformed_packet, 'source'),
                 'unknown output member': (stray_output, 'Unsupported|Unreferenced|not referenced'),
                 'unreferenced packet': (stray_packet, 'not referenced'),
                 'evidence without receipt': (output_without_receipt, 'not referenced')}
        for name, (change, pattern) in cases.items():
            with self.subTest(name):
                self.assert_refused(self.mutate(change), pattern)
                library.CACHE.clear()


class HelperAndInterface(unittest.TestCase):
    def test_helper_keeps_the_exact_source_packet_beside_the_receipt(self):
        import subprocess
        from tools.author_chapter import author
        body = ('# Theme — Synthetic\n*QA source · ~3 minutes*\n\n## In their own words\n> Exact fixture quotation. [1]\n\n'
                '## The compression\n**My compression: a synthetic validation fixture.**\n\n## How this mind moves\n'
                '**First.** Synthetic.\n\n**Second.** Synthetic.\n\n**Third.** Synthetic.\n\n## Why today\n' +
                ('A synthetic sentence used only for mechanical testing. ' * 55) +
                '\n\n## Carry this question\nWhat can this fixture prove?\n\n## Sources\n[1] https://example.org/source\n')
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            (p / 'brief').write_text('Synthetic QA')
            (p / 'sources').write_text(json.dumps([{'url': 'https://example.org/source', 'text': 'Exact fixture quotation.'}], indent=3))
            result = {'is_error': False, 'modelUsage': USAGE, 'structured_output': {'chapter_id': 'synthetic', 'body': body}}
            def run(argv, **kw):
                kw['stdout'].write(json.dumps(result).encode())
                return subprocess.CompletedProcess(argv, 0)
            with patch('tools.author_chapter.shutil.which', return_value='/synthetic/claude'), \
                 patch('tools.author_chapter.subprocess.run', side_effect=run), \
                 patch.dict(os.environ, {'ANTHROPIC_BASE_URL': 'https://api.anthropic.com'}):
                record = author('synthetic', p / 'brief', p / 'sources', p / 'out.md', p / 'synthetic.receipt.json')
            kept = p / 'synthetic.receipt.json.sources.json'
            self.assertEqual(kept.read_bytes(), (p / 'sources').read_bytes())
            self.assertEqual(sha(kept.read_bytes()), record['sources_sha256'])
            self.assertEqual(sha((p / 'synthetic.receipt.json.cli.json').read_bytes()), record['cli_result_sha256'])

    def test_interface_wording_is_checked_never_signed(self):
        root = Path(__file__).resolve().parents[1]
        manage = (root / 'static/manage.js').read_text()
        self.assertIn("status==='checked'", manage)
        self.assertIn('source_text', manage)  # export preview names the included source text
        for text in (manage, (root / 'openapi.json').read_text(), (root / 'skill/SKILL.md').read_text(),
                     (root / 'docs/authoring/PINNED-WORKFLOW.md').read_text()):
            self.assertNotRegex(text, r'(?i)\bsigned receipt|receipts? (are|is) signed|signature verified')
        doc = (root / 'docs/authoring/PINNED-WORKFLOW.md').read_text()
        self.assertNotIn('Option A', doc)  # not described as planned work


if __name__ == '__main__':
    unittest.main()
