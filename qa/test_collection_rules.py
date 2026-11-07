"""Synthetic contract cases; never reads an owner's library or calls a model."""
import base64
import os
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import authoring_contract as policy
import authoring_admission as admission
import authoring_toolkit as toolkit
import library
from qa.authoring_fixture import fixture
from qa.test_authoring_admission import receipt, evidence, rezip, SOURCES
from tools.author_collection import export_collection


def scripture():
    return ('# A classic — two lines\n*An invented QA source · ~3 minutes*\n\n'
            '## The lines\n\n> 道\n> A synthetic way opens. [1]\n\n'
            '## The compression\n\n**My compression: attention begins before naming.**\n\n'
            '## Reading it slowly\n\n**Look.** ' + 'Attend to the example slowly. ' * 28 +
            '\n\n**Pause.** ' + 'A second look notices more. ' * 28 +
            '\n\n**Read.** ' + 'Return carefully to the page. ' * 28 +
            '\n\n## In your life\n\nA decision can wait for one more careful look.\n\n'
            '## The practice\n\nReturn to one page before choosing.\n\n'
            '## Carry this question\n\nWhat did you notice?\n\n'
            '## Sources\n\n[1] https://example.org/source — synthetic fixture\n')


def story():
    return ('# A symbolic story — one return\n*An invented QA source · ~2 minutes*\n\n'
            '## The story\n\n' + 'A fictional traveller returns to the same quiet gate. ' * 20 +
            '\n\n## The compression\n\n**My compression: the return can change the question.**\n\n' +
            'A different question lets a familiar place become visible again. ' * 7 +
            '\n\n## Carry this question\n\nWhat changes when you return?\n\n'
            '## Sources\n\n[1] https://example.org/source — invented test story, not historical evidence\n')


