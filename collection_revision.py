"""Digest-bound, explicit revisions. Never overwrite an earlier document edition."""
import base64
import binascii
import hashlib
import json
import os
import re
import shutil
import uuid
import library


def init(c):
    c.execute('''CREATE TABLE IF NOT EXISTS wisdom_revision_previews(
        token TEXT PRIMARY KEY, bundle_id TEXT NOT NULL, collection_id TEXT NOT NULL,
        old_sha256 TEXT NOT NULL, new_sha256 TEXT NOT NULL, preview TEXT NOT NULL,
        applied INTEGER NOT NULL DEFAULT 0)''')
    c.execute('''CREATE TABLE IF NOT EXISTS wisdom_editions(
        bundle_id TEXT NOT NULL, sha256 TEXT NOT NULL, manifest TEXT NOT NULL,
        PRIMARY KEY(bundle_id,sha256))''')


def digest(value):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value):
        raise ValueError('Exact SHA256 required')
    return value


def identity(data):
    library.ident(data.get('id')); library.ident(data.get('collection_id'))
    digest(data.get('old_sha256')); digest(data.get('new_sha256'))
    return hashlib.sha256(json.dumps({k: data[k] for k in ('id', 'collection_id', 'old_sha256', 'new_sha256')}, sort_keys=True).encode()).hexdigest()


def edition_path(key, sha):
    library.ident(key); digest(sha)
    p = library.root() / '.editions' / key / sha
    for parent in (p, p.parent, p.parent.parent):
        if parent.is_symlink():
            raise ValueError('Symlink in edition path')
    return p


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def sync_edition(p):
    # Persist file entries, the rename, and newly-created ancestor directories
    # before a SQLite transaction may publish a pointer to this immutable tree.
    for directory in (p, p.parent, p.parent.parent, library.root()):
        sync_directory(directory)


def store(key, sha, raw):
    """Rename a complete immutable directory; a crashed-before-commit retry reuses exact bytes."""
    p = edition_path(key, sha)
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists():
        f = p / 'bundle.zip'
        if f.is_symlink() or f.stat().st_size > library.MAX or f.read_bytes() != raw:
            raise ValueError('Conflicting immutable edition')
        with f.open('rb') as handle:
            os.fsync(handle.fileno())
        sync_edition(p)
        return
    tmp = p.parent / ('.pending-' + uuid.uuid4().hex)
    try:
        tmp.mkdir(mode=0o700)
        with (tmp / 'bundle.zip').open('xb') as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
        sync_directory(tmp)
        tmp.rename(p)
        sync_edition(p)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def validated(c, data, raw):
    m, d, files = library.inspect_bundle(raw)
    if hashlib.sha256(raw).hexdigest() != data['new_sha256'] or m['id'] != data['id']:
        raise ValueError('New digest or bundle id mismatch')
    b = next((b for b in library.list_bundles(c) if b['id'] == data['id']), None)
    if not b or b['sha256'] != data['old_sha256']:
        raise ValueError('Stale old digest or unknown bundle; preview again')
    _, old, old_files = library.package_files(b)
    if len(old['collections']) != 1 or len(d['collections']) != 1 or old['collections'][0]['id'] != data['collection_id'] or d['collections'][0]['id'] != data['collection_id']:
        raise ValueError('Revision requires the same single collection and bundle')
    if {e['id'] for e in old['entries']} != {e['id'] for e in d['entries']}:
        raise ValueError('Stable chapter IDs required; no additions or deletions')
    def members(col):
        return set(i for s in col['sections'] for i in s['entries']) if col.get('sections') else set(col['entries'])
    if members(old['collections'][0]) != members(d['collections'][0]) or old['collections'][0].get('overview') != d['collections'][0].get('overview'):
        raise ValueError('Stable membership and overview identity required')
    if old['collections'][0].get('thinker') != d['collections'][0].get('thinker'):
        raise ValueError('Collection thinker identity cannot change')
    if {e['id']: e['thinker'] for e in old['entries']} != {e['id']: e['thinker'] for e in d['entries']}:
        raise ValueError('Chapter thinker identity cannot change')
    if {t['id']: library.canonical_thinker(t) for t in old['thinkers']} != {t['id']: library.canonical_thinker(t) for t in d['thinkers']}:
        raise ValueError('Thinker metadata cannot change in a collection revision')
    if {n: v for n, v in old_files.items() if n.startswith('art/p/')} != {n: v for n, v in files.items() if n.startswith('art/p/')}:
        raise ValueError('Shared thinker portraits cannot change in a revision')
    # Glosses are a library-wide projection. Preserve existing meanings and reject
    # changed shared terms; local new terms are safe when no other bundle owns them.
    old_g = library.bounded_json(old_files.get('content/glosses.json', b'{}'))
    new_g = library.bounded_json(files.get('content/glosses.json', b'{}'))
    for other in library.list_bundles(c):
        if other['id'] == b['id']:
            continue
        _, od, of = library.package_files(other)
        for kind in ('entries', 'collections'):
            if {r['id'] for r in od[kind]} & {r['id'] for r in d[kind]}:
                raise ValueError('Cross-bundle document collision')
        other_g = library.bounded_json(of.get('content/glosses.json', b'{}'))
        for term in set(old_g) | set(new_g):
            if term in other_g and old_g.get(term) != new_g.get(term):
                raise ValueError('Revision would change a shared glossary term')
    return b, m, d, files, old_files


