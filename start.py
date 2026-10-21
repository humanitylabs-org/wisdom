#!/usr/bin/env python3
"""Container entry: make the two owner mounts usable by the app user, then drop root for good.

Runtipi creates app-data and media folders as root. The app itself never runs as root: this only
creates/chowns the top-level DATA and LIBRARY folders (CHOWN/SETUID/SETGID are the only capabilities
granted) and then switches to uid/gid 1000 before importing any app code."""
import os, sys
UID = int(os.environ.get('WISDOM_UID', '1000'))
GID = int(os.environ.get('WISDOM_GID', '1000'))
if os.geteuid() == 0:
    for d in (os.environ.get('WISDOM_DATA', '/data'), os.environ.get('WISDOM_LIBRARY', '/media/Wisdom')):
        try:
            os.makedirs(d, exist_ok=True)
            if os.stat(d).st_uid != UID:
                os.chown(d, UID, GID)
        except OSError as e:
            print(f'start: could not prepare {d}: {e}', file=sys.stderr, flush=True)
    os.setgroups([])
    os.setgid(GID)
    os.setuid(UID)
os.execv(sys.executable, [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'server.py')])
