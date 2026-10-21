"""Read-only release-owned toolkit, never assembled from imported documents."""
import base64
import hashlib
import io
import json
from pathlib import Path
import stat
import zipfile
import authoring_contract

ROOT = Path(__file__).resolve().parent
LIMIT = 1024 * 1024
FILES = (
    'LICENSE', 'authoring_contract.py', 'authoring_admission.py', 'library.py', 'collection_revision.py',
    'tools/author_chapter.py', 'tools/author_collection.py',
    'authoring/workflow.json', 'authoring/prompt.md',
    'docs/authoring/PINNED-WORKFLOW.md', 'docs/authoring/README.md',
    'docs/authoring/SHARED-THINKERS.md',
)
DOCS = tuple(n for n in FILES if n.startswith('docs/'))


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def snapshot():
    files = {}
    for name in FILES:
        path = ROOT / name
        if path.is_symlink():
            raise ValueError('Toolkit must contain release-owned regular files')
        # Check intermediate directories too, relative to the fixed image root.
        if any((ROOT / p).is_symlink() for p in path.relative_to(ROOT).parents):
            raise ValueError('Toolkit directory cannot be a symlink')
        if not path.is_file() or path.stat().st_size > LIMIT:
            raise ValueError('Missing or oversized release toolkit file')
        files[name] = path.read_bytes()
    if sum(map(len, files.values())) > LIMIT:
        raise ValueError('Release toolkit exceeds size limit')
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_STORED) as z:
        for name in sorted(files):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            z.writestr(info, files[name])
    raw = out.getvalue()
    if len(raw) > LIMIT:
        raise ValueError('Release toolkit ZIP exceeds size limit')
    c = authoring_contract.contract()
    identity = {k: c[k] for k in ('id', 'version', 'workflow_sha256', 'prompt_sha256')}
    identity['toolkit_sha256'] = sha(raw)
    c.update(contract_sha256=sha(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()),
             contract_identity=identity,
             documentation={n: files[n].decode('utf-8') for n in DOCS},
             toolkit={'format': 'wisdom-author-toolkit-v1', 'sha256': sha(raw), 'bytes': len(raw),
                      'max_bytes': LIMIT, 'files': [{'path': n, 'sha256': sha(files[n]), 'bytes': len(files[n])} for n in sorted(files)],
                      'trust': 'Installed app release code; not a document import or provider response',
                      'runtime': 'Python 3.10+ standard library; authenticated firstParty Claude CLI for live authorship only'})
    return c, raw


def describe():
    return snapshot()[0]


def download(data):
    if not isinstance(data, dict) or set(data) != {'contract_sha256', 'toolkit_sha256'}:
        raise ValueError('Exact contract_sha256 and toolkit_sha256 required')
    c, raw = snapshot()
    if data['contract_sha256'] != c['contract_sha256'] or data['toolkit_sha256'] != c['toolkit']['sha256']:
        raise ValueError('Stale author toolkit contract; rediscover installed release')
    return {'contract_sha256': c['contract_sha256'], 'toolkit_sha256': c['toolkit']['sha256'],
            'zip_base64': base64.b64encode(raw).decode('ascii')}
