# Cached-edition freshness regression

## Diagnosis: product bug, not a premature browser assertion

The v7 cached-edition request trace was metadata GET → highlight POST → held full GET → highlight POST, with zero chapter GETs. The full GET is an important ordering barrier: production `load()` awaits the metadata adapter and calls `showLoaded(meta)` before requesting full data. Thus this was not merely a reader observed before metadata arrived.

`rememberPartial` previously refused to update **any** saved full snapshot. Metadata correctly invalidated the old in-memory body, but left the old complete replica intact. The durable pending highlight's failed flush subsequently called production `onSynced(await projected())`. `syncOffline` applied that old replica, restoring the stale hash/body. The reader then skipped `hydrateChapter` because a body string was present. The pending old-edition note could also be incorrectly projected as current.

## Minimal repair

Extend the existing adapter and existing replica/state key, not the shared kit or renderer. Capture a body-free edition fingerprint and personal-field versions before the metadata request. In the existing strict atomic transaction, metadata may replace that pre-existing cached state, carrying bodies only for matching hashes and retaining saved collection requests. Replay the real durable outbox against the resulting new metadata. If a different-edition complete snapshot was committed while metadata was in flight, preserve and return it instead of the delayed metadata. A successful highlight/reaction in the same edition is not a new edition: retain its acknowledged personal fields separately, invalidate its old body, and retain its note as unresolved if the chapter hash changed. An unavailable pre-read invalidates rather than trusting the old full snapshot. Selected chapter fill still requires an exact hash and a partial replica. Full API, pending-write, quota fallback, discussion-close and focus/scroll guards remain intact.

Only `static/offline.js` changes at runtime. No prose/library/progress files, authoring/provider/accounts/settings/config, kit bytes, source pins, Appearance helpers or browser deadlines change. The native cached-edition assertion is unchanged; it is not weakened, slept through or dropped.

## Executable discriminator

`node --test qa/library-cached-freshness.test.cjs` executes the complete production `offline-kit.js`, domain adapter and Wisdom module (startup, sync callback, route entry, chapter hydration and chapter HTML renderer), using actual local HTTP responses. Only two test-only state/promise getters are added to the VM export. The small transactional IDB transport double supplies storage/events, not application projection or freshness logic. The HTML host is a non-layout transport double; native layout, focus fidelity and visual Appearance remain separate queued gates.

Gates are actual metadata/full-request and chapter-promise events, not delays. The full response stays held through every selected-chapter freshness assertion. Both flush orderings reproduce the defect against the exact old adapter. Additional controls permit the cached reader while metadata is unresolved, protect concurrent complete hydration in storage and memory, and preserve the durable note/rating, saved collection request and focused editor/scroll.

The initial five-case discriminator against original adapter `0c07518f11144ecfbf9c8b7c69dcf4c21a3e6023` returned 2 PASS / 3 FAIL. Independent review of the first repair correctly rejected whole-state equality and unsafe pre-read failure. Four further integration cases now cover successful highlight and rating acknowledgements during metadata followed by failed full hydration, pre-read failure, and same-edition concurrent full save. Corrected adapter: all nine integration cases PASS. The companion existing startup/projection and quota tests make 20 passing targeted tests. Raw logs, exact SHA256s, consultation and independent-review receipts belong to the sealed acceptance input, not a claim of native acceptance.

## Required acceptance reset

This is a runtime change. All earlier six observed transitions, 272 Python tests and earlier runtime approvals remain historical with their original origins. None count as acceptance of this repair. A fresh exact-source independent review, full Python suite, all 24 current-shell transitions, partial-replica/SW and full offline checks, and all original 18 baseline/candidate/live-static cases remain mandatory. Keep shell `7f4f45fd9d84e2319fae0b50f01dc08685543cdc` and existing fixture/browser/static pins; never autorepin. Inspect the same live two-skin phone/desktop screenshots and opaque panels. No merge, deployment, activation or native execution is authorized by this document.
