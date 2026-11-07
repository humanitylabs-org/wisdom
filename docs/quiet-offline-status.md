# Quiet offline status

Owner correction (26 October 2026): “the offline notification should be more subtle or temporary, not persistently displaying 24/7 while the user is trying to read.” Worker and transport errors are not reader copy.

## Shared-component decision
- REUSE: pinned WizOffline replica, worker, ordered outbox and idempotent mutations; shared files stay byte-identical.
- REUSE: Wizard Appearance v1, `--wz-text`, `--wz-base`, `--wz-border`, existing standalone aliases and reader Back handling.
- EXTEND: Wisdom’s existing domain adapter/status presentation, not the shared engine. A three-second, fading, noninteractive pill replaces the persistent bar; only retained failed changes show dismissible details. The clipped `[data-offline-status]` text still describes current state and browser connectivity events update it immediately.
- NEW: none. No parallel offline, Back, theme or notification framework.

No progress chrome while saving. First complete library save is remembered in device local storage per app base and activated shell cache generation. Reconnecting with a queued batch shows its successfully synced count. Temporary saving errors are silent. Failure details retain the quote/note, with plain-language reasons instead of raw diagnostics; a 44px dismiss button restores reading without deleting the failed change. New failures can surface again.

## Regression proof
`qa/offline-status.cjs`: **offline status is temporary and never persistent while reading**. This adapter-only Chromium test deliberately supplies synthetic state; it verifies four-second disappearance, once-per-shell memory across reload, incomplete-art copy, connection event updates, synced counts, raw-error suppression and retained-failure one-tap dismissal. It does not claim worker/network acceptance.

`qa/offline-acceptance.cjs` separately exercises the real pinned kit and service worker against a disposable library copy: full offline library/art, durable ordered edits, failed change retention/dismissal, no forced reload, sibling cache isolation and dark/light 390×844 home/transition/reader screenshots. Reader notice geometry must stay above turn/progress controls, with no pointer interception. `qa/test_offline.py` guards deterministic shell regeneration and pinned shared bytes; `qa/offline_regressions.py` retains all existing reader/Back/home/highlight checks.

Release staging targets private.34, with no live promotion, merge or owner-library writes.
