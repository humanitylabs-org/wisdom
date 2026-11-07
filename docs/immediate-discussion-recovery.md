# Immediate reader discussions and recoverable delivery

Repair base: installed source label `6d51d4b08ceb3969480971196e743fb952f96ddd`
(private.35, image `sha256:64e6751637d85c4dac24a506cf7acb634be75225de3b6adb7f891cc180ac38a1`).

The promotion preflight found one effective-live delta not described by that
source label: `static/wizard-appearance.css` is the already-deployed opaque-panel
fix from `de5627b11a0d1f04538d6cdd25f69f809857cc2b`. Its SHA256 is
`8d0e37ff2629de3d6577bb7d6e32e1a551d37d78b5561cd43202fa8e6cbc2413`.
All 60 other packaged runtime files match the labelled base. Preserve those exact
CSS bytes and regenerate the offline shell identity before packaging. The earlier
`0cf54ba1405431079c95dc004b9948dbc4867cbd` image is **not deployable** because it
would silently remove this live repair, despite a source-only parity PASS.
This integrated candidate requires its own worker acceptance and image receipt.
It remains an owner-local same-release hotfix, not a newly published full release.

## Reuse / extend / new

- **REUSE:** Wisdom's existing selected-passage/chapter sheet, anchor calculation,
  transcript patching, local draft store, polling, reader freeze/unfreeze and the
  real shared WizardApp theme/Back/update-hold contracts. No new popup framework.
- **EXTEND:** the selection opener snapshots its existing merged range and opens
  immediately. Automatic highlight saving is independent and quiet; its late
  response cannot reactivate the selection toolbar. Existing discussions get the
  same synchronous, editable shell before asynchronous history hydration.
- **EXTEND:** provisional anchor-keyed drafts migrate to the canonical thread ID
  without replacing a newer edit or caret. Repeated in-flight opens coalesce;
  close, outside, chapter change and a newer selection invalidate older responses.
- **EXTEND:** delivery uses the existing server idempotency key. User-message GET
  records now expose that same request ID so reload, polling and explicit retry
  can confirm acceptance and clear only the matching pending question. No schema
  migration, prompt, inference/provider/privacy-route changes, or Chats migration.
- **NEW:** only a synthetic recovery/latency browser contract and checkpoint driver.
  The existing UI/engine/offline regressions are updated for editable hydration.

## Diagnosis

The pending-selection Ask AI handler awaited `commit()` (network highlight save)
**before** opening any panel. The sheet itself disabled the composer until its
create/history request finished. Both are avoidable UI admission gates.

The reported error screenshot matches two further traps: `busy` covered both the
POST and its potentially stalled readback, even after a terminal model-error
response was already visible; error turns with a Models and connections link
suppressed the existing Retry button. `configured === false` also permanently
blocked Send until an unrelated refresh. Offline's capture-phase gate blocked
explicit discussion taps before their local draft UI could open.

The repaired request deadline is 12 seconds, not an unbounded wait. The composer
stays editable throughout. Busy is released when POST returns, independently of
its receipt readback; generation-fenced `finally` blocks release flags on errors.
Pending, uncertain delivery is retried with the same request ID. A confirmed failed
inference is retried with a fresh ID, with the earlier transcript retained. Model
connection instructions and explicit retry coexist. Reconnect rechecks readiness
but never automatically sends a question. Storage failures preserve the in-memory
draft and show the existing warning; persistence cannot be promised when storage
itself is unavailable. No automatic offline/sync popup was added.

The pre-existing optional `chatsAvailable()/openInChats()` route is unchanged;
these regressions cover the approved independent reader sheet shown in the
reported screenshot, not a Chats bridge or a new provider. Installed-route proof
must confirm the owner is exercising that approved route.

## Acceptance boundary

1. Existing engine/idempotency/offline unit regressions.
2. Exact-live static assets against the **same** delayed-reader probe, which must
   reject both Ask AI and Open discussion for exceeding 150ms to usable paint.
3. Candidate real reader + real shared app-client/services/appearance-host proxy at actual
   iframe widths 390 and 1280, Nebula and Signal skins, 5.5-second endpoints and
   4x CPU slowdown. The composer must paint editable within 150ms.
4. Dropped POST/request and response, persisted ID replay after reload, 503, a real
   12-second timeout, successful POST with hung readback, newer edits, offline to
   online, storage failure, Stop/reopen, outside/Back while opening, duplicate
   opener and stale chapter/selection responses. Explicit retry must receive the
   fixture answer without duplicate accepted turns.
5. Existing standalone discussion contract with real shared browser Back and
   update-hold accounting.

Fixture data is disposable, API answers synthetic, and inference calls are
intercepted. The appearance host is explicitly a **proxy**, not proof of the
installed shell or a real model/provider. Screenshots, Playwright traces, latency
samples and source hashes live under `WISDOM_QA_EVIDENCE`; each stage saves an
execution log. No browser acceptance result is claimed merely by adding tests.

### Recovery QA host Back seam

The previous recovery probe navigated from `/qa-host` to a cold standalone deep
link, opened by JavaScript without a pointer gesture, then called browser Back.
The shared standalone guard is armed by real user activation; that probe could
leave the document and then fail with `WisdomDiscussion is not defined`. It was
not evidence of the hosted sheet's Back behavior. The existing standalone
`qa/discussions-ui.spec.cjs` gesture/browser-Back regression remains unchanged.

The recovery host now serves the pinned real `app-services.js` and an explicit
synthetic registry ID. In each candidate skin/viewport case, the test waits for
an actual delayed sheet GET, attaches the frame through `WizAppServices.attach`,
connects the real `WizardApp.ready`, verifies host authorization/readiness, and
delivers `WizAppServices.back(frame)`. It requires `handled`, a closed overlay
after the late response, and the same reader document, URL and track position.
It never substitutes `WisdomDiscussion.back`, changes shared code or adds guards.

Services are deliberately attached only for this Back seam, then detached using
their real lifecycle. Attaching for the entire sheet suite would advertise the
existing `threadAgents` Chats bridge and switch which product surface is tested;
the fixture does not fake that capability. This is synthetic late-mount shared
Back integration proof, **not** normal installed-shell mounting or Chats proof.
The runner redoes all eight exact-old negative controls because the fixture and
probe changed. It checks complete receipt identities before PASS; setting
`WISDOM_QA_PACKAGE=1` then packages/smoke-checks the candidate, without publishing
or deploying, within the same 900-second durable job budget.
