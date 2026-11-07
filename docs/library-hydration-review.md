# Startup / hydration review adjudication

Scope: PR59, the existing seven changed runtime files only. No authored prose,
provider/account/model configuration, shared shell implementation or owner data changes.
REUSE shared Back, Appearance v1, durable outbox and Chats `openThread`; EXTEND owning
library projection/replica; NEW no shared capability. Dark standalone CSS untouched.

| # | Adjudication / reachable path | Narrow correction / regression |
|---|---|---|
| 1 | Confirmed blocking. Cold `load` awaits metadata inside the full-request try. A rolled-back server's 404 prevents full fetch. | Metadata best effort on every load, always attempt full; source regression asserts actual call order. Browser 404/full case required. |
| 2 | Confirmed blocking. Background full completion reaches both `showLoaded` and finally; replacing Browse search DOM loses selection/IME and finally resets scroll. Kit `onState` is another caller, not an exempt path. | One reconciliation path for both `syncOffline` and load. No finally redraw/scroll with content. Preserve scroll; defer DOM replacement while an editable owns focus. Same-hash reader is painted, not rebuilt. Source tests cover home, search/IME, reader and pending rating; real browser transition cases required. |
| 3 | Confirmed. Cached online load skipped metadata, and failed full refresh was silent indefinitely. | Always refresh metadata, carry bodies only on exact SHA, remove absent entries, preserve pending ratings/outbox projection. Quiet never-painted status hook and one 30s retry timer while active/visible/online. Retry remains read-only and does not invoke a model. |
| 4 | Confirmed with two SQLite WAL connections: revision publishes a new token before commit and formerly deleted the still-committed token. | Add new token before commit without retiring the prior token or pruning while pending. Failed commit discards pending token; success bounds LRU. Old snapshot token stays usable. Commit interception regression reads real second connection before commit and tests rollback cleanup. |
| 5 | Confirmed. Chapter response with changed SHA silently returned, leaving an opening notice. | Explicit neutral updated-edition message; one automatic library refresh per id/expected SHA, then a user retry, never an unbounded request loop. In-flight response for an already-changed local SHA hydrates the current entry. |
| 6 | Confirmed. Enable calls `package_files`; missing mount raises OSError, while POST maps ValueError only. | Intentional fail-closed enable retained, translated to clean ValueError/400. Bundle status and all personal state remain unchanged. Regression injects FileNotFoundError and compares complete DB dump. |
| 7 | Confirmed. ThreadingHTTPServer chapter path bypasses global LOCK; cold misses could each inflate a bounded archive but concurrency was unbounded. | Two-slot verification semaphore only on misses, recheck cache after admission. Warm metadata and chapter hits do not acquire it or global LOCK. Regression holds global LOCK while six requests share the two slots. |
| 8 | Informational, accepted invariant. Stat identity changes invalidate verified projection. | Do not weaken identity. Full verification republishes. |

## Actual inherited test failures (not waived)

Full-suite outcome, exact original failure names and fresh current-shell browser/real
server evidence are separate queue gates, not claimed green here. Queued browser QA
must retain all 18 existing cases plus completion, mismatch/retry, SW-enabled durable
partial replica and synthetic Ask AI → real Chats cases. No native work is admitted.

## Corrected-source Opus pass 1

Actual first-party `claude-opus-5-5`, tools disabled, source `29507a6b863213652bd2bd7bb464cb79bcba823e`:
REQUEST_CHANGES. Prior findings 1,3,4,5,6,7 FIXED; 2 PARTLY.

- **A confirmed:** `.wd-overlay` is retained with `hidden`, so the broad selector
  permanently blocked reconciliation after Ask AI. Other sheets also lacked a
  close-time resumption. Match only visible discussion overlays; mark pending and
  attach a temporary MutationObserver only while blocked. Disconnect when surfaces
  disappear/hide, then reconcile. This covers owning note/request/manager close paths
  without changing any shared shell. Source regression exercises real production
  reconcile functions through visible→hidden and subsequent refreshes.
- **B partially confirmed:** the alleged `undefined` return was not present: the
  original outer `return result` already ran after the inner catch. Its false
  edit-failure alarm *was* real. Make fallback `return result` explicit in catch,
  keep cache-fill diagnostics hidden, and do not set edit-failure state for reads.
  Exact adapter execution with a thrown QuotaExceededError asserts body identity,
  a hidden cache diagnostic, and absence of an edit-failure alarm.
- Preserve cached unsent collection requests across metadata refreshes (a nonblocking
  observation) instead of hiding their retry controls while full refresh fails.
- Current shell intentionally moved from 35b77ee to `7f4f45fd9d84e2319fae0b50f01dc08685543cdc`
  after inspecting the five-file Settings/Appearance/Store source delta. New proof
  compares 474 staged static assets to exact git bytes; zero static overlays.
  `ux-changes.json` is generated update attribution, not code: retain its observed
  hash/size/generator hash as provenance, but use a schema-correct empty-attribution
  fixture so no private thread metadata enters synthetic QA. Never autorepin later.

Pass 2 is a separate final-source review, with all queued acceptance gates explicit.

## Publication / rollback

No activation/merge authority in this task. Recheck fresh live source/image/61 packaged
hashes and current shell + overlays before future promotion. Routine app restart through
the existing WAM lifecycle preserves account/data and does not need an invented owner
idle confirmation. Record startup-to-health timing and changed container/image identities.
Only normal user-tapped reload/update holds; no forced reload or shared shell downgrade.
