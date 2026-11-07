# private.36: no offline popups anywhere

## Owner contract

No automatic offline/sync notification is shown anywhere: reading, collection,
Browse, Home or My library. A retained unsaveable authored edit is available only
from a quiet My library line and an explicit View. Dismiss discards that failed
edit and returns to My library in the same tap. Progress failures are obsolete
and are removed silently; the next valid position remains authoritative.

## Reuse

- REUSE `WizOffline.create` and the byte-pinned shared offline kit/worker for transport, receipts, locking, caching and replay. Neither shared file changes.
- REUSE `WizardApp.back.useHistory`, existing Wisdom domain routes and Back for nested navigation; root Back still stays in the app.
- REUSE existing Wizard Appearance v1 receiver, library text/actions and `--wz-*` tokens; no new overlay or visual component.
- EXTEND Wisdom's domain adapter with failed-position cleanup and retained-edit rendering. Cleanup uses the kit's `wisdom-outbox` lock and deletes only failed position rows, or one explicitly dismissed failed edit; pending writes and all other failures remain intact.
- EXTEND the reader's geometry validation before pagination/saving; never derive a saved position from a zero-size stage.
- NEW: none. No new shared capability or replacement service worker.

## Root cause and evidence

A real disposable Wizard pin opens `/wizard-os-home/?app-session=wisdom`, framing
`/wisdom/`. Turn to the chapter end, go offline, queue progress/rating/done/read,
and reconnect. Those requests return 200 with the approved shared kit unchanged.
Then collapse the visible reader stage to zero width (host/window layout
transition) and dispatch the ordinary resize event. private.35 divides the
sentinel offset by zero, showing `Infinity / Infinity`. `go()` derives NaN for
progress; JSON serializes that as null. The actual server replies:

```
POST /wisdom/api/wisdom/reaction
{"kind":"entry","id":"example-chapter","field":"progress","value":null}
HTTP 400
{"error": "Use one boolean preference at a time"}
```

The shared kit correctly classifies this app-generated invalid request as
permanently failed. The old adapter retains it and announces it on collections.
The server does not accept an invalid position in this patch. The reader avoids
creating one; the adapter also removes legacy failed positions on launch/status.
The shared kit is not the root cause and remains byte-identical.

Evidence is retained privately on the QA worker under
`wisdom-nopills36/evidence/root-cause-baseline4/root-cause.json` and the release
pin/browser evidence directories. `qa/offline-pin-progress.cjs` runs the real pin
flow with zero-width regression assertions; use `WISDOM_EXPECT_POSITION_FAILURE=1`
and `WISDOM_SOURCE` pointing at private.35 for the negative control.

This reproduces a concrete failure mechanism compatible with the complaint. The
four original device-local outbox rows were not inspected, so their exact payloads
are not claimed to be proven by this disposable reproduction.

## Verification commands (worker only)

```
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=. uvx --quiet pytest -q -p no:cacheprovider qa
python3 -m qa.offline_regressions
node qa/offline-acceptance.cjs
node qa/offline-status.cjs
node qa/offline-pin-progress.cjs
```

Set `TMPDIR`, `PLAYWRIGHT_DIR`, `WISDOM_OFFLINE_SEED`, `WISDOM_QA_CORE`,
`WIZARD_PIN_WEB` and per-command `WISDOM_QA_EVIDENCE` as in the operator brief.
All write-QA copies the fixture data into disposable directories and disables AI
admission. Builds are prepared separately; no production deployment is authorized.
