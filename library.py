"""Confined document bundles, stored outside the application image.

No bundle supplies code, HTML, fonts or configuration. Registry state is in
app-data; immutable document trees are in the owner's media library.
"""
import base64, hashlib, io, json, os, re, shutil, stat, threading, uuid, zipfile, copy
from collections import OrderedDict

CACHE = OrderedDict()
from pathlib import Path

import authoring_admission

LOCK = threading.RLock()
MAX = 24 * 1024 * 1024
MAX_FILES = 1500
ID = re.compile(r'[a-z0-9][a-z0-9-]{0,63}\Z')
LEGACY_AUTHORING = {'status': 'unverified', 'reason': 'Imported before Wisdom checked author receipts; authorship unknown'}


def root():
    return Path(os.environ.get('WISDOM_LIBRARY', '/media/Wisdom'))


def init(c):
    c.execute('''CREATE TABLE IF NOT EXISTS wisdom_bundles
        (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, manifest TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'staged')''')
    # Scope is trusted installation state, not a licence or uploaded assertion.
    # An old database has no scope rows, so every existing collection is private.
    c.execute('''CREATE TABLE IF NOT EXISTS wisdom_collection_scopes
        (collection_id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL,
         sha256 TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('private','shared')),
         provenance TEXT NOT NULL)''')
    root().mkdir(parents=True, exist_ok=True)
    import collection_revision
    collection_revision.init(c)


def bounded_json(raw):
    if len(raw) > MAX:
        raise ValueError('Document too large')
    try:
        return json.loads(raw)
    except (ValueError, UnicodeError, RecursionError) as e:
        raise ValueError('Invalid JSON document') from e


def ident(v):
    if not isinstance(v, str) or not ID.fullmatch(v):
        raise ValueError('Invalid document identifier')
    return v


def text(v, limit=12000):
    if not isinstance(v, str) or not v.strip() or len(v) > limit:
        raise ValueError('Missing or oversized text')
    return v


def validate_catalog(d, files):
    if not isinstance(d, dict):
        raise ValueError('Catalog must be an object')
    maps = {}
    for kind in ('thinkers', 'entries', 'collections'):
        rows = d.get(kind)
        if not isinstance(rows, list) or len(rows) > 1000:
            raise ValueError('Catalog needs bounded thinkers, entries and collections')
        m = {}
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('Invalid catalog row')
            key = ident(row.get('id'))
            if key in m:
                raise ValueError('Duplicate identifier')
            m[key] = row
        maps[kind] = m
    if not maps['entries'] or not maps['collections']:
        raise ValueError('Bundle needs chapters and a collection')
    for t in maps['thinkers'].values():
        text(t.get('name'), 500)
    for e in maps['entries'].values():
        text(e.get('title'), 1000)
        if e.get('thinker') not in maps['thinkers'] or type(e.get('part')) is not int or not 0 <= e['part'] <= 10000:
            raise ValueError('Invalid chapter thinker or number')
        if 'content/' + e['id'] + '.md' not in files:
            raise ValueError('Missing chapter document')
        if e.get('dive_of') and e['dive_of'] not in maps['entries']:
            raise ValueError('Invalid deep-dive reference')
        if e.get('published_at'):
            import datetime
            try:
                when = datetime.datetime.fromisoformat(e['published_at'].replace('Z', '+00:00'))
                if when.tzinfo is None:
                    raise ValueError()
            except (ValueError, TypeError, AttributeError):
                raise ValueError('Invalid publication timestamp')
    members = set()
    for col in maps['collections'].values():
        text(col.get('title'), 1000)
        ids = col.get('entries')
        if col.get('sections'):
            if not isinstance(col['sections'], list) or any(not isinstance(s, dict) or not isinstance(s.get('entries'), list) for s in col['sections']):
                raise ValueError('Invalid collection sections')
            ids = [i for s in col['sections'] for i in s['entries']]
        if not isinstance(ids, list) or not ids or any(not isinstance(i, str) or i not in maps['entries'] for i in ids) or len(ids) != len(set(ids)):
            raise ValueError('Invalid or repeated collection chapters')
        if col.get('overview') and col['overview'] not in ids:
            raise ValueError('Overview is not a member')
        if col.get('thinker') and col['thinker'] not in maps['thinkers']:
            raise ValueError('Unknown collection thinker')
        members.update(ids)
    # Standalone chapters remain readable through the thinker index, matching
    # existing private libraries; new bundles need at least one collection.
    # URL fields are text-only and must never create an executable browser link.
    for rows in maps.values():
        for row in rows.values():
            for key in ('url', 'source_url', 'source_link'):
                if row.get(key) and (not isinstance(row[key], str) or not re.match(r'https?://[^\s]+\Z', row[key])):
                    raise ValueError('Only HTTP(S) source links are allowed')
    return d


