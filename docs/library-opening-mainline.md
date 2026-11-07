# Library opening: bounded shared-main integration

This is the opening-speed delta from #59, ported onto current shared main rather than merging its unrelated draft stack. The original repair is already installed; this source integration does not install, restart, publish an image, change settings or read the owner's library.

## Retained behavior

- Publish the existing `WizOffline.projected()` library, including pending edits, before waiting for the network.
- Refresh verified body-free metadata, hydrate a selected chapter through only its owning archive, then reconcile the full library in the background.
- Bind navigation and cached chapter bodies to exact edition/file identities. Preserve acknowledged and pending personal edits; do not resurrect old bodies during concurrent metadata/full responses.
- Retain focused editors, scroll and matching readers across background completion. Defer repaint across open overlays and resume when they close.
- Reuse the existing replica/outbox; never create a parallel content cache or change author-admission rules.

## Mainline preservation

The port deliberately excludes the source-custody, discussion recovery, crash-durable presentation-journal and reader/font changes from #55–#58. These remain on their original branches for separate integration. Main's home-screen declarations, offline-popup guard, kit provenance, CSS opacity/token fixes, packaging and CI workflow are retained. The only generated asset change is the existing offline-shell identity.

Backend changes match the approved live speed repair. The reader receives only its speed/hydration hunks. The adapter combines those hunks with main's existing export/offline guard; it does not import unavailable presentation or saving-failure APIs from the old stack.

## Regression entry point

`python3 -B -m unittest discover -s qa -p 'test_*.py'`

The normal discovery command includes `test_library_boot`, `test_library_hydration`, `test_library_http_concurrency` and `test_library_client` (which invokes the existing Node source-executed cached-freshness, hydration and quota guards). All fixtures are synthetic and must run with isolated state/data homes. Sustained tests and native browser acceptance run on the admitted Forum worker, not the control-plane VPS.

The prior live acceptance covered direct/Morning × phone/desktop × Nebula/Signal, with controlled usable-content times of 76–211 ms while the full API remained unresolved for at least 5.5 s. Those measurements belong to the exact installed source, not to this different mainline tree and not to a physical phone. New mainline test evidence must identify its exact commit and distinguish pinned-shell synthetic acceptance from deployed/live or handset coverage.
