"""Offline release guards, copied-core provenance and idempotent server mutations."""
import hashlib
import json
from pathlib import Path
import uuid
import unittest
from unittest.mock import patch
from qa.test_notes import Notes
import server
import wisdom
from tools import offline_shell

ROOT=Path(__file__).resolve().parents[1]

class OfflineShell(unittest.TestCase):
    def test_shell_identity_covers_every_static_byte(self):
        self.assertEqual((ROOT/'static/sw.js').read_text(),offline_shell.worker(), 'Run tools/offline_shell.py after editing the shell')
        self.assertEqual(set(offline_shell.FILES),server.STATIC-{'sw.js'})

    def test_byte_identical_approved_app_kit_with_pinned_source(self):
        provenance=json.loads((ROOT/'qa/offline-kit-source.json').read_text())
        self.assertEqual(provenance['repo'],'humanitylabs-org/wizard-ux')
        self.assertEqual(provenance['commit'],'a1e99c6d60ebf977b59b74633c426e8b97259b83')
        self.assertIn('adaptation',provenance)
        self.assertEqual(set(provenance['files']),{'offline-kit.js','offline-sw.js'})
        for name,digest in provenance['files'].items():self.assertEqual(hashlib.sha256((ROOT/'static'/name).read_bytes()).hexdigest(),digest)

    def test_offline_status_is_temporary_and_never_persistent_while_reading(self):
        adapter=(ROOT/'static/offline.js').read_text()
        css=(ROOT/'static/app.css').read_text()
        self.assertIn("line.dataset.offlineStatus=''",adapter)
        self.assertIn("line.className='wisdom-offline-state'",adapter)
        self.assertIn("addEventListener('offline'",adapter)
        self.assertIn("addEventListener('online'",adapter)
        self.assertNotIn('announce(',adapter)
        self.assertNotIn('item.error,',adapter)
        self.assertIn('#wisdom-offline{display:none!important}',css)

    def test_no_offline_popups_anywhere(self):
        # owner request, 28 Oct: not just chapters; collection/library popups are annoying too.
        adapter=(ROOT/'static/offline.js').read_text()
        self.assertNotIn('el.hidden=false',adapter)
        self.assertNotIn('is-visible',adapter)
        self.assertNotIn('position:fixed',(ROOT/'static/app.css').read_text())
        self.assertIn("checks['no offline popups anywhere']",(ROOT/'qa/offline-status.cjs').read_text())
        self.assertIn("checks['no offline popups anywhere']",(ROOT/'qa/offline-acceptance.cjs').read_text())

    def test_no_popups_while_reading(self):
        app=(ROOT/'static/wisdom.js').read_text()
        self.assertNotIn('could not sync to Wisdom',app)
        self.assertNotRegex(app,r"api\('wisdom/reaction',\{kind:'entry',id:e\.id,field:'progress'[^\n]*?toast\(")
        self.assertIn("checks['no popups while reading']",(ROOT/'qa/offline-status.cjs').read_text())
        self.assertIn('NoPopupWhileReading',(ROOT/'qa/offline-acceptance.cjs').read_text())

    def test_zero_width_pinned_reader_never_saves_non_finite_progress(self):
        app=(ROOT/'static/wisdom.js').read_text()
        self.assertIn('if(W<=0||H<=0||!Number.isFinite(W)||!Number.isFinite(H))return;',app)
        self.assertIn('!Number.isFinite(n)||!Number.isFinite(pages)',app)
        self.assertIn('zero-width pinned reader',(ROOT/'qa/offline-acceptance.cjs').read_text())

    def test_no_forced_reload_or_origin_wide_cache_lookup(self):
        for name in ('offline-kit.js','offline-sw.js'):
            code=(ROOT/'static'/name).read_text()
            self.assertNotIn('location.reload',code);self.assertNotIn('caches.match(',code);self.assertNotIn('clients.navigate',code)

class OfflineReceipts(Notes):
    def setUp(self):
        super().setUp();self.handler=object.__new__(server.Handler);self.key=str(uuid.uuid4());self.handler.headers={'X-Wizard-Offline-Id':self.key}

    def mutate(self,d):
        with server.library.LOCK,server.db() as c:
            out=self.handler.offline_mutation(c,'/api/wisdom/highlight',d,wisdom.highlight);c.commit();return out

    def payload(self):return dict(action='add',entry_id=self.entry['id'],start=0,end=len(self.a),text=self.a,body_sha256=self.entry['body_sha256'],note='Offline thought')

    def test_lost_response_replay_is_exactly_once(self):
        body=self.payload();first=self.mutate(body);again=self.mutate(body)
        self.assertEqual(first['id'],again['id']);self.assertEqual(len(again['highlights']),1)
        with server.db() as c:self.assertEqual(c.execute('SELECT count(*) FROM wisdom_offline_receipts').fetchone()[0],1)

    def test_receipt_rolls_back_with_edit(self):
        with self.assertRaises(RuntimeError):
            with server.library.LOCK,server.db() as c:
                self.handler.offline_mutation(c,'/api/wisdom/highlight',self.payload(),wisdom.highlight)
                raise RuntimeError('simulated crash before commit')
        with server.db() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM wisdom_highlights').fetchone()[0],0)
            self.assertEqual(c.execute('SELECT count(*) FROM wisdom_offline_receipts').fetchone()[0],0)

    def test_same_id_different_payload_rejected(self):
        body=self.payload();self.mutate(body)
        with self.assertRaisesRegex(ValueError,'different change'):self.mutate(dict(body,note='Different'))

    def test_old_body_never_gets_a_success_receipt(self):
        with self.assertRaisesRegex(ValueError,'edition changed'):self.mutate(dict(self.payload(),body_sha256='0'*64))
        with server.db() as c:self.assertEqual(c.execute('SELECT count(*) FROM wisdom_offline_receipts').fetchone()[0],0)

    def test_get_only_launch_does_not_create_outbox_schema(self):
        with server.db() as c:
            wisdom.state(c)
            self.assertIsNone(c.execute("SELECT name FROM sqlite_master WHERE name='wisdom_offline_receipts'").fetchone())

if __name__=='__main__':unittest.main()
