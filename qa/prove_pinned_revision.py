#!/usr/bin/env python3
"""Fast synthetic checks only; run on the designated worker from pushed source."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--evidence', type=Path, required=True)
    args = p.parse_args()
    root = Path(__file__).resolve().parents[1]
    if root == args.evidence.resolve() or root in args.evidence.resolve().parents:
        p.error('Evidence must be outside the source checkout')
    args.evidence.mkdir(parents=True, exist_ok=True)
    git = lambda *a: subprocess.check_output(['git', *a], cwd=root, text=True).strip()
    if git('status', '--porcelain'):
        p.error('Use an exact clean pushed commit')
    modules = ['qa.test_pinned_revision', 'qa.test_author_collection', 'qa.test_portable',
               'qa.test_shared_thinkers', 'qa.test_release_gates', 'qa.test_ship_blockers',
               'qa.test_starter', 'qa.test_library_scope']
    command = [sys.executable, '-m', 'unittest', *modules, '-v']
    run = subprocess.run(command, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=90)
    log = run.stdout
    (args.evidence / 'focused-tests.log').write_text(log)
    matches = re.findall(r'^Ran (\d+) tests in (.+)$', log, re.M)
    files = git('ls-files').splitlines()
    manifest = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in files}
    record = {'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'host': platform.node(), 'system': platform.platform(), 'python': sys.version,
              'cwd': str(root), 'commit': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}'),
              'branch': git('branch', '--show-current'), 'source_clean': not git('status', '--porcelain'),
              'command': command, 'tmpdir': os.environ.get('TMPDIR'), 'exit_code': run.returncode,
              'test_count': int(matches[-1][0]) if matches else None,
              'duration': matches[-1][1] if matches else None,
              'log_sha256': hashlib.sha256(log.encode()).hexdigest(), 'source_sha256': manifest,
              'scope': 'Synthetic unit + real disposable HTTP/MCP/CLI; mocked model transports; no live author, container build, browser, deployment or owner data'}
    (args.evidence / 'focused-proof.json').write_text(json.dumps(record, indent=2) + '\n')
    print(log)
    print(json.dumps({k: v for k, v in record.items() if k != 'source_sha256'}, indent=2))
    return run.returncode


if __name__ == '__main__':
    sys.exit(main())
