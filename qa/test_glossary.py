"""Focused optional-glossary policy and romanised rendering regressions."""
import copy,json,pathlib,subprocess,unittest
import authoring_contract as policy
ROOT=pathlib.Path(__file__).resolve().parents[1]
class GlossaryTests(unittest.TestCase):
 def row(self):return {'term':'hongaku','lang':'ja','language':'Japanese','roman':'hongaku','say':'hon-gah-koo','en':'Original enlightenment.','note':'Synthetic test explanation.','source_url':'https://example.com/source'}
 def test_valid_glossary(self):
  row=self.row();out=policy.validate_glossary({'entries':[row]},[{'url':row['source_url']}],'hongaku');self.assertEqual(out['hongaku']['en'],row['en'])
 def test_reject_absent_duplicate_unsourced_or_wrong_type(self):
  for field,value in [('term','absent'),('source_url','https://example.com/wrong'),('en',''),('note',[])]:
   with self.subTest(field=field):
    row=self.row();row[field]=value
    with self.assertRaises(ValueError):policy.validate_glossary({'entries':[row]},[{'url':'https://example.com/source'}],'hongaku')
  with self.assertRaises(ValueError):policy.validate_glossary({'entries':[self.row(),self.row()]},[{'url':'https://example.com/source'}],'hongaku')
 def test_glossary_prompt_is_versioned_and_same_pin(self):
  c=policy.contract();self.assertEqual(c['model'],'claude-opus-5-5');self.assertFalse(c['fallback']);self.assertEqual(c['glossary']['prompt_sha256'],policy.sha(policy.GLOSSARY_PROMPT.encode()))
 def test_romanised_and_chinese_matcher(self):
  script=r'''
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('static/wisdom.js','utf8');const fn=src.slice(src.indexOf(' function glossed('),src.indexOf(' function entryActions('));
const ctx={data:{glosses:Object.fromEntries(['hongaku','Sōtō','dhātu-vāda','道','無為','無','Zen','<unsafe>'].map(k=>[k,{en:'meaning',lang:'ja'}]))},esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')};vm.createContext(ctx);vm.runInContext(fn,ctx);
let h=ctx.glossed('Hongaku, Sōtō and dhātu-vāda; hongakuish, prehongaku, Zenobia. 無為道 &lt;unsafe&gt;');
assert.equal((h.match(/class="wb-gloss"/g)||[]).length,6);assert(h.includes('>Hongaku</span>'));assert(h.includes('>無為</span>'));assert(!h.includes('><unsafe></span>'));
assert.equal(h.replace(/<[^>]+>/g,''),'Hongaku, Sōtō and dhātu-vāda; hongakuish, prehongaku, Zenobia. 無為道 &lt;unsafe&gt;');
assert.equal(ctx.glossed('<a href="/hongaku">hongaku</a><code>hongaku</code>'),'<a href="/hongaku">hongaku</a><code>hongaku</code>');
assert(ctx.glossed('<em>hongaku</em>').includes('class="wb-gloss"'));console.log('romanised/CJK/boundaries/escaping/text preservation PASS');
'''
  subprocess.run(['node','-e',script],cwd=ROOT,check=True,capture_output=True,text=True)
 def test_glossary_stage_runs_through_the_pinned_helper_loop(self):
  # Integration of the glossary stage with the retrying helper (#10) and kept evidence (option C).
  import os,tempfile
  from unittest.mock import patch
  from tools.author_chapter import author
  usage={'claude-opus-5-5':{'canonicalModel':'claude-opus-5-5','provider':'firstParty','outputTokens':90}}
  bad=self.row();bad['source_url']='https://example.com/wrong'
  answers=[{'entries':[bad]},{'entries':[self.row()]}];seen=[]
  def run(argv,**kw):
   seen.append((argv[argv.index('--system-prompt')+1],json.loads(kw['input'])))
   kw['stdout'].write(json.dumps({'is_error':False,'modelUsage':usage,'structured_output':answers[len(seen)-1]}).encode())
   return subprocess.CompletedProcess(argv,0)
  with tempfile.TemporaryDirectory() as t:
   p=pathlib.Path(t);(p/'brief').write_text('Chapters mention hongaku.');(p/'sources').write_text(json.dumps([{'url':'https://example.com/source','text':'hongaku source'}]))
   with patch('tools.author_chapter.shutil.which',return_value='/synthetic/claude'),patch('tools.author_chapter.subprocess.run',side_effect=run),patch.dict(os.environ,{'ANTHROPIC_BASE_URL':'https://api.anthropic.com'}):
    record=author('synthetic',p/'brief',p/'sources',p/'glosses.json',p/'g.receipt.json',glossary=True)
   self.assertEqual(len(seen),2);self.assertEqual(seen[0][0],policy.GLOSSARY_PROMPT)
   self.assertEqual(seen[1][1]['revision_request']['previous_output'],{'entries':[bad]})
   self.assertEqual(record['workflow'],'wisdom.glossary-authoring');self.assertEqual(record['attempt'],2)
   self.assertEqual(json.loads((p/'glosses.json').read_text())['hongaku']['en'],'Original enlightenment.')
   self.assertTrue((p/'g.receipt.json.sources.json').is_file());self.assertEqual(len(list((p/'rejected').glob('*.rejected.json'))),1)
if __name__=='__main__':unittest.main()
