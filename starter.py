"""First-install-only private test collections; never reset an existing library."""
from pathlib import Path
import os
import library

SEED_ID = 'private-testing-20261015'

def seed(c, directory=None):
    directory = Path(directory) if directory is not None else Path(os.environ.get('WISDOM_STARTER_DIR', str(Path(__file__).parent / 'starter')))
    if not directory.is_dir():
        return  # Code-only development/contract tests.
    files = sorted(directory.glob('*.zip'))
    if not files:
        return  # Public builds ship without the private starter collections.
    c.execute('CREATE TABLE IF NOT EXISTS wisdom_starter (id TEXT PRIMARY KEY, status TEXT NOT NULL)')
    prior = c.execute('SELECT status FROM wisdom_starter WHERE id=?', (SEED_ID,)).fetchone()
    if prior and prior[0] in ('complete', 'skipped-existing'):
        return
    if not prior:
        # Do not add seed content to any pre-existing user's library or state.
        tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        populated = any(c.execute('SELECT 1 FROM "' + t + '" LIMIT 1').fetchone()
                        for t in tables if t not in ('wisdom_starter', 'sqlite_sequence'))
        if populated or any(library.root().iterdir()):
            c.execute('INSERT INTO wisdom_starter VALUES (?,?)', (SEED_ID, 'skipped-existing'))
            c.commit()
            return
        c.execute('INSERT INTO wisdom_starter VALUES (?,?)', (SEED_ID, 'pending'))
        c.commit()
    if len(files) != 4:
        raise ValueError('Private test release requires exactly four starter bundles')
    for path in files:
        bundle = library.stage(c, path.read_bytes())
        library.approve_source(c, bundle, 'starter:' + SEED_ID)
        library.action(c, {'id': bundle['id'], 'action': 'enable'})
    c.execute('UPDATE wisdom_starter SET status=? WHERE id=?', ('complete', SEED_ID))
    c.commit()
