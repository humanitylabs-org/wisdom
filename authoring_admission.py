"""Result admission for app-authored prose (wizard-os APP_WORKFLOWS, decision #63).

A bundle may carry `authoring/receipts.json`: the per-chapter receipts written by
the packaged pinned runner (`tools/author_chapter.py`). Since receipt option C a
receipted chapter also carries the runner's evidence:

- `authoring/output/<chapter_id>.json`: the raw author output (Claude CLI JSON)
  the runner accepted, byte-identical to `cli_result_sha256`;
- `authoring/sources/<sources_sha256>.json`: the exact source packet the runner
  checked quotations against (shared packets are carried once).

Admission is decided once, when bytes enter the library (stage or revision
preview/apply), and the result is stored with the edition:

- No receipts: admitted as **unverified** imported content. Wisdom never claims
  it wrote such prose; the label stays with that edition.
- Receipts and evidence present and every check passes: **checked** (all
  chapters) or **partial** (only some chapters checked). Checks: the installed
  workflow, prompt and pinned model; the observed model in both the receipt and
  the raw author output; the chapter bytes against the receipt and against the
  body in the raw output; the runner's shape checks; and the full source recheck
  (`validate_chapter`: cited URLs and every quotation verbatim in the carried
  source text).
- Receipts without evidence (older exports): the receipts are still checked, but
  the chapters are labelled unverified because quotations cannot be rechecked.
- Anything wrong (other model, mixed/missing modelUsage, other workflow or
  prompt, malformed, body or raw-output mismatch, a quotation not in the source
  text, unknown chapter, evidence no receipt refers to): the whole bundle is
  refused. Nothing is staged; the recovery is to re-author that chapter.

This is a consistency check over evidence carried in the ZIP. It is not a
cryptographic signature and not provider attestation: someone who fabricates a
raw output, a source packet and a receipt that all agree can still pass. The
label therefore reads "checked", never "signed".
"""
import hashlib
import json
import re
from typing import NoReturn

import authoring_contract

MEMBER = 'authoring/receipts.json'
OUTPUT = 'authoring/output/'
SOURCES = 'authoring/sources/'
OUTPUT_RE = re.compile(r'authoring/output/([a-z0-9-]{1,64})\.json')
SOURCES_RE = re.compile(r'authoring/sources/([0-9a-f]{64})\.json')
MAX_RECEIPTS = 1000
MAX_SOURCES = 50
EVIDENCE_KIND = ('receipts rechecked against the raw author output and source text carried in this '
                 'collection; a consistency check, not a cryptographic signature or provider attestation')
RECOVER = ' No output admitted. Re-author the chapter with the pinned Wisdom workflow (anthropic / claude-opus-5-5) and export again.'
NO_EVIDENCE = ('Receipts present, but the raw author output and source text are not included, so quotations '
               'cannot be rechecked; authorship unknown')


class Refused(ValueError):
    pass


def tokens_sha256(raw):
    """Digest of the whitespace-normalised token sequence of a chapter body."""
    return hashlib.sha256(' '.join(raw.decode('utf-8').split()).encode('utf-8')).hexdigest()


def _fail(msg) -> NoReturn:
    raise Refused('Authoring receipt rejected: ' + msg + '.' + RECOVER)


def unverified(reason='No pinned author receipts in this bundle; authorship unknown'):
    return {'status': 'unverified', 'reason': reason}


def is_member(name):
    return name == MEMBER or bool(OUTPUT_RE.fullmatch(name) or SOURCES_RE.fullmatch(name))


def output_name(key):
    return OUTPUT + key + '.json'


def sources_name(digest):
    return SOURCES + digest + '.json'


def source_packet(raw, label='source text'):
    """Same packet rule the runner applies before any author call."""
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeError, RecursionError):
        _fail(label + ' is not valid JSON')
    if not isinstance(data, list) or not 1 <= len(data) <= MAX_SOURCES:
        _fail(label + ' must list 1–%d sources' % MAX_SOURCES)
    for s in data:
        if (not isinstance(s, dict) or not isinstance(s.get('text'), str) or not s['text'].strip()
                or not isinstance(s.get('url'), str) or not s['url'].startswith(('https://', 'http://'))):
            _fail(label + ' needs url and verbatim text for every source')
    return data


