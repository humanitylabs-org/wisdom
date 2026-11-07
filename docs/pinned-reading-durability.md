# R22 strict durability adapter candidate

REUSE the existing `wisdom-offline-v1` replica, ordered/idempotent outbox and `meta` store. EXTEND the canonical offline-kit presentation primitive and Wisdom's `crashDurable:true` opt-in. No new database/store or notification UI.

The new presentation primitive is identical to the canonical host's implementation; the remainder of this vendored kit retains Wisdom's existing version (the host has later unrelated APIs, not imported here). `savingFailed()` uses the existing My Library failure panel, including the existing post-DOM-replacement repaint path. No popup, toast, new pin or APK.

Pinned route/exact fractions are host-scoped records in the existing `meta` store, loaded before the host mounts the app; the app-owned reading/selection/layout code is unchanged. Existing outbox/data writes require a completed strict transaction, and explicitly reject unsupported strict durability instead of reporting a weaker write as saved. Normal desk positions and shared content/preferences keep their existing identities.

Source-level regression and the parent-only four-case old/new browser packet are documented in wizard-os-home `docs/pinned-reading-durability.md`. Browser hard-kill success, native full-position equality, visual/live parity, image/package/release acceptance are not claimed by this source patch.
