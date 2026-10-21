"""Portable engine contracts, no owner content or real agent submissions."""
import base64, hashlib, io, json, os, pathlib, sqlite3, tempfile, threading, unittest, urllib.request, urllib.error, zipfile
import server, wisdom, library


def bundle(key='example', extra=None, edit=None):
 m={'version':1,'id':key,'title':'Example collection','license':'CC0 (synthetic QA text)','attribution':'Synthetic engine QA fixture','rights':'redistributable'}
 d={'thinkers':[{'id':key+'-author','name':'Example Author','series':'Example','bio':'Test','url':'https://example.org'}], 'entries':[{'id':key+'-chapter','title':'A quiet beginning','thinker':key+'-author','part':1,'deck':'Test reader','source_url':'https://example.org'}], 'collections':[{'id':key+'-collection','title':'Example collection','kind':'Collection','form':'Book','by':'Example Author','thinker':key+'-author','bio':'Test','entries':[key+'-chapter']} ]}
 if edit:edit(m,d)
 files={'collection.json':json.dumps(m).encode(),'content/catalog.json':json.dumps(d).encode(),'content/'+key+'-chapter.md':'# A quiet beginning\n\n## A first thought\n\nQuiet attention begins with one thing. 道 is a word in this synthetic text.\n\n'+ 'Read slowly and return to the moment. '*80,'content/glosses.json':json.dumps({'道':{'en':'way','roman':'dào','say':'dow','language':'Chinese','lang':'zh'}})}
 if extra:files.update(extra)
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for n,b in files.items():
   info=zipfile.ZipInfo(n,(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,b)
 return out.getvalue()

class Portable(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.p=pathlib.Path(self.tmp.name)
  os.environ['WISDOM_DATA']=str(self.p/'data');os.environ['WISDOM_LIBRARY']=str(self.p/'media');os.environ.pop('WISDOM_LEGACY_QA',None);os.environ.pop('WISDOM_COLLECTION_SOURCE',None)
  os.environ['WISDOM_STARTER_DIR']=str(self.p/'no-starter')
  server.DATA=self.p/'data';server.BASE='';server.ADMIT='disabled';server.init()
  self.http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler);server.PORT=self.http.server_port
  threading.Thread(target=self.http.serve_forever,daemon=True).start();self.url='http://127.0.0.1:'+str(server.PORT)
 def tearDown(self):self.http.shutdown();self.http.server_close();self.tmp.cleanup()
 def call(self,path,body=None,typ='application/json',headers=None):
  b=json.dumps(body).encode() if isinstance(body,dict) else body
  req=urllib.request.Request(self.url+path,data=b,headers=dict({'Content-Type':typ},**(headers or {})))
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.loads(r.read())
  except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
 def install(self,key='example'):
  status,b=self.call('/api/library/stage',bundle(key),'application/zip');self.assertEqual(status,200,b);self.assertEqual(b['status'],'staged')
  self.assertEqual(self.call('/api/wisdom')[1]['entries'],[])
  self.assertEqual(self.call('/api/library/action',{'id':key,'action':'enable'})[0],200)
 def test_home_has_no_added_navigation_header(self):
  root=pathlib.Path(server.__file__).parent
  app=(root/'static/app.js').read_text()
  self.assertNotIn('<nav class="wm-nav"',app)
  self.assertIn('Manage collections',app)
  self.assertIn('wm-library-entry',app)
  self.assertIn('data-app="wisdom"',(root/'static/index.html').read_text())
  self.assertIn('Back to reading',(root/'static/manage.js').read_text())

 def test_empty_and_install_read_persist(self):
  self.assertEqual(self.call('/openapi.json')[1]['openapi'],'3.1.0');self.assertEqual(self.call('/healthz')[0],200);self.assertEqual(self.call('/api/library')[1]['bundles'],[]);self.install()
  self.assertIn('Quiet attention',self.call('/api/wisdom')[1]['entries'][0]['body'])
  self.assertEqual(self.call('/api/wisdom/reaction',{'kind':'entry','id':'example-chapter','field':'progress','value':37})[0],200)
  self.assertEqual(self.call('/api/wisdom/highlight',{'action':'add','entry_id':'example-chapter','start':0,'end':15,'text':'Quiet attention','body_sha256':self.call('/api/wisdom')[1]['entries'][0]['body_sha256']})[0],200)
  server.init();d=self.call('/api/wisdom')[1];self.assertEqual(d['entries'][0]['progress'],37);self.assertEqual(d['highlights'][0]['text'],'Quiet attention');self.assertIn('道',d['glosses'])
 def test_disable_remove_reenable_retains(self):
  self.install();self.call('/api/wisdom/reaction',{'kind':'entry','id':'example-chapter','field':'saved','value':True})
  for action in ('disable','enable','remove','enable'):
   self.assertEqual(self.call('/api/library/action',{'id':'example','action':action})[0],200)
   rows=self.call('/api/wisdom')[1]['entries'];self.assertEqual(bool(rows),action=='enable')
   if rows:self.assertTrue(rows[0]['saved'])
  self.assertTrue((self.p/'media/example/bundle.zip').exists())
 def test_idempotent_and_collision(self):
  self.install();self.assertEqual(self.call('/api/library/stage',bundle(),'application/zip')[0],200)
  def collision(m,d):
   d['thinkers'][0]['id']='example-author';d['thinkers'][0]['name']='Conflicting author';d['entries'][0]['thinker']='example-author';d['collections'][0]['thinker']='example-author'
  bad=bundle('other',edit=collision)
  code,out=self.call('/api/library/stage',bad,'application/zip');self.assertEqual(code,400);self.assertIn('metadata',out['error'])
  self.assertEqual(len(self.call('/api/library')[1]['bundles']),1)
 def test_reject_untrusted_archives_without_mutation(self):
  for extra in ({'../escape.py':'x'},{'app.js':'alert(1)'},{'art/p/example-author.jpg':'<script>x</script>'},{'content/unused.md':'hidden'}):
   self.assertEqual(self.call('/api/library/stage',bundle(extra=extra),'application/zip')[0],400,extra)
  self.assertEqual(self.call('/api/library/stage',b'not zip','application/zip')[0],400)
  sy=io.BytesIO()
  with zipfile.ZipFile(sy,'w') as z:
   i=zipfile.ZipInfo('collection.json');i.create_system=3;i.external_attr=0o120777<<16;z.writestr(i,'/etc/passwd')
  self.assertEqual(self.call('/api/library/stage',sy.getvalue(),'application/zip')[0],400)
  self.assertEqual(list((self.p/'media').iterdir()),[])
 def test_source_integrity_and_unavailable(self):
  raw=bundle();source=self.p/'source';source.mkdir();(source/'example.zip').write_bytes(raw)
  man={'version':1,'packages':[{'id':'example','title':'Example collection','license':'CC0 (synthetic QA text)','attribution':'Synthetic engine QA fixture','file':'example.zip','sha256':hashlib.sha256(raw).hexdigest()}]}
  (source/'manifest.json').write_text(json.dumps(man));os.environ['WISDOM_COLLECTION_SOURCE']=str(source/'manifest.json')
  self.assertEqual(len(self.call('/api/library')[1]['source']['packages']),1)
  self.assertEqual(self.call('/api/library/source',{'id':'example'})[0],200)
  self.call('/api/library/action',{'id':'example','action':'enable'});(source/'manifest.json').unlink()
  self.assertEqual(self.call('/api/library')[1]['source']['packages'],[]);self.assertEqual(len(self.call('/api/wisdom')[1]['entries']),1)
 def test_changed_or_symlink_bundle_hidden_state_kept(self):
  self.install();p=self.p/'media/example/bundle.zip';p.unlink();p.symlink_to('/etc/passwd')
  state=self.call('/api/wisdom')[1];self.assertEqual(state['entries'],[]);self.assertTrue(state['notices'])
 def test_origin_missing_integrations(self):
  self.assertEqual(self.call('/api/library/stage',bundle(),'application/zip',{'Origin':'https://evil.example'})[0],403)
  code,d=self.call('/api/wisdom/request',{'text':'Portable QA request'});self.assertEqual(code,502);self.assertTrue(d['saved']);self.assertFalse(d['sent']);self.assertIn('not configured',d['error'])
  self.assertFalse(hasattr(server,'transcribe'))
  self.assertFalse(hasattr(server,'STT_URL'))
  js=(pathlib.Path(server.__file__).resolve().parent/'static/wisdom.js').read_text()
  for capability in ('getUserMedia','MediaRecorder','data-wisdom-mic'):
   self.assertNotIn(capability,js)
  self.assertEqual(self.call('/api/wisdom/transcribe',{})[0],404)
 def test_invalid_metadata_zip_bomb_and_duplicate(self):
  for edit in (lambda m,d:m.update(version=True),lambda m,d:d['entries'][0].update(source_url='javascript:alert(1)'),lambda m,d:d['collections'][0].update(entries=['missing'])):
   self.assertEqual(self.call('/api/library/stage',bundle(edit=edit),'application/zip')[0],400)
  self.assertEqual(self.call('/api/library/stage',bundle(extra={'content/example-chapter.md':'x'*(2*1024*1024+1)}),'application/zip')[0],400)
  buf=io.BytesIO()
  with zipfile.ZipFile(buf,'w') as z:z.writestr('collection.json','{}');z.writestr('collection.json','{}')
  self.assertEqual(self.call('/api/library/stage',buf.getvalue(),'application/zip')[0],400)
  self.assertEqual(self.call('/api/library')[1]['bundles'],[])
 def test_source_checksum_failure_and_mcp_request(self):
  raw=bundle();source=self.p/'source';source.mkdir();(source/'example.zip').write_bytes(raw)
  man={'version':1,'packages':[{'id':'example','title':'Example collection','license':'CC0 (synthetic QA text)','attribution':'Synthetic engine QA fixture','file':'example.zip','sha256':'0'*64}]}
  (source/'manifest.json').write_text(json.dumps(man));os.environ['WISDOM_COLLECTION_SOURCE']=str(source/'manifest.json')
  code,out=self.call('/api/library/source',{'id':'example'});self.assertEqual(code,400);self.assertIn('checksum',out['error']);self.assertEqual(self.call('/api/library')[1]['bundles'],[])
  out=self.call('/mcp',{'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'wisdom_request','arguments':{'text':'A locally saved request'}}})[1]['result'];self.assertFalse(out['isError']);result=json.loads(out['content'][0]['text']);self.assertTrue(result['saved']);self.assertFalse(result['sent']);self.assertEqual(result['http_status'],502)
 def test_orphan_after_rename_recovers_exact_archive(self):
  self.install();self.call('/api/wisdom/reaction',{'kind':'entry','id':'example-chapter','field':'saved','value':True})
  with server.db() as c:c.execute('DELETE FROM wisdom_bundles');c.commit()
  code,out=self.call('/api/library/stage',bundle(),'application/zip');self.assertEqual(code,200);self.assertEqual(out['status'],'staged')
  self.call('/api/library/action',{'id':'example','action':'enable'});self.assertTrue(self.call('/api/wisdom')[1]['entries'][0]['saved'])
 def test_health_reports_storage_failure(self):
  from unittest import mock
  with mock.patch.object(server,'db',side_effect=sqlite3.OperationalError('internal fault')):
   code,out=self.call('/healthz');self.assertEqual(code,503);self.assertFalse(out['ok']);self.assertNotIn('internal fault',out['error'])
 def test_api_mcp_equivalence(self):
  def rpc(name,args={}):
   out=self.call('/mcp',{'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':name,'arguments':args}})[1]['result'];self.assertFalse(out['isError'],out);return json.loads(out['content'][0]['text'])
  self.assertEqual(self.call('/mcp',{'jsonrpc':'2.0','id':0,'method':'initialize','params':{}})[0],200)
  rpc('wisdom_import',{'zip_base64':base64.b64encode(bundle()).decode()});rpc('wisdom_bundle',{'id':'example','action':'enable'})
  rpc('wisdom_reaction',{'kind':'entry','id':'example-chapter','field':'saved','value':True})
  self.assertEqual(rpc('wisdom_state'),self.call('/api/wisdom')[1]);self.assertEqual(rpc('wisdom_library'),self.call('/api/library')[1])

 def test_box_local_agent_on_any_loopback_port_and_foreign_hosts_rejected(self):
  # The App Manager records the host-published loopback port, not the container port; the agent calls that.
  body=json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/list'}).encode()
  for host in ('127.0.0.1:9230','localhost:41000','[::1]:9230','wisdom:9200'):
   req=urllib.request.Request(self.url+'/mcp',data=body,headers={'Content-Type':'application/json','Host':host})
   with urllib.request.urlopen(req,timeout=10) as r:self.assertTrue(json.loads(r.read())['result']['tools'],host)
  for host,origin in (('evil.example',None),('127.0.0.1:9230','https://evil.example'),('attacker.127.0.0.1.nip.io:9230',None)):
   h={'Content-Type':'application/json','Host':host}
   if origin:h['Origin']=origin
   req=urllib.request.Request(self.url+'/mcp',data=body,headers=h)
   with self.assertRaises(urllib.error.HTTPError) as cm:urllib.request.urlopen(req,timeout=10)
   self.assertEqual(cm.exception.code,403,host)
  for path in ('/api/wisdom','/api/library','/'):
   req=urllib.request.Request(self.url+path,headers={'Host':'evil.example'})
   with self.assertRaises(urllib.error.HTTPError) as cm:urllib.request.urlopen(req,timeout=10)
   self.assertEqual(cm.exception.code,421,path)

if __name__=='__main__':unittest.main()