def raw_body(key, raw):
    """The chapter body exactly as the runner extracted it from the CLI result."""
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeError, RecursionError):
        _fail(key + ' raw author output is not valid JSON')
    if not isinstance(result, dict):
        _fail(key + ' raw author output is not a CLI result object')
    try:
        usage = authoring_contract.verify_usage(result)
    except ValueError:
        _fail(key + ' raw author output: observed model is missing, mixed or not the pinned firstParty claude-opus-5-5')
    value = result.get('structured_output')
    if value is None:
        try:
            value = json.loads(result.get('result', ''))
        except (TypeError, ValueError):
            _fail(key + ' raw author output has no chapter object')
    if not isinstance(value, dict) or set(value) != {'chapter_id', 'body'} or not isinstance(value['body'], str):
        _fail(key + ' raw author output has the wrong output schema')
    if value['chapter_id'] != key:
        _fail(key + ' raw author output is for another chapter')
    return value['body'].encode('utf-8'), usage


def check_record(key, record, body, contract):
    if not isinstance(record, dict):
        _fail(key + ' receipt is not an object')
    expect = {'chapter_id': key, 'workflow': contract['id'], 'workflow_version': contract['version'],
              'workflow_sha256': contract['workflow_sha256'], 'prompt_sha256': contract['prompt_sha256'],
              'provider': contract['provider'], 'model': contract['model'], 'format': contract['format']}
    for field, value in expect.items():
        if record.get(field) != value:
            _fail('%s %s is %r, installed workflow requires %r' % (key, field, record.get(field), value))
    try:
        # Same strict observed-model check the runner applies to the CLI result.
        authoring_contract.verify_usage({'is_error': False, 'modelUsage': record.get('modelUsage')})
    except ValueError:
        _fail(key + ' observed model is missing, mixed or not the pinned firstParty claude-opus-5-5')
    for field in ('input_sha256', 'output_sha256', 'cli_result_sha256', 'sources_sha256'):
        if not isinstance(record.get(field), str) or not re.fullmatch(r'[0-9a-f]{64}', record[field]):
            _fail(key + ' ' + field + ' is malformed')
    exact = hashlib.sha256(body).hexdigest() == record['output_sha256']
    normal = record.get('output_tokens_sha256') == tokens_sha256(body)
    if not (exact or normal):
        _fail(key + ' chapter bytes differ from the receipted author output (hand edits are not admitted)')
    try:
        # The runner refuses drafts that fail these shape checks, so a receipted body
        # that fails them was not accepted by the pinned runner (forged or hand-built).
        authoring_contract.validate_structure(body.decode('utf-8'))
    except (ValueError, UnicodeError) as e:
        _fail(key + ' fails the compression v1 checks the pinned runner applies (' + str(e) + '); '
              'a receipt cannot vouch for a draft the runner rejected')
    return {'chapter_id': key, 'output_sha256': record['output_sha256'], 'input_sha256': record['input_sha256'],
            'match': 'exact' if exact else 'whitespace-normalised'}


def check_evidence(key, record, body, files):
    """Option C: recheck the receipt against the raw output and source text it names."""
    raw = files[output_name(key)]
    if hashlib.sha256(raw).hexdigest() != record['cli_result_sha256']:
        _fail(key + ' raw author output does not match the receipt')
    accepted, usage = raw_body(key, raw)
    if usage != record.get('modelUsage'):
        _fail(key + ' receipt modelUsage differs from the raw author output')
    if hashlib.sha256(accepted).hexdigest() != record['output_sha256']:
        _fail(key + ' receipt output digest differs from the body in the raw author output')
    if tokens_sha256(accepted) != tokens_sha256(body):
        _fail(key + ' chapter differs from the body in the raw author output')
    packet = files.get(sources_name(record['sources_sha256']))
    if packet is None:
        _fail(key + ' source text named by its receipt is not included')
    sources = source_packet(packet, key + ' source text')
    try:
        authoring_contract.validate_chapter(body.decode('utf-8'), sources)
    except (ValueError, UnicodeError) as e:
        _fail(key + ' fails the source recheck against its carried source text (' + str(e) + ')')
    return record['sources_sha256']