class RulesCase(unittest.TestCase):
    def test_contract_and_toolkit_carry_rules_and_form_prompts(self):
        c, raw = toolkit.snapshot()
        self.assertEqual((c['provider'], c['model'], c['cli_provider'], c['fallback']),
                         ('anthropic', 'claude-opus-5-5', 'firstParty', False))
        rules = (policy.ROOT / 'collection-rules.md').read_bytes()
        self.assertEqual(c['collection_rules']['sha256'], policy.sha(rules))
        self.assertEqual(c['contract_identity']['collection_rules_sha256'], policy.sha(rules))
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            self.assertEqual(z.read('authoring/collection-rules.md'), rules)
            self.assertIn('authoring/form-prompts.json', z.namelist())
        self.assertIn(c['collection_rules']['text'], policy.request_input('A topic'))
        for forbidden in ['/home/', '/Users/', '.ts.net', 'Wizard OS', *filter(None, os.environ.get('WISDOM_OWNER_TERMS', '').split(','))]:
            self.assertNotIn(forbidden, rules.decode())
        for form, stage in c['forms'].items():
            self.assertEqual(stage['prompt_sha256'], policy.sha(stage['prompt_text'].encode()))
            self.assertEqual(stage['format'], form)

    def test_good_teaser_and_short_nonpayoff_are_accepted(self):
        body = 'An opening paragraph.\n## The compression\n\n**My compression: Attend before naming the world.**\n\n## Sources\n'
        self.assertTrue(policy.validate_deck('What changes when you pause?', body))
        self.assertTrue(policy.validate_deck('An opening paragraph.', body))

    def test_bad_deck_copy_fails_even_with_case_or_whitespace_changes(self):
        sentence = 'A patient look reveals the object before a name fixes it.'
        with self.assertRaisesRegex(ValueError, 'over 30'):
            policy.validate_deck('A question? ' + sentence.upper(), '# Title\n' + sentence.replace(' ', '  '))

    def test_bad_similar_compression_fails_without_exact_copy(self):
        body = '## The compression\n**My compression: Attention before naming makes another choice possible.**\n\n## Sources\n'
        with self.assertRaisesRegex(ValueError, 'similarity'):
            policy.validate_deck('Attention before naming makes a different choice possible?', body)

    def test_export_rejects_bad_deck_before_producing_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); d = fixture(root)
            d['entries'][0]['deck'] = 'Quiet attention begins with one thing. '
            (root / 'content/catalog.json').write_text(json.dumps(d))
            with self.assertRaisesRegex(ValueError, 'over 30'):
                export_collection(root, 'new-study', license='Private QA', attribution='Synthetic')

    def test_scripture_good_and_bad_samples(self):
        body = scripture()
        packet = [{'url': 'https://example.org/source', 'text': '道 A synthetic way opens.'}]
        self.assertEqual(policy.chapter_format(body), 'wisdom.scripture-study.v1')
        self.assertGreater(policy.validate_chapter(body, packet)['words'], 450)
        for bad in [body.replace('## The practice', '## Practice'),
                    body.replace('**Read.**', 'Read.'),
                    body.replace('A synthetic way opens.', 'An invented translation.'),
                    body.replace('What did you notice?', 'What did you notice? What next?')]:
            with self.subTest(bad=bad[-200:]), self.assertRaises(ValueError):
                policy.validate_chapter(bad, packet)

    def test_story_good_and_bad_samples(self):
        body = story()
        packet = json.loads(SOURCES)
        self.assertEqual(policy.chapter_format(body), 'wisdom.symbolic-story.v1')
        self.assertLess(policy.validate_chapter(body, packet)['words'], 450)
        for bad in [body.replace('## The story', '## A story'),
                    body.replace('**My compression:', '**The compression:'),
                    body.replace('What changes when you return?', 'What changes? What returns?'),
                    body.replace('A fictional traveller returns to the same quiet gate. ' * 20, 'A traveller returns. ' * 10),
                    body.replace('A different question', '“An unsourced quotation” and a different question', 1)]:
            with self.subTest(bad=bad[-200:]), self.assertRaises(ValueError):
                policy.validate_chapter(bad, packet)

    def test_selected_form_runner_emits_matching_receipt_and_sources(self):
        from tools import author_chapter as runner
        from qa.test_authoring_admission import cli_result
        for body in [scripture(), story()]:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                brief = root / 'brief.txt'; brief.write_text('Synthetic QA; no real person.')
                sources = root / 'sources.json'
                sources.write_text(json.dumps([{'url': 'https://example.org/source', 'text': '道 A synthetic way opens.'}]))
                output = root / 'accepted.md'; record = root / 'receipt.json'
                form = policy.chapter_format(body)
                raw = cli_result('synthetic-form', body.encode())
                with patch.object(runner, 'route_guard', return_value='synthetic-cli'), patch.object(runner, 'call_author', return_value=raw) as call:
                    runner.author('synthetic-form', brief, sources, output, record, format=form)
                c = policy.contract()
                self.assertEqual(call.call_args.args[6]['prompt_sha256'], c['forms'][form]['prompt_sha256'])
                self.assertEqual(output.read_bytes(), body.encode())
                r = json.loads(record.read_text())
                self.assertEqual(r['collection_rules_sha256'], c['collection_rules']['sha256'])
                admission.check_record('synthetic-form', r, output.read_bytes(), c)
                admission.check_evidence('synthetic-form', r, output.read_bytes(), {
                    admission.output_name('synthetic-form'): raw,
                    admission.sources_name(policy.sha(sources.read_bytes())): sources.read_bytes()})

    def test_story_optional_blockquote_is_not_a_verbatim_check_escape(self):
        body = story().replace('## The compression', '> Invented quotation with no source. [1]\n\n## The compression')
        with self.assertRaisesRegex(ValueError, 'Every block quotation'):
            policy.validate_chapter(body, json.loads(SOURCES))

    def test_form_receipts_are_checked_not_silently_downgraded(self):
        for text in [scripture(), story()]:
            c = policy.contract(); stage = c['forms'][policy.chapter_format(text)]
            b = text.encode(); record = receipt('synthetic-form', b,
                format=stage['format'], workflow=stage['id'], workflow_version=stage['version'],
                prompt_sha256=stage['prompt_sha256'], collection_rules_sha256=c['collection_rules']['sha256'])
            admission.check_record('synthetic-form', record, b, c)
            for field, value in [('prompt_sha256', '0' * 64), ('format', 'wisdom.compression.v1'),
                                 ('collection_rules_sha256', '0' * 64)]:
                with self.subTest(field=field), self.assertRaises(admission.Refused):
                    admission.check_record('synthetic-form', dict(record, **{field: value}), b, c)


if __name__ == '__main__':
    unittest.main()
