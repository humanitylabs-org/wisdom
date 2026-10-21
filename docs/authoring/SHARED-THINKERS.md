# Shared thinkers in new version-1 bundles

A new collection can reuse an imported thinker ID if its full metadata has the
same canonical JSON bytes (sorted keys, compact UTF-8, finite JSON values). Object
key order is irrelevant; changed, omitted or extra values are conflicts. Export
from the original author catalog metadata, never the reader API's computed thinker
fields (`next_id`, `taste`, etc.). No person-ID renaming is necessary.

Bundle, chapter and collection IDs remain reserved across all statuses. Chapter
or collection revisions remain unsupported. Conflicts are rejected before writing
any library files or bundle registry rows. Existing archives are never overwritten.

Portrait absence means “no portrait supplied,” not deletion. Two supplied
portraits must be byte-identical. An enabled shared thinker may inherit its
portrait from a retained disabled/removed bundle, so disabling either collection
cannot orphan the remaining person's portrait. Staged bundles remain invisible;
chapter art is never inherited from disabled/removed bundles. Portrait integrity
uses the existing checksum-validated archive cache. With no enabled references,
neither thinker nor portrait is visible. Removal remains the existing soft removal.

The aggregated reader contains one thinker row with all enabled chapters and
collections. Ranking can legitimately change when new chapters arrive; owner
reading rows, chapter documents and highlights must not change.

## Private isolated rehearsal

Run `qa/snapshot_private_library.py` with explicit owner DB/media paths to create
an owner-only SQLite-backup snapshot and copy only registered immutable bundle
folders. Never put that snapshot in the source checkout or image. Transfer it to
the job-owned Thales directory. `qa/run_shared_worker.sh ROOT` must run under the
original shared `/Volumes/ThalesMedia/AndroidBuilds/worker.lock` using `lockf -k`.
It records RED against the stipulated base library, tests the updated source in a
real hardened container, creates independent volumes from the private snapshot,
and exercises `qa/prove_shared_container.py` plus mobile browser Back contracts.

All content fixture exports and importer writes target those disposable volumes.
The proof preserves all owner rows of reactions, thinkers, positions, dives,
highlights and requests exactly. On restart the existing engine may seed default
reaction rows for the six new synthetic chapters; these are counted separately,
not mislabeled as mutations to owner reading state. Screenshots, private fixtures
and snapshot receipts remain owner-controlled on Thales. No generation calls,
release, production changes, cron activation or publication are part of this slice.