def assess(files, catalog):
    """Return the admission label for validated bundle files, or raise Refused."""
    raw = files.get(MEMBER)
    evidence = [n for n in files if n.startswith(OUTPUT) or n.startswith(SOURCES)]
    for name in evidence:
        if not (OUTPUT_RE.fullmatch(name) or SOURCES_RE.fullmatch(name)):
            _fail(name + ' is not a supported evidence member')
        m = SOURCES_RE.fullmatch(name)
        if m and hashlib.sha256(files[name]).hexdigest() != m[1]:
            _fail(name + ' source text packet name does not match its digest')
    if raw is None:
        if evidence:
            _fail('author evidence is not referenced by any receipt')
        return unverified()
    try:
        doc = json.loads(raw)
    except (ValueError, UnicodeError, RecursionError):
        _fail('authoring/receipts.json is not valid JSON')
    if not isinstance(doc, dict) or doc.get('version') != 1 or not isinstance(doc.get('receipts'), dict):
        _fail('authoring/receipts.json needs version 1 and a receipts object')
    receipts = doc['receipts']
    if not receipts or len(receipts) > MAX_RECEIPTS:
        _fail('receipts object is empty or too large')
    contract = authoring_contract.contract()
    entries = [e['id'] for e in catalog['entries']]
    unknown = sorted(set(receipts) - set(entries))
    if unknown:
        _fail('receipt for a chapter not in this bundle: ' + ', '.join(unknown[:5]))
    stray = sorted(m[1] for m in (OUTPUT_RE.fullmatch(n) for n in evidence) if m and m[1] not in receipts)
    if stray:
        _fail('raw author output not referenced by a receipt: ' + ', '.join(stray[:5]))
    checked, used = [], set()
    for k in entries:
        if k not in receipts:
            continue
        body = files['content/' + k + '.md']
        check_record(k, receipts[k], body, contract)
        if output_name(k) in files:
            used.add(check_evidence(k, receipts[k], body, files))
            checked.append(k)
    unused = sorted(m[1] for m in (SOURCES_RE.fullmatch(n) for n in evidence) if m and m[1] not in used)
    if unused:
        _fail('source text not referenced by a checked receipt: ' + ', '.join(d[:12] for d in unused[:5]))
    if not checked:
        return dict(unverified(NO_EVIDENCE), receipts_sha256=hashlib.sha256(raw).hexdigest(),
                    chapters_with_receipts=len(receipts))
    missing = [k for k in entries if k not in checked]
    return {'status': 'checked' if not missing else 'partial',
            'workflow': contract['id'], 'workflow_version': contract['version'],
            'workflow_sha256': contract['workflow_sha256'], 'prompt_sha256': contract['prompt_sha256'],
            'requested_model': contract['provider'] + '/' + contract['model'],
            'observed_model': contract['model'], 'observed_provider': contract['cli_provider'],
            'override': None, 'receipts_sha256': hashlib.sha256(raw).hexdigest(),
            'chapters_verified': len(checked), 'chapters_unverified': missing,
            'source_text_included': True, 'source_packets': len(used),
            'evidence_kind': EVIDENCE_KIND}


def build(receipts):
    """Canonical archive member for exporter use: {chapter_id: runner receipt}."""
    return (json.dumps({'version': 1, 'receipts': receipts}, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')


def evidence_members(receipts, read_output, read_sources):
    """Archive members carrying each receipt's raw output and source packet.

    `read_output(key)` / `read_sources(key, digest)` return bytes or None. Missing
    evidence is an error: the exporter never drops it silently."""
    files, missing = {}, []
    for key, record in sorted(receipts.items()):
        digest = record.get('sources_sha256') if isinstance(record, dict) else None
        out = read_output(key)
        packet = read_sources(key, digest) if isinstance(digest, str) else None
        if out is None or packet is None:
            missing.append(key)
            continue
        files[output_name(key)] = out
        files[sources_name(hashlib.sha256(packet).hexdigest())] = packet
    if missing:
        raise ValueError('The raw author output and source text are missing for: ' + ', '.join(missing[:5]) +
                         '. Export needs the <chapter_id>.receipt.json.cli.json and .sources.json files the '
                         'pinned helper writes beside each receipt; re-author chapters whose evidence was lost.')
    return files


def source_text_summary(files):
    """What an export preview must tell the owner about included third-party text."""
    packets = [n for n in files if SOURCES_RE.fullmatch(n)]
    outputs = [n for n in files if OUTPUT_RE.fullmatch(n)]
    if not packets and not outputs:
        return None
    return {'chapters': len(outputs), 'packets': len(packets),
            'bytes': sum(len(files[n]) for n in packets + outputs)}
