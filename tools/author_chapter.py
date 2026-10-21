#!/usr/bin/env python3
"""Owner-side execution helper; publishing remains the app's ordinary API/MCP.

Calls only the pinned author route. When a draft fails the mechanical checks the
helper itself asks the same pinned route again with the check's error (at most
two more times, inside one shared budget). Only an accepted draft becomes a
chapter file and receipt, with the raw CLI result (`<receipt>.cli.json`) and the
exact source packet (`<receipt>.sources.json`) beside it; exports carry both so
import can recheck quotations. Rejected drafts go to `rejected/` beside the receipt,
wrapped as rejected evidence; they are never an edition.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import authoring_contract as policy
import authoring_admission as admission
import library
from tools.author_collection import save_bundle

LIMIT = 2 * 1024 * 1024
ATTEMPTS = 3          # first draft plus two same-model recoveries
BUDGET_USD = 5.0      # one cap shared by every attempt for this chapter
MIN_ATTEMPT_USD = 0.25
EXIT_REJECTED = 3
NO_EDITION = ('NO EDITION for %s. The pinned author (anthropic / claude-opus-5-5) was asked %d time(s); '
              'its last draft failed the mechanical checks: %s. Nothing was written to the output or receipt path. '
              'Do not write chapter Markdown or assemble a receipt yourself: admission recomputes these checks and '
              'refuses hand-built or edited receipts, and prose without a receipt is labelled unverified. '
              'Re-run this helper with a fresh --output/--receipt pair, or stop and report this blocker. '
              'Rejected drafts (evidence only, not chapters): %s')


class Rejected(ValueError):
    """Every pinned attempt failed the mechanical checks; no edition exists."""


def bounded(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > LIMIT:
        raise ValueError('Expected bounded regular input file')
    return path.read_bytes()


def route_guard():
    for flag in ('CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'):
        if os.environ.get(flag) not in (None, '', '0', 'false'):
            raise ValueError('Third-party CLI provider configured; pinned route unavailable')
    if os.environ.get('ANTHROPIC_BASE_URL', 'https://api.anthropic.com').rstrip('/') != 'https://api.anthropic.com':
        raise ValueError('Custom API proxy cannot establish the pinned firstParty route')
    exe = shutil.which('claude')
    if not exe:
        raise ValueError('Claude CLI is unavailable; no alternative author is permitted')
    return exe


def call_author(exe, c, schema, payload, budget, workdir, stage=None):
    argv = [exe, '-p', '--model', c['model'], '--output-format', 'json', '--json-schema', json.dumps(schema),
            '--system-prompt', (stage or c)['prompt_text'], '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
            '--safe-mode', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence',
            '--max-budget-usd', '%.2f' % budget]
    # Isolated cwd prevents accidental project context; auth stays in the owner's configured CLI.
    with tempfile.TemporaryDirectory(prefix='.wisdom-author-', dir=workdir) as work:
        log = Path(work) / 'result.json'
        with log.open('wb') as out:
            run = subprocess.run(argv, input=payload.encode(), stdout=out, stderr=subprocess.PIPE, cwd=work, timeout=600)
        if run.returncode:
            raise ValueError('Pinned Claude CLI failed (exit %s); no fallback' % run.returncode)
        return bounded(log)


def draft(result, chapter, source_data, glossary=None):
    """Extract and mechanically check one draft; ValueError means retryable rejection.

    `glossary` is the owner brief when authoring the optional glossary stage; the
    accepted body is then the canonical glossary JSON instead of chapter Markdown."""
    value = result.get('structured_output')
    if value is None:
        try:
            value = json.loads(result.get('result', ''))
        except (TypeError, ValueError):
            raise ValueError('Author returned no JSON chapter object')
    if glossary is not None:
        entries = policy.validate_glossary(value, source_data, glossary)
        checks = {'terms': len(entries), 'source_count': len({v['source_url'] for v in entries.values()})}
        return json.dumps(entries, ensure_ascii=False, indent=2) + '\n', checks
    if not isinstance(value, dict) or set(value) != {'chapter_id', 'body'} or value['chapter_id'] != chapter:
        raise ValueError('Author returned wrong chapter identity or output schema')
    return value['body'], policy.validate_chapter(value['body'], source_data)


def keep_rejected(folder, chapter, attempt, error, raw):
    """Rejected drafts are evidence for the owner, wrapped so no tool mistakes them for a chapter."""
    if folder.is_symlink() or (folder.exists() and not folder.is_dir()):
        raise ValueError('rejected/ beside the receipt must be a plain directory')
    folder.mkdir(mode=0o700, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=chapter + '.attempt-%d.' % attempt, suffix='.rejected.json', dir=folder)
    with os.fdopen(fd, 'wb') as f:
        f.write((json.dumps({'status': 'REJECTED - not an edition; never publish, export or receipt this text',
                             'chapter_id': chapter, 'attempt': attempt, 'error': error,
                             'cli_result_sha256': policy.sha(raw), 'cli_result': raw.decode('utf-8', 'replace')},
                            ensure_ascii=False, indent=2) + '\n').encode())
    return Path(name)


def author(chapter, brief, sources, output, receipt, attempts=ATTEMPTS, glossary=False):
    library.ident(chapter)
    raw_result = receipt.with_name(receipt.name + '.cli.json')
    kept_sources = receipt.with_name(receipt.name + '.sources.json')
    paths = (output, receipt, raw_result, kept_sources)
    if len({x.absolute() for x in paths}) != 4 or any(x.exists() for x in paths):
        raise ValueError('Choose new output and receipt paths; never overwrite an edition')
    c = policy.contract()
    brief_raw, source_raw = bounded(brief), bounded(sources)
    source_data = json.loads(source_raw)
    if not isinstance(source_data, list) or not 1 <= len(source_data) <= 50:
        raise ValueError('Supply 1–50 researched sources')
    for s in source_data:
        if not isinstance(s, dict) or not isinstance(s.get('text'), str) or not s['text'].strip() or not isinstance(s.get('url'), str) or not s['url'].startswith(('https://', 'http://')):
            raise ValueError('Each source needs url and verbatim text')
    exe = route_guard()
    # Create destination folders before any paid call, so a missing folder can never
    # turn an accepted or rejected draft into a crash after the model has answered.
    for folder in {output.parent, receipt.parent}:
        if folder.is_symlink() or (folder.exists() and not folder.is_dir()):
            raise ValueError('Output and receipt folders must be plain directories')
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    request = {'chapter_id': chapter, 'brief': brief_raw.decode(), 'sources': source_data}
    schema = {'type': 'object', 'properties': {'chapter_id': {'type': 'string', 'const': chapter}, 'body': {'type': 'string'}},
              'required': ['chapter_id', 'body'], 'additionalProperties': False}
    if glossary:
        schema = policy.glossary_schema()
    stage = c['glossary'] if glossary else c
    rejected_dir = receipt.parent / 'rejected'
    spent, kept, error, history = 0.0, [], None, []
    for attempt in range(1, attempts + 1):
        budget = BUDGET_USD - spent
        if budget < MIN_ATTEMPT_USD:
            break
        if error is not None:
            # Same pinned route and system prompt; the check's error is the only new input.
            request['revision_request'] = {'attempt': attempt, 'previous_body' if not glossary else 'previous_output': history[-1],
                                           'failed_check': error,
                                           'instruction': 'Return the whole chapter again, fixing only what the failed check reports. '
                                                          'Quote supplied text exactly or do not quote it.'}
        payload = json.dumps(request, ensure_ascii=False)
        raw = call_author(exe, c, schema, payload, budget, output.parent, stage)
        result = json.loads(raw)
        cost = result.get('total_cost_usd')
        spent += cost if isinstance(cost, (int, float)) and cost > 0 else 0.0
        try:
            usage = policy.verify_usage(result)
        except ValueError as e:
            # A wrong or mixed route is a hard stop, never retried and never an edition.
            kept.append(str(keep_rejected(rejected_dir, chapter, attempt, str(e), raw)))
            raise ValueError(str(e) + '. No edition; rejected response kept at ' + kept[-1])
        try:
            body_text, checks = draft(result, chapter, source_data, brief_raw.decode() if glossary else None)
        except ValueError as e:
            error = str(e)
            value = result.get('structured_output')
            history.append((value if glossary else value.get('body', '')) if isinstance(value, dict) else '')
            kept.append(str(keep_rejected(rejected_dir, chapter, attempt, error, raw)))
            continue
        body = body_text.encode()
        record = {'version': 1, 'workflow': stage['id'], 'workflow_version': stage['version'], 'format': stage['format'],
                  'workflow_sha256': c['workflow_sha256'], 'prompt_sha256': stage['prompt_sha256'],
                  'brief_sha256': policy.sha(brief_raw), 'sources_sha256': policy.sha(source_raw),
                  'input_sha256': policy.sha(payload.encode()), 'cli_result_sha256': policy.sha(raw),
                  'output_sha256': policy.sha(body), 'output_tokens_sha256': admission.tokens_sha256(body), 'chapter_id': chapter, 'provider': c['provider'], 'model': c['model'],
                  'modelUsage': usage, 'checks': checks, 'attempt': attempt, 'rejected_attempts': len(kept),
                  'evidence_kind': 'local CLI provenance, not cryptographic provider attestation or source-truth proof'}
        save_bundle(raw_result, raw)
        # The exact source bytes travel with exported collections (receipt option C)
        # so import can recheck quotations; they may hold third-party text.
        save_bundle(kept_sources, source_raw)
        save_bundle(output, body)
        save_bundle(receipt, (json.dumps(record, ensure_ascii=False, indent=2) + '\n').encode())
        return record
    if error is None:
        raise ValueError('Author budget exhausted before a draft was produced; no edition')
    raise Rejected(NO_EDITION % (chapter, len(kept), error, ', '.join(kept) or 'none'))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ('brief', 'sources', 'output', 'receipt'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--chapter', required=True, help='Stable chapter or collection identifier')
    p.add_argument('--glossary', action='store_true', help='Author only the optional glossary using the packaged glossary stage')
    a = p.parse_args()
    try:
        print(json.dumps(author(a.chapter, a.brief, a.sources, a.output, a.receipt, glossary=a.glossary), indent=2))
    except Rejected as e:
        print(str(e), file=sys.stderr)
        return EXIT_REJECTED
    except (ValueError, OSError, subprocess.TimeoutExpired) as e:
        print(str(e), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
