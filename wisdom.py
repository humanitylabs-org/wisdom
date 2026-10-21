"""Evergreen editorial library. No collection, scoring API or paid dependency."""
import datetime as dt
import hashlib,json,math,re,os,sqlite3
import library,contextlib
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parent

def init(c):
 c.executescript('''CREATE TABLE IF NOT EXISTS wisdom_reactions(id TEXT PRIMARY KEY, saved INTEGER NOT NULL DEFAULT 0, read INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS wisdom_thinkers(id TEXT PRIMARY KEY, more INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS wisdom_positions(id TEXT PRIMARY KEY,progress INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS wisdom_dives(seq INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'requested', requested_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS wisdom_highlights(seq INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS wisdom_highlight_history(
 seq INTEGER PRIMARY KEY, entry_id TEXT NOT NULL,
 original_start INTEGER NOT NULL, original_end INTEGER NOT NULL,
 original_text TEXT NOT NULL, source_body TEXT NOT NULL, source_body_sha256 TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'unresolved' CHECK(status IN ('unresolved','reanchored')),
 reason TEXT NOT NULL DEFAULT 'Earlier edition — anchor not verified in current text');''')
 if 'archived' not in {r[1] for r in c.execute('PRAGMA table_info(wisdom_reactions)')}:
  c.execute('ALTER TABLE wisdom_reactions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0')
  c.execute('UPDATE wisdom_reactions SET archived=read')
 if 'rating' not in {r[1] for r in c.execute('PRAGMA table_info(wisdom_reactions)')}:
  # Thumbs on an episode's end page: 1 up, -1 down, 0 unrated. Trains thinker ranking.
  c.execute('ALTER TABLE wisdom_reactions ADD COLUMN rating INTEGER NOT NULL DEFAULT 0')
 if 'note' not in {r[1] for r in c.execute('PRAGMA table_info(wisdom_highlights)')}:
  # A typed or dictated comment on a saved passage (James, 18 Oct). Empty means no note.
  c.execute("ALTER TABLE wisdom_highlights ADD COLUMN note TEXT NOT NULL DEFAULT ''")
 if 'read_at' not in {r[1] for r in c.execute('PRAGMA table_info(wisdom_reactions)')}:
  # When a chapter was marked read: orders Currently reading by most recent activity. Null for older reads.
  c.execute('ALTER TABLE wisdom_reactions ADD COLUMN read_at TEXT')
 # Collection requests from the home screen (James, 12 Oct). Stored first, then handed to Archimedes;
 # session_id/run_id record the admitted build, error the honest reason it wasn't sent.
 c.execute('''CREATE TABLE IF NOT EXISTS wisdom_requests(seq INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested', requested_at TEXT NOT NULL, session_id TEXT, run_id TEXT, sent_at TEXT, error TEXT)''')
 c.execute('''CREATE TABLE IF NOT EXISTS wisdom_request_routes(seq INTEGER PRIMARY KEY, session_id TEXT NOT NULL, payload TEXT NOT NULL, response TEXT)''')
 for e in catalog()['entries']:
  c.execute('INSERT OR IGNORE INTO wisdom_reactions(id,read,archived) VALUES (?,?,?)',(e['id'],int(e.get('initial_read',False)),int(e.get('initial_archived',False))))

def catalog():
 if os.environ.get('WISDOM_LEGACY_QA')=='1':
  d=json.loads((ROOT/'content/catalog.json').read_text())
 else:
  with contextlib.closing(sqlite3.connect(Path(os.environ.get('WISDOM_DATA','/data'))/'wisdom.sqlite')) as c:
   c.row_factory=sqlite3.Row
   d=library.catalog(c)
 live=[]
 for e in d['entries']:
  if not re.fullmatch('[a-z0-9-]{1,64}',e['id']):raise ValueError('Invalid content id')
  if 'body' not in e:
   p=ROOT/'content'/f"{e['id']}.md"
   if not p.exists():continue
   e['body']=p.read_text()
  # Derive from actual displayed bytes, never trust imported catalog metadata.
  e['body_sha256']=hashlib.sha256(e['body'].encode('utf-8')).hexdigest()
  e['words']=len(e['body'].split());e['minutes']=max(1,math.ceil(e['words']/220))
  live.append(e)
 d['entries']=live;ids={e['id'] for e in live}
 for col in d.get('collections',[]):
  if isinstance(col,dict) and isinstance(col.get('entries'),list):col['entries']=[i for i in col['entries'] if i in ids]
 return d