def jpeg_ok(b):
    if not b.startswith(b'\xff\xd8\xff') or not b.endswith(b'\xff\xd9'):
        return False
    i = 2
    while i + 4 < len(b):
        if b[i] != 255:
            return False
        while i < len(b) and b[i] == 255:
            i += 1
        if i >= len(b):
            return False
        marker = b[i]; i += 1
        if marker in (0xd8, 0xd9) or 0xd0 <= marker <= 0xd7:
            continue
        if i + 2 >= len(b):
            return False
        n = int.from_bytes(b[i:i+2], 'big')
        if n < 2 or i + n > len(b):
            return False
        if marker in (0xc0, 0xc1, 0xc2):
            if n < 8:
                return False
            h = int.from_bytes(b[i+3:i+5], 'big'); w = int.from_bytes(b[i+5:i+7], 'big')
            return 0 < h <= 4096 and 0 < w <= 4096 and h * w <= 12_000_000
        if marker == 0xda:
            return False
        i += n
    return False


def inspect_bundle(raw):
    if not raw or len(raw) > MAX:
        raise ValueError('Bundle too large or empty')
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            infos = z.infolist()
            if not infos or len(infos) > MAX_FILES or sum(i.file_size for i in infos) > MAX:
                raise ValueError('Expanded bundle too large')
            files = {}
            for i in infos:
                n = i.filename
                # No directory entries, symlinks, duplicate names, exotic files or code.
                if n in files or (i.external_attr >> 16) & 0o170000 not in (0, stat.S_IFREG):
                    raise ValueError('Duplicate or non-regular archive member')
                if not (n == 'collection.json' or n in ('content/catalog.json', 'content/glosses.json') or authoring_admission.is_member(n) or re.fullmatch(r'content/[a-z0-9-]{1,64}\.md', n) or re.fullmatch(r'art/[pc]/[a-z0-9-]{1,64}\.jpg', n)):
                    raise ValueError('Unsupported archive member')
                if i.flag_bits & 1 or i.file_size > 2 * 1024 * 1024:
                    raise ValueError('Encrypted or oversized archive member')
                b = z.read(i)
                if n.endswith('.jpg'):
                    if not jpeg_ok(b):
                        raise ValueError('Invalid or oversized JPEG dimensions')
                elif n.endswith('.md'):
                    b.decode('utf-8')
                files[n] = b
    except (zipfile.BadZipFile, RuntimeError, UnicodeError, OSError) as e:
        raise ValueError('Invalid document archive') from e
    m = bounded_json(files.get('collection.json', b''))
    if not isinstance(m, dict) or type(m.get('version')) is not int or m.get('version') != 1:
        raise ValueError('Unsupported bundle version')
    ident(m.get('id')); text(m.get('title'), 1000)
    for field in ('attribution', 'license'):
        text(m.get(field), 4000)
    if m.get('rights') not in ('private', 'redistributable', 'unknown'):
        raise ValueError('Declare private, redistributable or unknown content rights')
    d = validate_catalog(bounded_json(files.get('content/catalog.json', b'')), files)
    if 'content/glosses.json' in files:
        g = bounded_json(files['content/glosses.json'])
        if not isinstance(g, dict) or len(g) > 5000 or any(not isinstance(k, str) or not isinstance(v, dict) or not all(isinstance(x, str) for x in v.values()) for k, v in g.items()):
            raise ValueError('Invalid glosses')
    expected = {'collection.json', 'content/catalog.json', 'content/glosses.json', 'authoring/receipts.json'} | {'content/' + i + '.md' for i in (e['id'] for e in d['entries'])} | {'art/p/' + t['id'] + '.jpg' for t in d['thinkers']} | {'art/c/' + e['id'] + '.jpg' for e in d['entries']}
    # Author evidence (receipt option C): raw output per catalog chapter, digest-named
    # source packets. Admission checks that every packet is referenced by a receipt.
    expected |= {authoring_admission.output_name(i) for i in (e['id'] for e in d['entries'])}
    expected |= {n for n in files if authoring_admission.SOURCES_RE.fullmatch(n)}
    if set(files) - expected:
        raise ValueError('Unreferenced archive payload')
    return m, d, files


