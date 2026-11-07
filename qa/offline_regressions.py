"""Regression runner: real existing browser tests; all fixtures disposable."""
import json
import os
from pathlib import Path
import subprocess
import time

OUT=Path(os.environ['WISDOM_QA_EVIDENCE']);OUT.mkdir(parents=True,exist_ok=True)
NAMES=['reader_back','home_model','go_deeper_model','browser_home','browser_collection_start',
       'browser_collection_hero_room','browser_opener','browser_notes','browser_cross_page',
       'browser_desktop_mouse','browser_ratings','browser_swipe_anywhere','browser_chapter_end',
       'browser_continue','browser_resume','browser_resize_line','browser_epigraph','browser_epigraph_author','browser_gloss_dropcap']
rows=[]
fixture=subprocess.Popen(['python3','-m','qa.browser_fixture'],env=os.environ,stdout=subprocess.PIPE,text=True)
info=json.loads(fixture.stdout.readline())
for name in NAMES:
    folder=OUT/name;folder.mkdir(exist_ok=True)
    env=dict(os.environ,WISDOM_QA_EVIDENCE=str(folder),WISDOM_QA_BROWSER='chromium',WISDOM_URL=info['url'],WISDOM_QA_FIELD=str(Path(os.environ['WISDOM_QA_CORE']).with_name('focused-field.js')),WISDOM_QA_ASSET=str(Path.cwd()/'static/wisdom.js'))
    t=time.monotonic()
    with (folder/'run.log').open('w') as log:
        try:r=subprocess.run((['node','qa/'+name+'.cjs']+([str(folder)] if name in ('browser_collection_start','browser_collection_hero_room') else [])),env=env,stdout=log,stderr=subprocess.STDOUT,timeout=150);code=r.returncode
        except subprocess.TimeoutExpired:code=124
    row=dict(test=name,exit_code=code,seconds=round(time.monotonic()-t,2));rows.append(row);print(json.dumps(row),flush=True)
    (OUT/'results.json').write_text(json.dumps(rows,indent=2)+'\n')
fixture.terminate();fixture.wait(timeout=10)
assert all(r['exit_code']==0 for r in rows),str([r for r in rows if r['exit_code']])
print('PASS',len(rows),'existing reader/home/surfaces/highlight checks')