def state(c,day=None):
 d=catalog(); day=day or dt.datetime.now(ZoneInfo(os.environ.get('WISDOM_TIMEZONE','UTC'))).date().isoformat()
 reactions={r['id']:dict(r) for r in c.execute('SELECT * FROM wisdom_reactions')}
 preferences={r['id']:bool(r['more']) for r in c.execute('SELECT * FROM wisdom_thinkers')}
 dives={}
 for r in c.execute("SELECT entry_id,status FROM wisdom_dives ORDER BY seq"):dives[r[0]]=r[1]
 positions={r[0]:(r[1],r[2]) for r in c.execute('SELECT id,progress,updated_at FROM wisdom_positions')}
 for e in d['entries']:
  e['progress'],e['opened_at']=positions.get(e['id'],(0,None))
  e['dive']=dives.get(e['id'])
  e['read_at']=reactions.get(e['id'],{}).get('read_at') if reactions.get(e['id'],{}).get('read') else None
  e.update(read=bool(reactions.get(e['id'],{}).get('read')),saved=bool(reactions.get(e['id'],{}).get('saved')),archived=bool(reactions.get(e['id'],{}).get('archived')),rating=int(reactions.get(e['id'],{}).get('rating') or 0))
 # Episode thumbs aggregate into a per-thinker taste signal (clamped so one streak can't dominate).
 taste={}
 for e in d['entries']:taste[e['thinker']]=taste.get(e['thinker'],0)+e['rating']
 for t in d['thinkers']:
  series=[e for e in d['entries'] if e['thinker']==t['id'] and not e.get('dive_of')]
  for e in d['entries']:
   if e['thinker']==t['id'] and e.get('dive_of'):
    # Deep dives rank like fresh reads so a fulfilled request surfaces promptly.
    e['rank']=(-20 if e['read'] else 14)+(int(hashlib.sha256((day+':'+e['id']).encode()).hexdigest()[:8],16)/0xffffffff)
    e['reason']='The deep dive you asked for'
  # Core sequence starts with part one; overview is always an optional entry.
  unread=[e for e in series if e['part']>0 and not e['read'] and not e['archived']]
  t['next_id']=(unread[0]['id'] if unread else None)
  t['more']=preferences.get(t['id'],False)
  t['taste']=max(-3,min(3,taste.get(t['id'],0)))
  for e in series:
   jitter=int(hashlib.sha256((day+':'+e['id']).encode()).hexdigest()[:8],16)/0xffffffff
   preference_weight=8+int(hashlib.sha256((day+':'+t['id']).encode()).hexdigest()[:8],16)%7
   e['rank']=(-20 if e['read'] else 10)+(4 if e['id']==t['next_id'] else 0)+(preference_weight if t['more'] else 0)+2*t['taste']+jitter
   e['reason']='More from a thinker you chose' if t['more'] else 'Because you liked this thinker' if t['taste']>0 and e['id']!=t['next_id'] else ('Next in your series' if e['id']==t['next_id'] else 'A fresh lens for today')
 def interleave(entries):
  # Each thinker has a queue: preserve numbered-series order, then weave
  # those queues by daily relevance. Repetition never overrides discovery.
  queues={}
  for e in entries:queues.setdefault(e['thinker'],[]).append(e)
  for queue in queues.values():
   queue.sort(key=lambda e:(0 if e['part']>0 else 1,e['part'] if e['part']>0 else 0,e['read'],-e['rank']))
  ordered=[];counts={}
  while queues:
   candidates=[q[0] for q in queues.values()]
   if ordered and len(candidates)>1:candidates=[e for e in candidates if e['thinker']!=ordered[-1]['thinker']]
   recent=[e['thinker'] for e in ordered[-4:]]
   spaced=[e for e in candidates if recent.count(e['thinker'])<2]
   if spaced:candidates=spaced
   # If two favored thinkers lead, reserve the third choice for discovery.
   if len(ordered)==2 and all(preferences.get(e['thinker']) for e in ordered):
    discovery=[e for e in candidates if not preferences.get(e['thinker'])]
    if discovery:candidates=discovery
   e=max(candidates,key=lambda x:x['rank']-2*counts.get(x['thinker'],0))
   ordered.append(e);t=e['thinker'];counts[t]=counts.get(t,0)+1
   queues[t].pop(0)
   if not queues[t]:del queues[t]
  return [e['id'] for e in ordered]
 orders={view:interleave([e for e in d['entries'] if matches(e)]) for view,matches in {
  'to-read':lambda e:not e['archived'],'all':lambda e:True,
  'starred':lambda e:e['saved'],'archived':lambda e:e['archived']}.items()}
 art=ROOT/'static/wisdom-art'
 for t in d['thinkers']:t['portrait']=f"wisdom-art/p/{t['id']}.jpg" if ('p/'+t['id']+'.jpg' in d.get('_art',{}) or os.environ.get('WISDOM_LEGACY_QA')=='1' and (art/'p'/f"{t['id']}.jpg").is_file()) else None
 for e in d['entries']:e['art']=f"wisdom-art/c/{e['id']}.jpg" if ('c/'+e['id']+'.jpg' in d.get('_art',{}) or os.environ.get('WISDOM_LEGACY_QA')=='1' and (art/'c'/f"{e['id']}.jpg").is_file()) else None
 byid={e['id']:e for e in d['entries']}
 for e in d['entries']:
  if e.get('dive_of') and not e['art'] and e['dive_of'] in byid:e['art']=byid[e['dive_of']]['art']
 collect(d,byid)
 fresh_marks(d)
 return dict(d,request_enabled=os.environ.get('WISDOM_ADMIT')=='live' and bool(os.environ.get('WISDOM_WIZARD_ORIGIN')),picks=orders['to-read'][:3],orders=orders,preferences=preferences,day=day,timezone=os.environ.get('WISDOM_TIMEZONE','UTC'),notices=d.get('_notices',[]),highlights=highlights(c),glosses=glosses(d['entries']),requests=requests(c))