def list_bundles(c):
    rows = []
    for r in c.execute('SELECT * FROM wisdom_bundles ORDER BY rowid DESC'):
        m = json.loads(r['manifest'])
        # Never return a caller's self-declared scope/provenance as authority.
        rows.append(dict({k: m[k] for k in ('version', 'id', 'title', 'license',
                         'attribution', 'rights', 'chapters', 'collections') if k in m},
                         status=r['status'], sha256=r['sha256'],
                         # Admission label is installation state decided when bytes entered.
                         authoring=m.get('authoring') or LEGACY_AUTHORING))
    return rows


def collection_scope(c, bundle, key):
    row = c.execute('''SELECT scope,provenance FROM wisdom_collection_scopes
        WHERE collection_id=? AND bundle_id=? AND sha256=?''',
        (key, bundle['id'], bundle['sha256'])).fetchone()
    return {'library_scope': row[0] if row else 'private',
            'library_provenance': row[1] if row else 'private-import'}


def set_collection_scope(c, bundle_id, collection_id, *, expected_sha256, scope, provenance):
    """Trusted OFFLINE operator API; deliberately not exposed over HTTP/MCP.

    Bind approval to verified immutable source bytes. Call under LOCK while the
    installation is stopped for migration; no document or reading ID is changed.
    A private row is an explicit override and survives configured-source retries.
    """
    ident(bundle_id); ident(collection_id)
    if scope not in ('private', 'shared'):
        raise ValueError('Invalid library scope')
    text(provenance, 1000)
    with LOCK:
        b = next((b for b in list_bundles(c) if b['id'] == bundle_id), None)
        if not b or b['sha256'] != expected_sha256:
            raise ValueError('Scope approval requires the exact bundle digest')
        _, d, _ = package_files(b)
        if not any(x['id'] == collection_id for x in d['collections']):
            raise ValueError('Unknown collection in bundle')
        c.execute('''INSERT OR REPLACE INTO wisdom_collection_scopes
            (collection_id,bundle_id,sha256,scope,provenance) VALUES (?,?,?,?,?)''',
            (collection_id, bundle_id, expected_sha256, scope, provenance))
        c.commit()
        return collection_scope(c, b, collection_id)


def approve_source(c, bundle, provenance):
    """Only starter/configured-source callers use this; keep explicit overrides."""
    _, d, _ = package_files(bundle)
    for col in d['collections']:
        if not c.execute('SELECT 1 FROM wisdom_collection_scopes WHERE collection_id=?', (col['id'],)).fetchone():
            set_collection_scope(c, bundle['id'], col['id'], expected_sha256=bundle['sha256'],
                                 scope='shared', provenance=provenance)
    return bundle