def preview(c, data):
    if set(data) != {'id', 'collection_id', 'old_sha256', 'new_sha256', 'zip_base64'}:
        raise ValueError('Preview needs ids, exact old/new digests and ZIP')
    binding = identity(data)
    pending = c.execute('''SELECT token FROM wisdom_revision_previews
        WHERE bundle_id=? AND collection_id=? AND old_sha256=? AND new_sha256=? AND applied=0''',
        (data['id'], data['collection_id'], data['old_sha256'], data['new_sha256'])).fetchone()
    token = pending[0] if pending else hashlib.sha256((binding + uuid.uuid4().hex).encode()).hexdigest()
    if not isinstance(data['zip_base64'], str) or len(data['zip_base64']) > library.MAX * 4 // 3 + 4:
        raise ValueError('Oversized revision ZIP')
    try:
        raw = base64.b64decode(data['zip_base64'], validate=True)
    except (ValueError, binascii.Error):
        raise ValueError('Invalid revision ZIP encoding') from None
    with library.LOCK:
        b, m, d, files, old_files = validated(c, data, raw)
        if data['old_sha256'] == data['new_sha256']:
            raise ValueError('Revision has no changed bytes')
        if not c.execute('SELECT 1 FROM wisdom_revision_previews WHERE token=?', (token,)).fetchone() and c.execute('SELECT count(*) FROM wisdom_revision_previews WHERE bundle_id=? AND applied=0', (b['id'],)).fetchone()[0] >= 20:
            raise ValueError('Pending revision limit reached; operator review required')
        changed = sorted(n for n in set(files) | set(old_files) if files.get(n) != old_files.get(n))
        report = {k: data[k] for k in ('id', 'collection_id', 'old_sha256', 'new_sha256')}
        import authoring_admission
        report.update(authoring=authoring_admission.assess(files, d))
        report.update(token=token, changed_files=changed, chapters=[e['id'] for e in d['entries']],
                      rights=m['rights'], library_scope='private', status=b['status'],
                      notice='Apply preserves personal state and retains old editions. Changed chapter anchors become earlier-edition quotes; no automatic reanchoring.')
        store(b['id'], data['new_sha256'], raw)
        c.execute('INSERT OR IGNORE INTO wisdom_revision_previews(token,bundle_id,collection_id,old_sha256,new_sha256,preview) VALUES (?,?,?,?,?,?)',
                  (token, b['id'], data['collection_id'], data['old_sha256'], data['new_sha256'], json.dumps(report)))
        c.commit()
        return report


