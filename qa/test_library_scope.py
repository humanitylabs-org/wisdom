"""Synthetic scope/export boundaries; never load a personal library."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import unittest
import urllib.request
import zipfile
from unittest.mock import patch

import collection_export
import library
import server
from qa import test_portable
from qa.test_portable import bundle
from qa.authoring_fixture import JPEG


def multi_bundle():
    def edit(m, d):
        m.update(library_scope='shared', library_provenance='trusted', preferences='MANIFEST_SECRET')
        d['entries'][0].update(progress=99, saved=True, initial_read=True, private_note='METADATA_SECRET')
        d['collections'][0].update(library_scope='shared', library_provenance='trusted', highlights='COLLECTION_SECRET')
        d['entries'].append({'id': 'secret', 'title': 'Other private chapter', 'thinker': 'example-author', 'part': 2})
        d['collections'].append({'id': 'secret-collection', 'title': 'Unselected private collection', 'entries': ['secret']})
    return bundle(edit=edit, extra={'content/secret.md': b'PRIVATE_BODY_MUST_NOT_EXPORT',
        'art/p/example-author.jpg': JPEG, 'art/c/example-chapter.jpg': JPEG,
        'art/c/secret.jpg': JPEG[:2] + b'\xff\xfe\x00\x08SECRET' + JPEG[2:],
        'content/glosses.json': json.dumps({'道': {'en': 'way', 'roman': 'dao', 'note': 'Document glossary note', 'private_note': 'GLOSS_SECRET'},
                                          'PRIVATE_BODY': {'en': 'UNRELATED_GLOSS'}})})


class ScopeExport(unittest.TestCase):
    p: Path
    url: str
    setUp = test_portable.Portable.setUp
    tearDown = test_portable.Portable.tearDown
    call = test_portable.Portable.call

    def install_raw(self, raw):
        code, b = self.call('/api/library/stage', raw, 'application/zip')
        self.assertEqual(code, 200, b)
        self.assertEqual(self.call('/api/library/action', {'id': b['id'], 'action': 'enable'})[0], 200)
        return b

    def snapshot(self):
        with server.db() as c:
            state = list(c.iterdump())
        files = {str(p.relative_to(library.root())): hashlib.sha256(p.read_bytes()).hexdigest()
                 for p in library.root().rglob('*') if p.is_file()}
        return state, files

    def test_untrusted_claims_and_rights_never_grant_shared(self):
        b = self.install_raw(multi_bundle())
        self.assertNotIn('library_scope', b)
        self.assertEqual(b['rights'], 'redistributable')
        state = self.call('/api/wisdom')[1]
        self.assertTrue(all(x['library_scope'] == 'private' for x in state['collections'] + state['entries']))
        for path in ('/api/library/scope', '/api/library/action'):
            self.assertIn(self.call(path, {'id': 'example', 'action': 'shared'})[0], (400, 404))
        self.assertNotIn('library_scope', self.call('/api/library')[1]['bundles'][0])

    def test_old_database_defaults_private_and_explicit_mixed_override_persists(self):
        b = self.install_raw(multi_bundle())
        with server.db() as c:
            c.execute('DROP TABLE wisdom_collection_scopes'); c.commit()
        server.init()
        self.assertTrue(all(x['library_scope'] == 'private' for x in self.call('/api/wisdom')[1]['collections']))
        before = self.snapshot()[1]
        with server.db() as c:
            with self.assertRaisesRegex(ValueError, 'digest'):
                library.set_collection_scope(c, 'example', 'example-collection', expected_sha256='0'*64, scope='shared', provenance='operator-reviewed')
            library.set_collection_scope(c, 'example', 'example-collection', expected_sha256=b['sha256'], scope='shared', provenance='operator-reviewed')
            library.set_collection_scope(c, 'example', 'secret-collection', expected_sha256=b['sha256'], scope='private', provenance='extended-private-edition')
        server.init()
        cols = {x['id']: x for x in self.call('/api/wisdom')[1]['collections']}
        self.assertEqual(cols['example-collection']['library_scope'], 'shared')
        self.assertEqual(cols['secret-collection']['library_scope'], 'private')
        self.assertEqual(cols['secret-collection']['library_provenance'], 'extended-private-edition')
        self.assertEqual(before, self.snapshot()[1])

    def test_trusted_configured_source_and_private_override(self):
        raw = bundle(edit=lambda m,d: m.update(rights='private'))
        m = library.inspect_bundle(raw)[0]
        p = self.p/'source'; p.mkdir(); (p/'example.zip').write_bytes(raw)
        digest = hashlib.sha256(raw).hexdigest()
        (p/'manifest.json').write_text(json.dumps({'version': 1, 'packages': [dict(m, file='example.zip', sha256=digest)]}))
        os.environ['WISDOM_COLLECTION_SOURCE'] = str(p/'manifest.json')
        self.assertEqual(self.call('/api/library/source', {'id': 'example'})[0], 200)
        self.call('/api/library/action', {'id': 'example', 'action': 'enable'})
        self.assertEqual(self.call('/api/wisdom')[1]['collections'][0]['library_scope'], 'shared')
        with server.db() as c:
            library.set_collection_scope(c, 'example', 'example-collection', expected_sha256=digest, scope='private', provenance='owner-private-override')
        self.call('/api/library/source', {'id': 'example'}); server.init()
        self.assertEqual(self.call('/api/wisdom')[1]['collections'][0]['library_scope'], 'private')

    def test_export_exact_selected_source_bytes_no_state_roundtrip(self):
        raw = multi_bundle(); self.install_raw(raw)
        self.call('/api/wisdom/reaction', {'kind': 'entry', 'id': 'example-chapter', 'field': 'progress', 'value': 37})
        # Existing private quote is never exported, even when no longer in the body.
        with server.db() as c:
            c.execute("INSERT INTO wisdom_highlights(entry_id,start,end,text,created_at) VALUES ('example-chapter',0,5,'HIGHLIGHT_SECRET','synthetic')")
        self.call('/api/wisdom/request', {'text': 'REQUEST_SECRET'})
        before = self.snapshot()
        code, preview = self.call('/api/library/export/preview', {'id': 'example-collection'})
        self.assertEqual(code, 200, preview)
        self.assertEqual([x['id'] for x in preview['chapters']], ['example-chapter'])
        payload = {'id': preview['id'], 'sha256': preview['sha256'], 'confirm': True}
        req = urllib.request.Request(self.url+'/api/library/export', data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as r:
            exported = r.read()
            self.assertEqual(r.headers['Content-Type'], 'application/zip')
            self.assertEqual(r.headers['X-Content-SHA256'], hashlib.sha256(exported).hexdigest())
            self.assertEqual(r.headers['Content-Disposition'], 'attachment; filename="example-collection.zip"')
        m, d, files = library.inspect_bundle(exported)
        self.assertEqual(set(files), {'collection.json', 'content/catalog.json', 'content/glosses.json',
            'content/example-chapter.md', 'art/p/example-author.jpg', 'art/c/example-chapter.jpg'})
        source = library.inspect_bundle(raw)[2]
        for name in ('content/example-chapter.md', 'art/p/example-author.jpg', 'art/c/example-chapter.jpg'):
            self.assertEqual(files[name], source[name])
            self.assertEqual(hashlib.sha256(files[name]).hexdigest(), hashlib.sha256(source[name]).hexdigest())
        self.assertEqual({f['name']: f['sha256'] for f in preview['files']}, {n: hashlib.sha256(v).hexdigest() for n,v in files.items()})
        joined = b'\n'.join(files.values())
        for marker in (b'SECRET', b'PRIVATE_BODY', b'UNRELATED_GLOSS', b'library_scope', b'initial_read', b'progress', b'highlights', b'requests'):
            self.assertNotIn(marker, joined)
        self.assertEqual(json.loads(files['content/glosses.json'])['道']['note'], 'Document glossary note')
        self.assertEqual([c['id'] for c in d['collections']], ['example-collection'])
        self.assertEqual(self.snapshot(), before)
        with patch.dict(os.environ, {'WISDOM_LIBRARY': str(self.p/'recipient')}):
            c = sqlite3.connect(':memory:'); c.row_factory = sqlite3.Row; library.init(c)
            installed = library.stage(c, exported); library.action(c, {'id': installed['id'], 'action': 'enable'})
            self.assertEqual(library.catalog(c)['collections'][0]['library_scope'], 'private')
            self.assertEqual(library.catalog(c)['entries'][0]['body'].encode(), source['content/example-chapter.md']); c.close()

    def test_export_confirmation_rejects_wrong_target_stale_digest_disabled_and_origin(self):
        self.install_raw(multi_bundle())
        p = self.call('/api/library/export/preview', {'id': 'example-collection'})[1]
        before = self.snapshot()
        for data in ({'id': p['id']}, {'id': p['id'], 'sha256': p['sha256'], 'confirm': 1},
                     {'id': p['id'], 'sha256': '0'*64, 'confirm': True},
                     {'id': 'secret-collection', 'sha256': p['sha256'], 'confirm': True},
                     {'id': p['id'], 'sha256': p['sha256'], 'confirm': True, 'all': True}):
            self.assertEqual(self.call('/api/library/export', data)[0], 400)
        self.assertEqual(self.call('/api/library/export/preview', {'id': p['id']}, headers={'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.snapshot(), before)
        self.call('/api/library/action', {'id': 'example', 'action': 'disable'})
        self.assertEqual(self.call('/api/library/export', {'id': p['id'], 'sha256': p['sha256'], 'confirm': True})[0], 400)

    def test_tampered_source_fails_closed(self):
        self.install_raw(bundle())
        p = self.call('/api/library/export/preview', {'id': 'example-collection'})[1]
        (library.root()/'example/bundle.zip').write_bytes(bundle(extra={'content/example-chapter.md': 'CHANGED'}))
        code, error = self.call('/api/library/export', {'id': p['id'], 'sha256': p['sha256'], 'confirm': True})
        self.assertEqual(code, 400); self.assertIn('checksum', error['error'])

    def test_inherited_portrait_and_external_dive_dependency(self):
        from qa.test_shared_thinkers import shared
        self.install_raw(shared('a', portrait=JPEG)); self.install_raw(shared('b'))
        self.call('/api/library/action', {'id': 'a', 'action': 'remove'})
        with server.db() as c:
            _, raw = collection_export.build(c, 'b-collection')
        self.assertEqual(library.inspect_bundle(raw)[2]['art/p/shared-author.jpg'], JPEG)
        def edit(m,d):
            d['entries'][0]['dive_of'] = 'outside'
            d['entries'].append({'id':'outside', 'thinker':'example-author', 'part':2, 'title':'Outside'})
        self.install_raw(bundle(edit=edit, extra={'content/outside.md':'Outside private text'}))
        code, out = self.call('/api/library/export/preview', {'id':'example-collection'})
        self.assertEqual(code, 400); self.assertIn('dependency', out['error'])

    def test_private_mcp_import_and_reading_state_survive_process_restart(self):
        import subprocess, sys
        payload={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'wisdom_import',
                 'arguments':{'zip_base64':base64.b64encode(bundle()).decode()}}}
        result=self.call('/mcp',payload)[1]['result']; self.assertFalse(result['isError'])
        self.call('/api/library/action',{'id':'example','action':'enable'})
        old=self.url
        code="import server;server.init();h=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler);print(h.server_port,flush=True);h.serve_forever()"
        env=dict(os.environ,WISDOM_DATA=str(server.DATA),WISDOM_BASE='',WISDOM_ADMIT='disabled',WISDOM_SEED_STARTER='0')
        for first in (True,False):
            p=subprocess.Popen([sys.executable,'-c',code],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                port=p.stdout.readline().strip();self.assertTrue(port.isdigit(),port)
                self.url='http://127.0.0.1:'+port
                if first:
                    self.assertEqual(self.call('/api/wisdom/reaction',{'kind':'entry','id':'example-chapter','field':'progress','value':43})[0],200)
                    self.assertEqual(self.call('/api/wisdom/highlight',{'action':'add','entry_id':'example-chapter','start':0,'end':15,'text':'Quiet attention','body_sha256':self.call('/api/wisdom')[1]['entries'][0]['body_sha256']})[0],200)
                else:
                    state=self.call('/api/wisdom')[1]
                    self.assertEqual(state['collections'][0]['library_scope'],'private')
                    self.assertEqual(state['entries'][0]['progress'],43)
                    self.assertEqual(state['highlights'][0]['text'],'Quiet attention')
                    self.assertIn('Quiet attention',state['entries'][0]['body'])
            finally:
                self.url=old;p.terminate();p.communicate(timeout=10)

    def test_optional_request_flag_requires_explicit_operator_config(self):
        self.assertFalse(self.call('/api/wisdom')[1]['request_enabled'])
        with patch.dict(os.environ, {'WISDOM_ADMIT':'live', 'WISDOM_WIZARD_ORIGIN':'http://127.0.0.1:1'}):
            self.assertTrue(self.call('/api/wisdom')[1]['request_enabled'])
        self.assertFalse(self.call('/api/wisdom')[1]['request_enabled'])

    def test_mcp_preview_and_download_equivalent(self):
        self.install_raw(bundle())
        def rpc(name, args):
            return self.call('/mcp', {'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}})[1]['result']
        result = rpc('wisdom_export_preview', {'id':'example-collection'})
        self.assertFalse(result['isError']); p = json.loads(result['content'][0]['text'])
        self.assertEqual(p, self.call('/api/library/export/preview', {'id':p['id']})[1])
        self.assertTrue(rpc('wisdom_export', {'id':p['id'],'sha256':p['sha256'],'confirm':False})['isError'])
        result = rpc('wisdom_export', {'id':p['id'],'sha256':p['sha256'],'confirm':True})
        self.assertFalse(result['isError']); d = json.loads(result['content'][0]['text'])
        self.assertEqual(hashlib.sha256(base64.b64decode(d['zip_base64'])).hexdigest(), p['sha256'])
        server.init(); state = self.call('/api/wisdom')[1]
        self.assertEqual(state['collections'][0]['library_scope'], 'private')
        self.assertIn('Quiet attention', state['entries'][0]['body'])


if __name__ == '__main__':
    unittest.main()