def glosses(entries):
 # Foreign phrases the reader underlines; tap one for romanisation, a sound-alike and the meaning
 # (James, 12 Oct). Only phrases that appear in a live chapter are sent.
 text='\n'.join(e['body'] for e in entries)
 if os.environ.get('WISDOM_LEGACY_QA')=='1':
  p=ROOT/'content/glosses.json'
  try:g=json.loads(p.read_text())
  except (OSError,ValueError):return {}
 else:g=catalog().get('_glosses',{})
 return {k:v for k,v in g.items() if isinstance(v,dict) and v.get('en') and k in text}

FRESH_DAYS=7

def fresh_marks(d,now=None):
 """Something James just asked for goes to the front: collections and thinkers carry the time their newest
 chapter was added, and stay 'fresh' for a week until he has read through them."""
 now=now or dt.datetime.now(dt.timezone.utc)
 when=lambda e:dt.datetime.fromisoformat(e.get('published_at','1970-01-01T00:00:00Z').replace('Z','+00:00'))
 byid={e['id']:e for e in d['entries']}
 def mark(x,es):
  es=[e for e in es if e.get('published_at')]
  x['added_at']=max(when(e) for e in es).isoformat() if es else None
  x['fresh']=bool(es) and (now-max(when(e) for e in es)).days<FRESH_DAYS and not all(e['read'] or e['archived'] for e in es)
 for col in d['collections']:mark(col,[byid[i] for i in col['entries']])
 for t in d['thinkers']:mark(t,[e for e in d['entries'] if e['thinker']==t['id']])

