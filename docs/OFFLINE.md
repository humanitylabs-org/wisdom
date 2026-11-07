# Offline reading

Wisdom can keep this device's complete library for a flight. Open it once while connected and leave it open until the quiet bottom line says **Ready offline**. Each browser/device must do this separately; installing the PWA does not download the library by itself. The browser may evict storage (Wisdom requests persistent storage, but cannot guarantee it), and clearing site data removes unsynced work.

The shell and library are network-first, not permanently stuck on a cached build. All referenced artwork and four reading fonts download in the background, four at a time, resuming from saved assets after interruption. The installed scope stays `/wisdom/`; no root worker or sibling app cache is modified.

When disconnected, the bottom line says **Offline**. Reading, existing glossary definitions, highlighting, passage notes, stars, ratings and reading progress work locally. **N pending** means those edits are durably stored on this device. They replay in order on reconnect (or the next opening if the app was closed). The server deduplicates retries by a transactionally committed operation receipt, so a lost reply does not duplicate a highlight. Temporary highlight ids are resolved before queued notes/removals replay.

AI lookup, Ask AI/discussions, new collection requests, Go deeper and collection management require a connection. They show **Needs a connection** immediately, rather than opening an empty AI sheet or pretending a model can run offline.

A permanent rejection is never quietly discarded. **Couldn’t save** stays in the offline status; expand it to read/copy the rejected quote and note. In particular, a changed chapter edition cannot accept an old highlight anchor. The local quote/note remains on the device for recovery; reopen the latest chapter and select the passage again. No automatic text reanchoring, conflict overwrite or force reload is attempted.

## Shared implementation and release checks

REUSE: `WizardApp.back`, `WizardApp.theme`, `WizardApp.update.hold`. EXTEND: existing Wisdom API and reader optimistic updates. NEW: the generic offline replica/outbox implementation lives in wizard-ux `web/core/offline-kit.js` and `offline-sw.js` (PR #536, left open). This app ships byte-identical copies until core resources can be loaded offline directly. `qa/offline-kit-source.json` records exact source commit and SHA-256 for both; `qa/test_offline.py` enforces it. `tools/offline_shell.py` hashes every served shell file and pinned shared platform bytes; regenerate the worker after editing a shell byte.

`qa/offline-acceptance.cjs` uses a disposable copy of the installed library and state; never run write QA against the owner instance. It tests 390×844 touch, all collections, three chapters/art from different collections, pending highlight/note/reaction/progress, disconnected reload, replay and API readback, changed-body rejection, immediate connection messages, nested Back, a foreign cache sentinel, build A→B freshness, and no forced reload of an unsaved Note sheet. Existing reader/home/highlight regressions and both native image architectures remain release gates. The live-origin offline check is a separate fresh-profile read-only browser run, with every non-GET blocked.
