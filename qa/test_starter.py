import hashlib, os, pathlib, sqlite3, tempfile, unittest
from unittest.mock import patch
import library, server, starter, wisdom

BUNDLES=sorted((pathlib.Path(starter.__file__).parent/'starter').glob('*.zip'))
needs_bundles=unittest.skipUnless(len(BUNDLES)==4,'private starter bundles are not in this checkout')

class Starter(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); self.p=pathlib.Path(self.tmp.name)
  self.env=patch.dict(os.environ,{'WISDOM_DATA':str(self.p/'data'),'WISDOM_LIBRARY':str(self.p/'media'),'WISDOM_STARTER_DIR':str(pathlib.Path(starter.__file__).parent/'starter')});self.env.start()
  self.data=patch.object(server,'DATA',self.p/'data');self.data.start()
 def tearDown(self):self.data.stop();self.env.stop();self.tmp.cleanup()
 def state(self):
  with server.db() as c:return wisdom.state(c)
 @needs_bundles
 def test_fresh_exact_selection_and_no_owner_state(self):
  server.init(); d=self.state()
  self.assertEqual({c['id'] for c in d['collections']},{'steve-jobs','tao-te-ching','black-mirror','around-every-circle'})
  self.assertEqual(len(d['entries']),45);self.assertEqual(d['highlights'],[]);self.assertEqual(d['requests'],[])
  self.assertTrue(all(c['library_scope']=='shared' for c in d['collections']))
  self.assertTrue(all(c['library_provenance']=='starter:'+starter.SEED_ID for c in d['collections']))
  self.assertNotIn('circle-nagarjuna',{e['id'] for e in d['entries']})
  for e in d['entries']:
   self.assertFalse(e['saved']);self.assertEqual(e['progress'],0);self.assertFalse(e['archived'])
 @needs_bundles
 def test_repeat_keeps_progress_highlight_and_disabled_bundle(self):
  server.init()
  with server.db() as c:
   wisdom.react(c,{'kind':'entry','id':'jobs-focus','field':'progress','value':37})
   # Seed an existing legacy quote; startup must preserve it unchanged.
   c.execute("INSERT INTO wisdom_highlights(entry_id,start,end,text,created_at) VALUES ('jobs-focus',0,7,'QA test','synthetic')")
   library.action(c,{'id':'tao-te-ching','action':'disable'})
   before={p.relative_to(library.root()).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in library.root().rglob('*') if p.is_file()}
  server.init(); d=self.state()
  self.assertEqual(next(e for e in d['entries'] if e['id']=='jobs-focus')['progress'],37)
  self.assertEqual(d['highlights'][0]['text'],'QA test')
  with server.db() as c:self.assertEqual(next(b for b in library.list_bundles(c) if b['id']=='tao-te-ching')['status'],'disabled')
  self.assertEqual(before,{p.relative_to(library.root()).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in library.root().rglob('*') if p.is_file()})
 def test_public_build_without_starter_bundles_starts_empty(self):
  empty=self.p/'no-starter'; empty.mkdir()
  with patch.dict(os.environ,{'WISDOM_STARTER_DIR':str(empty)}):server.init()
  d=self.state(); self.assertEqual(d['collections'],[]); self.assertEqual(d['entries'],[])
 def test_existing_media_never_seeded(self):
  library.root().mkdir();(library.root()/'existing.txt').write_text('untouched')
  server.init();self.assertEqual(self.state()['entries'],[])
  self.assertEqual((library.root()/'existing.txt').read_text(),'untouched')
 @needs_bundles
 def test_starter_export_retains_every_selected_document_and_gloss(self):
  import collection_export,json
  server.init()
  with server.db() as c:
   for b in library.list_bundles(c):
    m,d,source=library.package_files(b)
    col=d['collections'][0]
    preview,raw=collection_export.build(c,col['id'])
    _,exported,files=library.inspect_bundle(raw)
    self.assertEqual(len(exported['collections']),1)
    self.assertEqual([e['id'] for e in exported['entries']],[e['id'] for e in d['entries']])
    self.assertEqual(preview['rights'],m['rights'])
    for name,value in source.items():
     if name.endswith('.md') or name.endswith('.jpg'):self.assertEqual(files[name],value,name)
    gloss=json.loads(source['content/glosses.json'])
    text='\n'.join(v.decode() for n,v in source.items() if n.endswith('.md'))
    self.assertEqual(json.loads(files['content/glosses.json']),{k:v for k,v in gloss.items() if k in text})
 @needs_bundles
 def test_pending_resume_is_idempotent(self):
  server.DATA.mkdir();
  with server.db() as c:
   library.init(c);c.execute('CREATE TABLE wisdom_starter (id TEXT PRIMARY KEY,status TEXT NOT NULL)');c.execute('INSERT INTO wisdom_starter VALUES (?,?)',(starter.SEED_ID,'pending'));c.commit()
   library.stage(c,(pathlib.Path(starter.__file__).parent/'starter/steve-jobs.zip').read_bytes())
  server.init();self.assertEqual(len(self.state()['entries']),45)
  self.assertTrue(all(c['library_scope']=='shared' for c in self.state()['collections']))
  with server.db() as c:self.assertEqual(len(library.list_bundles(c)),4)
if __name__=='__main__':unittest.main()