def collect(d,byid):
 """Collections are ordered lists of chapters, by one thinker or many. A chapter's number is its place
 in the collection (an overview, if any, sits in front unnumbered). Thinkers stay a separate index."""
 thinkers={t['id']:t for t in d['thinkers']}
 for e in d['entries']:e['collections']=[]
 for col in d.setdefault('collections',[]):
  sections=col.get('sections') or [dict(title='',entries=col.get('entries',[]))]
  col['sections']=[dict(title=s.get('title',''),entries=[i for i in s['entries'] if i in byid]) for s in sections]
  ids=[i for s in col['sections'] for i in s['entries']]
  col['entries']=ids;col.pop('art',None)
  n=0;col['numbers']={}
  for i in ids:
   if i!=col.get('overview'):n+=1;col['numbers'][i]=n
   byid[i]['collections'].append(col['id'])
  col['count']=n
  col['minutes']=sum(byid[i]['minutes'] for i in ids)
  col['read']=sum(1 for i in ids if byid[i]['read'])
  col['done']=sum(1 for i in ids if byid[i]['read'] and i!=col.get('overview'))
  col['last_read_at']=max((byid[i]['read_at'] for i in ids if byid[i].get('read_at')),default=None)
  col['form']=col.get('form') if col.get('form') in ('book','thinker','theme') else 'theme'
  col['by']=col.get('by') or 'Wizard'
  unread=[i for i in ids if i!=col.get('overview') and not byid[i]['read'] and not byid[i]['archived']]
  col['next_id']=unread[0] if unread else None
  members=list(dict.fromkeys(byid[i]['thinker'] for i in ids))
  col['thinkers']=members
  t=thinkers.get(col.get('thinker'))
  col['portrait']=t['portrait'] if t else None
  # A many-minds collection shows its first portraits as a quiet mosaic cover.
  col['mosaic']=[thinkers[m]['portrait'] for m in members if thinkers.get(m,{}).get('portrait')][:4] if not t else []

def highlights(c):
 """Saved quotes, newest first. Historical offsets are not current anchors.

 Only status/reason leave the private history table; old source bodies never do.
 An absent history row preserves the existing current-anchor behavior.
 """
 return [dict(id=r[0],entry_id=r[1],start=r[2],end=r[3],text=r[4],created_at=r[5],anchor_status=r[6],reason=r[7],note=r[8]) for r in c.execute('''
 SELECT h.seq,h.entry_id,h.start,h.end,h.text,h.created_at,
 CASE WHEN old.seq IS NULL THEN 'current' WHEN old.status='reanchored' THEN 'reanchored' ELSE 'unresolved' END,
 COALESCE(old.reason,''),h.note FROM wisdom_highlights h
 LEFT JOIN wisdom_highlight_history old ON old.seq=h.seq ORDER BY h.seq DESC''')]

def quote_in_body(text,body):
 """Check selected prose, ignoring rendering-only Markdown and whitespace.

 Offsets remain rendered UTF-16 positions, not Markdown indices. Edition binding
 is exact; this is a conservative quotation-presence check, not a reanchorer.
 """
 links=[]
 def hold(m):
  links.append(m[1]);return '\x00'+str(len(links)-1)+'\x00'
 rendered=re.sub(r'\[([^\]]+)\]\((https?://[^\s)]+)\)',hold,body)
 rendered=re.sub(r'\*\*([^*]+)\*\*',r'\1',rendered)
 rendered=re.sub(r'\*([^*]+)\*',r'\1',rendered)
 rendered=re.sub(r'\x00(\d+)\x00',lambda m:links[int(m[1])],rendered)
 rendered=re.sub(r'^(?:#{1,4} |[-*] |\d+\. |> ?)', '', rendered,flags=re.M)
 compact=lambda s:re.sub(r'\s+', '', s)
 return compact(text) in compact(rendered)

def quote_in_entry(text,entry):
 """Body prose, or the cover title and summary the reader also lets James select."""
 if quote_in_body(text,entry['body']):return True
 cover=''.join(str(entry.get(k) or '') for k in ('title','deck'))
 return re.sub(r'\s+','',text) in re.sub(r'\s+','',cover)

def highlight(c,d):
 # Identity validation and commit share the revision mutation boundary, even for
 # direct engine callers. No stale reader can slip a quote into the next edition.
 with library.LOCK,c:
  return _highlight(c,d)

NOTE_MAX=8000
def _note(v):
 if type(v) is not str or len(v)>NOTE_MAX:raise ValueError(f'A note is text of at most {NOTE_MAX} characters')
 return v.strip()

