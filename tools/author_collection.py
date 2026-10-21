#!/usr/bin/env python3
"""Owner-side, new-collection-only bridge. Never modifies the reader or donor.

Uses the existing version-1 library importer as the final document validator.
No authoring jobs, provider calls, revisions, deletions or automatic activation.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import library

LIMIT = 2 * 1024 * 1024
FIELDS = {
    'thinkers': {'id', 'name', 'bio', 'url', 'series', 'kind'},
    'entries': {'id', 'thinker', 'part', 'title', 'deck', 'source_url', 'source_link',
                'published_at', 'description', 'provenance', 'origin', 'label',
                'initial_archived', 'initial_read', 'dive_of', 'origin_id', 'body_sha256'},
    'collections': {'id', 'title', 'kind', 'form', 'by', 'thinker', 'bio', 'url',
                    'overview', 'entries', 'sections', 'art'},
}


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


class Source:
    """Read only regular files below a non-symlink root, including ancestors.

    openat/O_NOFOLLOW holds directory handles through each read, avoiding the
    check-then-open symlink race. No recursive filesystem walk is performed.
    """
    def __init__(self, root):
        self.root = Path(os.path.abspath(root))
        fd = os.open(self.root.anchor, os.O_RDONLY | os.O_DIRECTORY)
        try:
            for part in self.root.parts[1:]:
                nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = nxt
        except BaseException:
            os.close(fd)
            raise
        self.fd = fd

    def __enter__(self):
        return self

    def __exit__(self, *_):
        os.close(self.fd)

    def read(self, name, optional=False, limit=LIMIT):
        parts = name.split('/')
        if any(p in ('', '.', '..') for p in parts):
            raise ValueError('Invalid source path')
        fd = os.dup(self.fd)
        leaf = None
        try:
            for part in parts[:-1]:
                nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = nxt
            leaf = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            st = os.fstat(leaf)
            if not stat.S_ISREG(st.st_mode) or st.st_size > limit:
                raise ValueError('Source file must be bounded and regular: ' + name)
            with os.fdopen(leaf, 'rb') as f:
                leaf = None
                raw = f.read(limit + 1)
            if len(raw) > limit:
                raise ValueError('Source file grew beyond limit: ' + name)
            return raw
        except FileNotFoundError:
            if optional:
                return None
            raise ValueError('Missing source dependency: ' + name) from None
        finally:
            if leaf is not None:
                os.close(leaf)
            os.close(fd)


def json_document(raw):
    def unique(pairs):
        out = {}
        for k, v in pairs:
            if k in out:
                raise ValueError('Repeated JSON key: ' + k)
            out[k] = v
        return out
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError('Invalid JSON number')))


def rows(catalog, kind):
    items = catalog.get(kind)
    if not isinstance(items, list) or len(items) > 1000:
        raise ValueError('Invalid source catalog: ' + kind)
    out = {}
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('Invalid source row')
        key = library.ident(item.get('id'))
        if key in out:
            raise ValueError('Duplicate source identifier: ' + key)
        out[key] = item
    return out


def metadata(row, kind):
    # Unknown metadata is rejected, not silently exported or discarded.
    if set(row) - FIELDS[kind]:
        raise ValueError('Unsupported source metadata in ' + row['id'] + ': ' +
                         ', '.join(sorted(set(row) - FIELDS[kind])))
    for key, value in row.items():
        if key in ('entries', 'sections'):
            continue
        if key in ('initial_archived', 'initial_read'):
            if type(value) is not bool:
                raise ValueError('Invalid initial reading flag')
        elif key == 'part':
            if type(value) is not int:
                raise ValueError('Invalid chapter number')
        elif not isinstance(value, str) or len(value) > 12000:
            raise ValueError('Invalid metadata field: ' + key)
    if row.get('sections'):
        for section in row['sections']:
            if not isinstance(section, dict) or set(section) - {'title', 'entries'}:
                raise ValueError('Invalid section metadata')
            if not isinstance(section.get('title', ''), str):
                raise ValueError('Invalid section title')
    return row


def collection_order(col):
    if col.get('sections'):
        sections = col['sections']
        if not isinstance(sections, list) or any(not isinstance(s, dict) or
                not isinstance(s.get('entries'), list) for s in sections):
            raise ValueError('Invalid collection sections')
        ids = [key for section in sections for key in section['entries']]
        if 'entries' in col and col['entries'] != ids:
            raise ValueError('Collection entries disagree with section order')
    else:
        ids = col.get('entries')
    if not isinstance(ids, list) or not ids or any(not isinstance(i, str) for i in ids):
        raise ValueError('Collection needs explicit chapter order')
    for key in ids:
        library.ident(key)
    if len(ids) != len(set(ids)):
        raise ValueError('Repeated collection chapter')
    if col.get('overview') and col['overview'] not in ids:
        raise ValueError('Overview must be included in collection order')
    return ids


def export_collection(source, collection, *, license, attribution, rights='private', bundle_id=None, receipts=None):
    library.ident(collection)
    library.text(license, 4000)
    library.text(attribution, 4000)
    with Source(source) as src:
        catalog = json_document(src.read('content/catalog.json'))
        if not isinstance(catalog, dict):
            raise ValueError('Source catalog must be an object')
        maps = {kind: rows(catalog, kind) for kind in FIELDS}
        if collection not in maps['collections']:
            raise ValueError('Unknown named collection: ' + collection)
        col = metadata(maps['collections'][collection], 'collections')
        ids = collection_order(col)
        try:
            entries = [metadata(maps['entries'][i], 'entries') for i in ids]
            thinkers = {e['thinker'] for e in entries}
            if col.get('thinker'):
                thinkers.add(col['thinker'])
            selected = {'collections': [col], 'entries': entries,
                        'thinkers': [metadata(maps['thinkers'][t], 'thinkers') for t in sorted(thinkers)]}
        except (KeyError, TypeError) as e:
            raise ValueError('Missing or malformed collection dependency') from e
        for entry in entries:
            if entry.get('dive_of') and entry['dive_of'] not in ids:
                raise ValueError('External deep-dive reference requires a separately approved revision gate')
        files = {}
        expanded_size = 0

        def add_file(name, data):
            nonlocal expanded_size
            expanded_size += len(data)
            if len(data) > LIMIT or expanded_size > library.MAX or len(files) >= library.MAX_FILES:
                raise ValueError('Selected collection exceeds importer document limits')
            files[name] = data

        add_file('content/catalog.json', encode(selected))
        for key in ids:
            name = 'content/' + key + '.md'
            chapter = src.read(name)
            if chapter is None:
                raise ValueError('Missing chapter')
            add_file(name, chapter)
            files[name].decode('utf-8')
        body = '\n'.join(files['content/' + key + '.md'].decode('utf-8') for key in ids)
        gloss_raw = src.read('content/glosses.json', optional=True)
        if gloss_raw is not None:
            glosses = json_document(gloss_raw)
            if not isinstance(glosses, dict):
                raise ValueError('Invalid source glosses')
            add_file('content/glosses.json', encode({k: v for k, v in glosses.items() if k and k in body}))
        for category, selected_rows in (('p', selected['thinkers']), ('c', entries)):
            for row in selected_rows:
                suffix = category + '/' + row['id'] + '.jpg'
                art = src.read('static/wisdom-art/' + suffix, optional=True)
                if art is not None:
                    add_file('art/' + suffix, art)
    if receipts is not None:
        # Pinned runner receipts named <chapter_id>.receipt.json (tools/author_chapter.py).
        import authoring_admission
        found, evidence = {}, {}
        with Source(receipts) as rs:
            for key in ids:
                raw_receipt = rs.read(key + '.receipt.json', optional=True)
                if raw_receipt is not None:
                    found[key] = json_document(raw_receipt)
            if not found:
                raise ValueError('No <chapter_id>.receipt.json pinned author receipts found for this collection')
            # Option C: the raw author output and the exact source packet the helper
            # kept beside each receipt travel with the ZIP, so import can recheck them.
            # Shared collections therefore carry their source text.
            evidence = authoring_admission.evidence_members(
                found, lambda k: rs.read(k + '.receipt.json.cli.json', optional=True),
                lambda k, digest: rs.read(k + '.receipt.json.sources.json', optional=True))
        files['authoring/receipts.json'] = authoring_admission.build(found)
        for name, member in evidence.items():
            add_file(name, member)
    manifest = {'version': 1, 'id': bundle_id or collection, 'title': col['title'],
                'license': license, 'attribution': attribution, 'rights': rights}
    files['collection.json'] = encode(manifest)
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = out.getvalue()
    _, catalog, checked = library.inspect_bundle(raw)  # Same importer as the managed reader.
    if receipts is not None:
        import authoring_admission
        authoring_admission.assess(checked, catalog)  # Fail before writing, as the app would.
    return raw


def save_bundle(destination, raw):
    """Exclusive creation; a byte-identical retry is allowed, never overwrite."""
    try:
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        fd = os.open(destination, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as f:
            st = os.fstat(f.fileno())
            if not stat.S_ISREG(st.st_mode) or st.st_size > library.MAX or f.read(library.MAX + 1) != raw:
                raise ValueError('Refusing to overwrite a different output bundle')
        return False
    with os.fdopen(fd, 'wb') as f:
        f.write(raw)
        f.flush()
        os.fsync(f.fileno())
    return True


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class Target:
    def __init__(self, endpoint, transport='api', timeout=30):
        url = urllib.parse.urlsplit(endpoint)
        if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError('Endpoint must be an explicit HTTP(S) base URL without credentials/query/fragment')
        self.endpoint = endpoint.rstrip('/')
        self.transport = transport
        self.timeout = timeout
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path, body=None, content_type='application/json'):
        request = urllib.request.Request(self.endpoint + path, data=body,
                                         headers={'Content-Type': content_type})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(library.MAX + 1)
                if len(raw) > library.MAX:
                    raise ValueError('Target response too large')
                return json_document(raw)
        except urllib.error.HTTPError as e:
            detail = e.read(4000).decode('utf-8', errors='replace')
            raise ValueError('Target HTTP ' + str(e.code) + ': ' + detail) from None

    def call(self, path, body=None, tool=None, args=None):
        if self.transport == 'api':
            return self.request(path, encode(body) if body is not None else None)
        reply = self.request('/mcp', encode({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                              'params': {'name': tool, 'arguments': args or {}}}))
        result = reply.get('result', {})
        if reply.get('error') or result.get('isError') or not result.get('content'):
            raise ValueError('Target MCP error: ' + json.dumps(reply))
        return json_document(result['content'][0]['text'])

    def install(self, raw, enable=False):
        manifest, catalog, files = library.inspect_bundle(raw)
        digest = hashlib.sha256(raw).hexdigest()
        if self.transport == 'api':
            self.request('/api/library/stage', raw, 'application/zip')
        else:
            import base64
            self.call('', tool='wisdom_import', args={'zip_base64': base64.b64encode(raw).decode('ascii')})
        bundles = self.call('/api/library', tool='wisdom_library')['bundles']
        matches = [b for b in bundles if b['id'] == manifest['id'] and b['sha256'] == digest]
        if len(matches) != 1:
            raise ValueError('Stage readback does not match uploaded bundle')
        if enable:
            self.call('/api/library/action', {'id': manifest['id'], 'action': 'enable'},
                      tool='wisdom_bundle', args={'id': manifest['id'], 'action': 'enable'})
        bundles = self.call('/api/library', tool='wisdom_library')['bundles']
        installed = next(b for b in bundles if b['id'] == manifest['id'])
        if installed['sha256'] != digest or (enable and installed['status'] != 'enabled'):
            raise ValueError('Install readback differs from requested state')
        if installed['status'] == 'enabled':
            state = self.call('/api/wisdom', tool='wisdom_state')
            by_id = {e['id']: e for e in state['entries']}
            for entry in catalog['entries']:
                if by_id.get(entry['id'], {}).get('body') != files['content/' + entry['id'] + '.md'].decode('utf-8'):
                    raise ValueError('Reader chapter differs from bundle: ' + entry['id'])
            for col in catalog['collections']:
                actual = next((c for c in state['collections'] if c['id'] == col['id']), {})
                if actual.get('entries') != collection_order(col):
                    raise ValueError('Reader chapter order differs from bundle')
        return installed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='command', required=True)
    export = subs.add_parser('export', help='Export exactly one new collection')
    export.add_argument('--source', type=Path, required=True)
    export.add_argument('--collection', required=True)
    export.add_argument('--output', type=Path, required=True)
    export.add_argument('--license', required=True)
    export.add_argument('--attribution', required=True, help='Must cover selected text, translations and art')
    export.add_argument('--rights', choices=['private', 'unknown', 'redistributable'], default='private')
    export.add_argument('--bundle-id')
    export.add_argument('--receipts', type=Path, help='Directory of <chapter_id>.receipt.json pinned author receipts')
    install = subs.add_parser('install', help='Stage by default; enabling requires explicit --enable')
    install.add_argument('--bundle', type=Path, required=True)
    install.add_argument('--endpoint', required=True)
    install.add_argument('--transport', choices=['api', 'mcp'], default='api')
    install.add_argument('--enable', action='store_true')
    preview = subs.add_parser('revision-preview', help='Stage exact existing-collection revision; does not apply')
    preview.add_argument('--bundle', type=Path, required=True)
    preview.add_argument('--collection', required=True)
    preview.add_argument('--old-sha256', required=True)
    preview.add_argument('--output', type=Path, required=True)
    apply = subs.add_parser('revision-apply', help='Explicitly apply a saved exact preview')
    apply.add_argument('--preview', type=Path, required=True)
    apply.add_argument('--confirm', action='store_true', required=True)
    for command in (preview, apply):
        command.add_argument('--endpoint', required=True)
        command.add_argument('--transport', choices=['api', 'mcp'], default='mcp')
    args = parser.parse_args(argv)
    try:
        if args.command == 'export':
            raw = export_collection(args.source, args.collection, license=args.license,
                                    attribution=args.attribution, rights=args.rights, bundle_id=args.bundle_id,
                                    receipts=args.receipts)
            created = save_bundle(args.output, raw)
            manifest, catalog, files = library.inspect_bundle(raw)
            receipt = {'id': manifest['id'], 'sha256': hashlib.sha256(raw).hexdigest(),
                       'created': created, 'rights': manifest['rights'],
                       'chapters': [e['id'] for e in catalog['entries']], 'files': sorted(files)}
            import authoring_admission
            receipt['authoring'] = authoring_admission.assess(files, catalog)
        elif args.command == 'revision-preview':
            import base64
            with Source(args.bundle.absolute().parent) as source:
                raw = source.read(args.bundle.name, limit=library.MAX)
            if raw is None:
                raise ValueError('Revision ZIP is required')
            manifest, _, _ = library.inspect_bundle(raw)
            data = {'id': manifest['id'], 'collection_id': args.collection, 'old_sha256': args.old_sha256,
                    'new_sha256': hashlib.sha256(raw).hexdigest(), 'zip_base64': base64.b64encode(raw).decode()}
            receipt = Target(args.endpoint, args.transport).call('/api/library/revision/preview', data,
                        tool='wisdom_revision_preview', args=data)
            if any(receipt.get(k) != data[k] for k in ('id', 'collection_id', 'old_sha256', 'new_sha256')):
                raise ValueError('Revision preview does not match requested bytes')
            save_bundle(args.output, encode(receipt))
        elif args.command == 'revision-apply':
            with Source(args.preview.absolute().parent) as source:
                saved = json_document(source.read(args.preview.name))
            data = {k: saved[k] for k in ('id', 'collection_id', 'old_sha256', 'new_sha256', 'token')}
            data['confirm'] = args.confirm
            target = Target(args.endpoint, args.transport)
            receipt = target.call('/api/library/revision/apply', data, tool='wisdom_revision_apply', args=data)
            bundles = target.call('/api/library', tool='wisdom_library')['bundles']
            actual = next((b for b in bundles if b['id'] == data['id']), None)
            if not receipt.get('applied') or not actual or actual['sha256'] != data['new_sha256']:
                raise ValueError('Applied revision readback differs from confirmed preview')
            receipt['readback'] = actual
        else:
            # Hold a confined regular-file handle, even for an externally supplied ZIP.
            with Source(args.bundle.absolute().parent) as source:
                raw = source.read(args.bundle.name, limit=library.MAX)
            receipt = Target(args.endpoint, args.transport).install(raw, enable=args.enable)
        print(json.dumps(receipt, ensure_ascii=False, sort_keys=True))
        return 0
    except (ValueError, OSError, KeyError, TypeError, UnicodeError, RecursionError) as e:
        print('author_collection: ' + str(e), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
