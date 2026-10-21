"""Explicit single-collection downloads from verified immutable documents only.

No reading-state queries, filesystem traversal, publishing or scope mutations.
Preview and confirmation bind to the same deterministic ZIP digest.
"""
import hashlib
import io
import json
import stat
import zipfile
import library

# Export document metadata only, never runtime state or unknown uploaded fields.
FIELDS = {
    'thinkers': {'id', 'name', 'bio', 'url', 'series', 'kind'},
    'entries': {'id', 'thinker', 'part', 'title', 'deck', 'source_url', 'source_link',
                'published_at', 'description', 'provenance', 'origin', 'label',
                'dive_of', 'origin_id', 'body_sha256'},
    'collections': {'id', 'title', 'kind', 'form', 'by', 'thinker', 'bio', 'url',
                    'overview', 'entries', 'sections'},
}


SOURCE_NOTICE = ('This file also includes the source text the author worked from (%(packets)d source '
                 'packet(s), with the raw author output for %(chapters)d text(s)), so the receiving Wisdom can '
                 'recheck quotations. Anyone you share it with can read that source text, which may belong to '
                 'other rights holders. ')


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def clean(row, kind):
    out = {k: v for k, v in row.items() if k in FIELDS[kind]}
    # Disallow nested unrecognised payloads hidden inside metadata strings/fields.
    for k, v in out.items():
        if k in ('entries', 'sections'):
            continue
        if k == 'part':
            if type(v) is not int:
                raise ValueError('Invalid export chapter number')
        elif not isinstance(v, str):
            raise ValueError('Invalid export metadata: ' + k)
    if out.get('sections'):
        out['sections'] = [{'title': s.get('title', ''), 'entries': s['entries']}
                           for s in out['sections']]
        if any(not isinstance(s['title'], str) for s in out['sections']):
            raise ValueError('Invalid export section title')
    return out


def build(c, key):
    library.ident(key)
    bundles = library.list_bundles(c)
    selected = None
    for b in bundles:
        if b['status'] != 'enabled':
            continue
        m, d, files = library.package_files(b)
        col = next((x for x in d['collections'] if x['id'] == key), None)
        if col:
            selected = b, m, d, files, col
            break
    if not selected:
        raise ValueError('Enable the selected collection before exporting')
    b, m, d, source, col = selected
    col = clean(col, 'collections')
    ids = [i for s in col['sections'] for i in s['entries']] if col.get('sections') else col['entries']
    col['entries'] = ids
    byid = {e['id']: e for e in d['entries']}
    entries = [clean(byid[i], 'entries') for i in ids]
    if any(e.get('dive_of') and e['dive_of'] not in ids for e in entries):
        raise ValueError('External deep-dive dependency: export requires a separately reviewed revision')
    thinkers = {e['thinker'] for e in entries}
    if col.get('thinker'):
        thinkers.add(col['thinker'])
    selected_thinkers = [clean(t, 'thinkers') for t in d['thinkers'] if t['id'] in thinkers]
    manifest = {k: m[k] for k in ('version', 'license', 'attribution', 'rights')}
    manifest.update(id=key, title=col['title'])
    files = {'collection.json': encode(manifest),
             'content/catalog.json': encode({'collections': [col], 'entries': entries,
                                            'thinkers': selected_thinkers})}
    for key in ids:
        name = 'content/' + key + '.md'
        files[name] = source[name]  # Source bytes are never reflowed/re-encoded.
        art = 'art/c/' + key + '.jpg'
        if art in source:
            files[art] = source[art]
    # A portrait may have been inherited from another retained bundle. Include
    # only the reader's eligible portrait, with exact matching thinker metadata.
    # The reader excludes never-enabled staged bundles, but retains disabled/removed
    # sources. Resolve its ownership map rather than widening that policy here.
    visible_art = library.catalog(c)['_art']
    for t in d['thinkers']:
        if t['id'] not in thinkers:
            continue
        name = 'art/p/' + t['id'] + '.jpg'
        if name in source:
            files[name] = source[name]
            continue
        for other in bundles:
            if other['id'] != visible_art.get('p/' + t['id'] + '.jpg'):
                continue
            try:
                _, od, of = library.package_files(other)
            except (ValueError, OSError):
                continue
            if name in of and any(library.canonical_thinker(x) == library.canonical_thinker(t) for x in od['thinkers']):
                files[name] = of[name]
                break
    body = '\n'.join(files['content/' + i + '.md'].decode('utf-8') for i in ids)
    glosses = library.bounded_json(source.get('content/glosses.json', b'{}'))
    files['content/glosses.json'] = encode({k: {field: value for field, value in v.items()
        if field in ('en', 'roman', 'say', 'language', 'lang', 'note')} for k, v in glosses.items() if k and k in body})
    import authoring_admission
    if 'authoring/receipts.json' in source:
        # Carry author receipts for exactly the exported chapters, with the raw author
        # output and source text they were checked against (receipt option C), so the
        # receiving installation rechecks rather than trusts them.
        receipts = library.bounded_json(source['authoring/receipts.json']).get('receipts', {})
        kept = {k: receipts[k] for k in ids if k in receipts}
        if kept:
            files['authoring/receipts.json'] = authoring_admission.build(kept)
        for k, record in kept.items():
            out = authoring_admission.output_name(k)
            packet = authoring_admission.sources_name(record.get('sources_sha256', '')) if isinstance(record, dict) else None
            if out in source and packet in source:
                files[out] = source[out]
                files[packet] = source[packet]
    source_text = authoring_admission.source_text_summary(files)
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = out.getvalue()
    library.inspect_bundle(raw)
    preview = dict(manifest, **library.collection_scope(c, b, col['id']),
                   bundle_id=b['id'], source_sha256=b['sha256'],
                   sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw),
                   chapters=[{'id': e['id'], 'title': e['title']} for e in entries],
                   thinkers=[{'id': t['id'], 'name': t['name']} for t in selected_thinkers],
                   files=[{'name': n, 'bytes': len(v), 'sha256': hashlib.sha256(v).hexdigest()}
                          for n, v in sorted(files.items())],
                   source_text=source_text,
                   notice='Download only. No upload or publication. Library scope is unchanged. '
                          'No highlights, reading positions, preferences or requests are included. '
                          + (SOURCE_NOTICE % source_text if source_text else '') +
                          'Sharing still requires permission from the rights holder.')
    return preview, raw


def preview(c, data):
    if set(data) != {'id'}:
        raise ValueError('One collection id required')
    with library.LOCK:
        return build(c, data['id'])[0]


def download(c, data):
    if set(data) != {'id', 'sha256', 'confirm'} or data['confirm'] is not True:
        raise ValueError('Confirm the preview with id, sha256 and confirm:true')
    with library.LOCK:
        details, raw = build(c, data['id'])
        if data['sha256'] != details['sha256']:
            raise ValueError('Export changed; review a fresh preview before confirming')
        return details, raw