def apply(c, data):
    if set(data) != {'id', 'collection_id', 'old_sha256', 'new_sha256', 'token', 'confirm'} or data.get('confirm') is not True:
        raise ValueError('Apply requires preview ids/digests/token and explicit confirm:true')
    identity(data); digest(data['token'])
    with library.LOCK:
        c.execute('BEGIN IMMEDIATE')
        try:
            row = c.execute('SELECT * FROM wisdom_revision_previews WHERE token=?', (data['token'],)).fetchone()
            if not row:
                raise ValueError('Exact preview required before apply')
            if (row['bundle_id'], row['collection_id'], row['old_sha256'], row['new_sha256']) != (data['id'], data['collection_id'], data['old_sha256'], data['new_sha256']):
                raise ValueError('Preview binding mismatch')
            current = c.execute('SELECT sha256 FROM wisdom_bundles WHERE id=?', (data['id'],)).fetchone()
            if row['applied'] and current and current[0] == data['new_sha256']:
                c.commit()
                return dict(json.loads(row['preview']), applied=True, replay=True)
            if row['applied']:
                raise ValueError('Stale applied revision; current edition has advanced')
            f = edition_path(data['id'], data['new_sha256']) / 'bundle.zip'
            if f.is_symlink() or f.stat().st_size > library.MAX:
                raise ValueError('Invalid staged edition')
            raw = f.read_bytes()
            b, m, d, files, old_files = validated(c, data, raw)
            store(b['id'], data['new_sha256'], raw)
            # Existing history is immutable. An unresolved older quotation keeps
            # its original source, even across a second or third rewrite.
            for entry in d['entries']:
                name = 'content/' + entry['id'] + '.md'
                if old_files[name] == files[name]:
                    continue
                body = old_files[name].decode()
                c.execute('''INSERT OR IGNORE INTO wisdom_highlight_history
                    (seq,entry_id,original_start,original_end,original_text,source_body,source_body_sha256)
                    SELECT seq,entry_id,start,end,text,?,? FROM wisdom_highlights WHERE entry_id=?''',
                    (body, hashlib.sha256(old_files[name]).hexdigest(), entry['id']))
                c.execute("UPDATE wisdom_highlight_history SET status='unresolved',reason='Earlier edition — anchor not verified in current text' WHERE entry_id=? AND status='reanchored'", (entry['id'],))
            old_manifest = c.execute('SELECT manifest FROM wisdom_bundles WHERE id=?', (b['id'],)).fetchone()[0]
            import authoring_admission
            summary = dict({k: m[k] for k in ('version', 'id', 'title', 'license', 'attribution', 'rights')},
                           chapters=len(d['entries']), collections=len(d['collections']),
                           authoring=authoring_admission.assess(files, d))
            for sha, manifest in ((b['sha256'], old_manifest), (data['new_sha256'], json.dumps(summary))):
                c.execute('INSERT OR IGNORE INTO wisdom_editions VALUES (?,?,?)', (b['id'], sha, manifest))
            c.execute('UPDATE wisdom_bundles SET sha256=?,manifest=? WHERE id=? AND sha256=?',
                      (data['new_sha256'], json.dumps(summary), b['id'], data['old_sha256']))
            c.execute('''INSERT OR REPLACE INTO wisdom_collection_scopes
                (collection_id,bundle_id,sha256,scope,provenance) VALUES (?,?,?,'private','owner-revision')''',
                (data['collection_id'], b['id'], data['new_sha256']))
            c.execute('UPDATE wisdom_revision_previews SET applied=1 WHERE token=?', (data['token'],))
            c.commit()
            return dict(json.loads(row['preview']), applied=True, replay=False)
        except BaseException:
            c.rollback()
            raise