def canonical_thinker(row):
    """Object-key order is insignificant; every metadata value remains exact."""
    return json.dumps(row, sort_keys=True, ensure_ascii=False,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def stage(c, raw):
    import authoring_admission
    m, d, files = inspect_bundle(raw)
    m = {k: m[k] for k in ('version', 'id', 'title', 'license', 'attribution', 'rights')}
    # Result admission (#63): wrong-model or hand-edited receipted prose is refused here.
    m['authoring'] = authoring_admission.assess(files, d)
    digest = hashlib.sha256(raw).hexdigest()
    with LOCK:
        prior = c.execute('SELECT id FROM wisdom_bundles WHERE sha256=?', (digest,)).fetchone()
        if prior:
            return next(b for b in list_bundles(c) if b['id'] == prior[0])
        if c.execute('SELECT 1 FROM wisdom_bundles WHERE id=?', (m['id'],)).fetchone():
            raise ValueError('Bundle id already imported; revisions need an explicit migration')
        # Disabled and removed bundles reserve ids too: re-enable cannot corrupt personal state.
        incoming = {t['id']: canonical_thinker(t) for t in d['thinkers']}
        for b in list_bundles(c):
            _, old, old_files = package_files(b)
            for kind in ('entries', 'collections'):
                if {x['id'] for x in old[kind]} & {x['id'] for x in d[kind]}:
                    raise ValueError('Document id collides with an imported bundle')
            for thinker in old['thinkers']:
                key = thinker['id']
                if key not in incoming:
                    continue
                if canonical_thinker(thinker) != incoming[key]:
                    raise ValueError('Shared thinker metadata conflicts with an imported bundle')
                portrait = 'art/p/' + key + '.jpg'
                # Absence is not a deletion or a new portrait identity. A bundle
                # may inherit a retained portrait; two supplied portraits must agree.
                if portrait in files and portrait in old_files and files[portrait] != old_files[portrait]:
                    raise ValueError('Shared thinker portrait conflicts with an imported bundle')
        if len(list_bundles(c)) >= 100:
            raise ValueError('Library is limited to 100 bundles in this version')
        dest = root() / m['id']
        summary = dict(m, chapters=len(d['entries']), collections=len(d['collections']))
        if dest.exists() or dest.is_symlink():
            # A crash after rename but before DB commit leaves an immutable orphan.
            # Recover only the exact uploaded, validated ZIP; never overwrite owner files.
            try:
                package_files({'id': m['id'], 'sha256': digest})
            except (ValueError, OSError):
                raise ValueError('Library folder already exists with different or invalid data')
            c.execute('INSERT INTO wisdom_bundles(id,sha256,manifest,status) VALUES (?,?,?,?)', (m['id'], digest, json.dumps(summary), 'staged'))
            c.commit()
            return dict(summary, status='staged', sha256=digest)
        tmp = root() / ('.import-' + uuid.uuid4().hex)
        try:
            tmp.mkdir(mode=0o700)
            for n, data in files.items():
                p = tmp / n; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
            # Retain original upload for byte-exact private export/recovery.
            (tmp / 'bundle.zip').write_bytes(raw)
            tmp.rename(dest)
            summary = dict(m, chapters=len(d['entries']), collections=len(d['collections']))
            c.execute('INSERT INTO wisdom_bundles(id,sha256,manifest,status) VALUES (?,?,?,?)', (m['id'], digest, json.dumps(summary), 'staged'))
            c.commit()
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            # Files may survive a DB failure; never erase a pre-existing owner directory.
            raise
        return dict(summary, status='staged', sha256=digest)


def action(c, data):
    if set(data) != {'id', 'action'} or data.get('action') not in ('enable', 'disable', 'remove'):
        raise ValueError('Use id and enable, disable or remove')
    key = ident(data['id'])
    with LOCK:
        status = {'enable': 'enabled', 'disable': 'disabled', 'remove': 'removed'}[data['action']]
        if not c.execute('UPDATE wisdom_bundles SET status=? WHERE id=?', (status, key)).rowcount:
            raise ValueError('Unknown bundle')
        c.commit()
        return next(b for b in list_bundles(c) if b['id'] == key)


def package_files(b):
    import collection_revision
    ident(b['id']); collection_revision.digest(b['sha256'])
    edition = collection_revision.edition_path(b['id'], b['sha256'])
    folder = edition if edition.exists() else root() / b['id']
    f = folder / 'bundle.zip'
    if folder.is_symlink() or f.is_symlink() or not f.resolve().is_relative_to(root().resolve()) or f.stat().st_size > MAX:
        raise ValueError('Bundle path invalid')
    st = f.stat()
    token = (str(f.resolve()), b['sha256'], st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
    if token not in CACHE:
        raw = f.read_bytes()
        if hashlib.sha256(raw).hexdigest() != b['sha256']:
            raise ValueError('Bundle checksum changed')
        CACHE[token] = inspect_bundle(raw)
        while len(CACHE) > 4:
            CACHE.popitem(last=False)
    CACHE.move_to_end(token)
    m, d, files = CACHE[token]
    return dict(m), copy.deepcopy(d), files


def catalog(c):
    out = {'thinkers': [], 'entries': [], 'collections': [], '_art': {}, '_glosses': {}, '_notices': []}
    with LOCK:
        bundles = list_bundles(c)
        thinkers = set()
        for b in bundles:
            if b['status'] != 'enabled':
                continue
            try:
                m, d, files = package_files(b)
            except (ValueError, OSError):
                out['_notices'].append(b['title'] + ': bundle unavailable or changed; personal state is retained.')
                continue
            for t in d['thinkers']:
                if t['id'] not in thinkers:
                    thinkers.add(t['id'])
                    out['thinkers'].append(t)
            for col in d['collections']:
                col.update(collection_scope(c, b, col['id']))
                col['bundle_id'] = b['id']
            for e in d['entries']:
                memberships = [col for col in d['collections'] if e['id'] in
                    ([i for s in col['sections'] for i in s['entries']] if col.get('sections') else col['entries'])]
                e['library_scope'] = 'shared' if memberships and all(col['library_scope'] == 'shared' for col in memberships) else 'private'
                e['library_provenance'] = 'collection-membership'
            for kind in ('entries', 'collections'):
                out[kind].extend(d[kind])
            for e in d['entries']:
                e['body'] = files['content/' + e['id'] + '.md'].decode('utf-8')
            for n in files:
                if n.startswith('art/'):
                    out['_art'][n[4:]] = b['id']
            if 'content/glosses.json' in files:
                out['_glosses'].update(bounded_json(files['content/glosses.json']))
        # Soft removal retains immutable documents. Only portraits may be
        # inherited from disabled/removed bundles, and only for thinkers
        # already visible through an enabled collection. Chapter art never leaks.
        missing = {key for key in thinkers if 'p/' + key + '.jpg' not in out['_art']}
        for b in bundles:
            if not missing:
                break
            if b['status'] not in ('disabled', 'removed'):
                continue
            try:
                _, _, files = package_files(b)
            except (ValueError, OSError):
                continue
            for key in tuple(missing):
                portrait = 'p/' + key + '.jpg'
                if 'art/' + portrait in files:
                    out['_art'][portrait] = b['id']
                    missing.remove(key)
    return out


def art(c, category, key):
    with LOCK:
        owner = catalog(c)['_art'].get(category + '/' + key + '.jpg')
        if not owner:
            return None
        b = next(b for b in list_bundles(c) if b['id'] == owner)
        try:
            return package_files(b)[2].get('art/' + category + '/' + key + '.jpg')
        except (ValueError, OSError):
            return None


def source():
    name = os.environ.get('WISDOM_COLLECTION_SOURCE')
    if not name:
        return {'configured': False, 'packages': [], 'notice': 'No collection source configured. Import a bundle from your files.'}
    try:
        p = Path(name)
        if p.is_symlink() or p.stat().st_size > 1024 * 1024:
            raise ValueError('Invalid source manifest')
        d = bounded_json(p.read_bytes())
        if not isinstance(d, dict) or d.get('version') != 1 or not isinstance(d.get('packages'), list) or len(d['packages']) > 100:
            raise ValueError('Invalid source manifest')
        packages = []
        seen = set()
        for b in d['packages']:
            ident(b.get('id')); text(b.get('title'), 1000); text(b.get('license'), 4000); text(b.get('attribution'), 4000)
            if b['id'] in seen or not re.fullmatch(r'[a-z0-9-]{1,64}\.zip', b.get('file', '')) or not re.fullmatch(r'[a-f0-9]{64}', b.get('sha256', '')):
                raise ValueError('Invalid or duplicate source package')
            seen.add(b['id']); packages.append({k: b[k] for k in ('id', 'title', 'license', 'attribution', 'sha256')})
        return {'configured': True, 'packages': packages, 'notice': 'Only your configured source is listed.'}
    except (OSError, ValueError, TypeError, AttributeError):
        return {'configured': True, 'packages': [], 'notice': 'Collection source unavailable or invalid. Your imported library is unchanged.'}


def import_source(c, key):
    ident(key)
    visible = source()
    if not any(b['id'] == key for b in visible['packages']):
        raise ValueError('Unknown configured source package')
    p = Path(os.environ['WISDOM_COLLECTION_SOURCE'])
    d = bounded_json(p.read_bytes())
    b = next(b for b in d['packages'] if b['id'] == key)
    f = p.parent / b['file']
    if f.is_symlink() or not f.resolve().is_relative_to(p.parent.resolve()) or f.stat().st_size > MAX:
        raise ValueError('Invalid source bundle')
    raw = f.read_bytes()
    if hashlib.sha256(raw).hexdigest() != b['sha256']:
        raise ValueError('Source checksum mismatch')
    m, _, _ = inspect_bundle(raw)
    if m['id'] != key or any(m[x] != b[x] for x in ('title', 'license', 'attribution')):
        raise ValueError('Source metadata differs from bundle')
    return approve_source(c, stage(c, raw), 'configured-source')