def _highlight(c,d):
 if not isinstance(d,dict) or d.get('action') not in ('add','remove','note'):raise ValueError('Unknown highlight action')
 if d['action']=='note':
  # Set or clear (empty text) the note on one saved passage. The quote and anchor are untouched.
  if set(d)!={'action','id','note'} or type(d['id']) is not int:raise ValueError('Set a note on one highlight by id')
  if not c.execute('UPDATE wisdom_highlights SET note=? WHERE seq=?',(_note(d['note']),d['id'])).rowcount:raise ValueError('Unknown highlight')
  return {'highlights':highlights(c),'id':d['id']}
 if d['action']=='remove':
  if set(d)!={'action','id'} or type(d['id']) is not int:raise ValueError('Remove one highlight by id')
  if not c.execute('DELETE FROM wisdom_highlights WHERE seq=?',(d['id'],)).rowcount:raise ValueError('Unknown highlight')
  # Only an explicit removal may discard the private earlier-edition record.
  c.execute('DELETE FROM wisdom_highlight_history WHERE seq=?',(d['id'],))
  return {'highlights':highlights(c),'removed':d['id']}
 if set(d)-{'note'}!={'action','entry_id','start','end','text','body_sha256'}:raise ValueError('Reader edition required; copy your selection, then reopen this chapter')
 note=_note(d.get('note',''))
 e,s,t,text=d['entry_id'],d['start'],d['end'],d['text']
 entry=next((x for x in catalog()['entries'] if x['id']==e),None) if type(e) is str else None
 if not entry:raise ValueError('Unknown Wisdom reading')
 if d['body_sha256']!=entry['body_sha256']:raise ValueError('Chapter edition changed; copy your selection, then reopen this chapter')
 if type(s) is not int or type(t) is not int or not 0<=s<t or t-s>6000:raise ValueError('Invalid highlight range')
 if type(text) is not str or not text.strip() or len(text)>6000:raise ValueError('Invalid highlight text')
 if not quote_in_entry(text,entry):raise ValueError('Highlight text is absent from this chapter edition')
 # Overlapping highlights merge into one, like Kindle. The client sends the merged range and its text.
 rows=c.execute('''SELECT h.seq,h.note FROM wisdom_highlights h
 LEFT JOIN wisdom_highlight_history old ON old.seq=h.seq
 WHERE h.entry_id=? AND h.start<? AND h.end>?
 AND (old.seq IS NULL OR old.status='reanchored')
 ORDER BY h.start,h.seq''',(e,t,s)).fetchall()
 if rows:c.execute(f"DELETE FROM wisdom_highlights WHERE seq IN ({','.join('?'*len(rows))})",[r[0] for r in rows])
 # A merge never drops a note: existing notes keep their passage order, a new one follows.
 notes=[]
 for n in [r[1] for r in rows]+[note]:
  if n and n not in notes:notes.append(n)
 joined='\n\n'.join(notes)
 if len(joined)>NOTE_MAX:raise ValueError('Combined notes are too long; shorten one before extending this highlight')
 now=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
 cur=c.execute('INSERT INTO wisdom_highlights(entry_id,start,end,text,created_at,note) VALUES (?,?,?,?,?,?)',(e,s,t,text,now,joined))
 return {'highlights':highlights(c),'id':cur.lastrowid,'merged':len(rows)}

