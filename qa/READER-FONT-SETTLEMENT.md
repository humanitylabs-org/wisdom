# Reader font settlement / exact position (R24 candidate)

Reuse: EXTEND `layout`, its existing sentinel and the FontFaceSet completion path. REUSE R22 strict IndexedDB durability and exact local fraction. No new cache, native API or input wait.

## Source-backed defect and bounded change

`document.fonts.ready` used to be captured before `layout(false)` requested this chapter's faces. That already-resolved promise can miss a subsequent load. With the flow's width and column count fixed, a font swap can move the sentinel without changing an observed box size. The footer then retains the earlier count. R24 reads ready after layout and listens to `loadingdone`/`loadingerror`; it remeasures only when actual sentinel columns/width disagree, without polling or sleeping. A captured reader plus generation fences stale ready callbacks.

The existing anchored-layout branch also discarded `exactFrac` unconditionally. It now retains the original double when that fraction still maps to the anchored page; genuine incompatible resize/text-size anchors continue to own the line. No 100-based projection is used as local restoration truth.

## Evidence boundaries

The R23 physical before/after screenshots visibly have the same words, wrapping and vertical positions; only footer 5/13 versus 5/15 is unambiguously different. Repeated prose does not establish a unique first-visible offset. RGB differences may be rasterization, not movement. HTTP 200 font receipts do not establish FontFaceSet readiness; the native fixture honestly reports `not-observable-no-JS-injection`.

Opus consulted against actual source/CSS/loading order and these pixel observations. Its stale font-measurement explanation is source-supported, **not established as the native root cause**. Its suggestions to relax pixel comparison or add production diagnostics are rejected. The previous font candidate remains quarantined and was not copied. The earlier real-browser delayed-font matrix did not reproduce the old failure; do not relabel it as a negative control.

`qa/reader-font-pagination.test.cjs` exercises actual extracted production functions against source-only FontFaceSet/DOM seams. Candidate passes ten checks. R22 source specifically fails late face/stale count, exact precision, stale reader/generation, and loadingerror remeasurement. These are synthetic source regressions, not browser or native acceptance.

The fresh parent-only native packet must retain exact footer AND body RGB comparisons, signed code87 APK, both death arms, IPv4/IPv6 UID network isolation and ID/path-specific lost ACK. No release claim until those actual checks pass. If R24 still drifts, retain this failed packet/evidence and rediagnose; do not add a settle sleep or weaken the oracle.

Visual: this patch changes no CSS, tokens, panels or appearance. Existing two-skin evidence is not fresh post-change acceptance; the parent must rebind affected browser/skin QA to this revision after native proof.