def react(c,d):
 if set(d)=={'kind','id','field','value'} and d.get('field')=='progress' and d.get('kind')=='entry' and type(d.get('id')) is str and type(d.get('value')) is int and 0<=d['value']<=100:
  if d['id'] not in {e['id'] for e in catalog()['entries']}:raise ValueError('Unknown Wisdom item')
  c.execute('INSERT INTO wisdom_positions(id,progress,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET progress=excluded.progress,updated_at=excluded.updated_at',(d['id'],d['value'],dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')))
  return state(c)
 if set(d)=={'kind','id','field','value'} and d.get('field')=='rating' and d.get('kind')=='entry' and type(d.get('id')) is str and type(d.get('value')) is int and d['value'] in (-1,0,1):
  if d['id'] not in {e['id'] for e in catalog()['entries']}:raise ValueError('Unknown Wisdom item or preference')
  c.execute('INSERT OR IGNORE INTO wisdom_reactions(id) VALUES (?)',(d['id'],))
  c.execute('UPDATE wisdom_reactions SET rating=? WHERE id=?',(d['value'],d['id']))
  return state(c)
 if set(d)!={'kind','id','field','value'} or type(d.get('value')) is not bool or any(type(d.get(k)) is not str for k in ('kind','id','field')):raise ValueError('Use one boolean preference at a time')
 entries=catalog();kind=d['kind'];key=d['id'];field=d['field'];value=int(d['value'])
 if kind=='entry' and field in ('read','saved','archived','done') and key in {e['id'] for e in entries['entries']}:
  if field=='done' and not value:raise ValueError('Restore an archived reading explicitly')
  c.execute('INSERT OR IGNORE INTO wisdom_reactions(id) VALUES (?)',(key,))
  now=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
  if field=='done':
   c.execute('UPDATE wisdom_reactions SET read=1,archived=1,read_at=? WHERE id=?',(now,key))
   # Done means the end page was reached: the reply's snapshot must already show 100% (James, 19 Oct).
   c.execute('INSERT INTO wisdom_positions(id,progress,updated_at) VALUES (?,100,?) ON CONFLICT(id) DO UPDATE SET progress=100,updated_at=excluded.updated_at',(key,now))
  else:c.execute(f'UPDATE wisdom_reactions SET {field}=? WHERE id=?',(value,key))
  if field=='read':c.execute('UPDATE wisdom_reactions SET read_at=? WHERE id=?',(now if value else None,key))
 elif kind=='thinker' and field=='more' and key in {t['id'] for t in entries['thinkers']}:
  c.execute('INSERT INTO wisdom_thinkers(id,more) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET more=excluded.more',(key,value))
 else:raise ValueError('Unknown Wisdom item or preference')
 return state(c)

REQUEST_MAX=2000

def requests(c,limit=8):
 """James's recent collection requests, newest first. QA rows (status 'qa') never show."""
 return [dict(seq=r[0],text=r[1],status=r[2],requested_at=r[3],session_id=r[4],run_id=r[5],sent_at=r[6],error=r[7]) for r in c.execute("SELECT seq,text,status,requested_at,session_id,run_id,sent_at,error FROM wisdom_requests WHERE status!='qa' ORDER BY seq DESC LIMIT ?",(limit,))]

def request_text(d):
 t=d.get('text') if isinstance(d,dict) else None
 if type(t) is not str or not t.strip():raise ValueError('Describe the collection you want')
 t=re.sub(r'\s+',' ',t).strip()
 if len(t)>REQUEST_MAX:raise ValueError('Keep the request under 2000 characters')
 return t

def add_request(c,text,qa=False):
 now=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
 return c.execute('INSERT INTO wisdom_requests(text,status,requested_at) VALUES (?,?,?)',(text,'qa' if qa else 'requested',now)).lastrowid

def get_request(c,seq):
 r=c.execute('SELECT seq,text,status,requested_at,session_id,run_id,sent_at,error FROM wisdom_requests WHERE seq=?',(seq,)).fetchone()
 if not r:raise ValueError('Unknown request')
 return dict(seq=r[0],text=r[1],status=r[2],requested_at=r[3],session_id=r[4],run_id=r[5],sent_at=r[6],error=r[7])

def mark_request(c,seq,session_id=None,run_id=None,error=None):
 """Record the admission outcome: 'building' once Archimedes has the run, 'unsent' when the hand-off failed."""
 cur=get_request(c,seq);now=dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
 status=cur['status'] if cur['status']=='qa' else ('building' if session_id and not error else 'unsent')
 c.execute('UPDATE wisdom_requests SET status=?,session_id=COALESCE(?,session_id),run_id=COALESCE(?,run_id),sent_at=?,error=? WHERE seq=?',(status,session_id,run_id,now if session_id and not error else cur['sent_at'],error,seq))
 return get_request(c,seq)

def dives(c):
 return [dict(seq=r[0],entry_id=r[1],note=r[2],status=r[3],requested_at=r[4]) for r in c.execute('SELECT seq,entry_id,note,status,requested_at FROM wisdom_dives ORDER BY seq')]

def mark_dive(c,seq,status):
 """Editorial fulfilment: mark one request done (deep dive published) or declined."""
 if status not in ('done','declined','requested'):raise ValueError('Unknown status')
 if not c.execute('UPDATE wisdom_dives SET status=? WHERE seq=?',(status,seq)).rowcount:raise ValueError('Unknown request')
