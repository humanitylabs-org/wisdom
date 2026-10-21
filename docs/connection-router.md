# Connection Router integration

`requires.models` in `wizard.md` is the app-owned feature contract. Ask AI
(passage and chapter) uses `ask-ai`; Look up uses `look-up`. A deployment sets
`WISDOM_ROUTER_URL` and `WISDOM_ROUTER_GRANT` in owner-only runtime configuration.
The grant is not included in source, API responses or browser assets. The router
needs its own outgoing provider grant; the app never sends provider credentials.

When the URL is absent, the existing independent broker remains available for
configuration rollback. When the URL is present, missing grants, a down router,
needs_owner, a model mismatch or an interrupted stream **never** fall back to
that broker or another provider. Removing the URL is an explicit operator
rollback, not runtime failover. The router path does not read Claude credentials.

Prompts, sealed reading evidence, conversation limits and compact Look up
validation are unchanged. Streaming text is provisional. A successful completion
requires the feature's tested_on and a valid effective model in the router's
`done`; a different model additionally requires `chosen: owner-swap` or
`owner-pick`. Persisted assistant messages expose effective `model`, `provider`,
`tested_on`, `chosen`, `tier` and `usage`. One additive SQLite provenance column
keeps these values with each reply. Match replies show no role/model label;
explicit replacements show one muted `Answered by …` caption.

On needs_owner, the question remains and the sheet offers the router's validated
same-origin recovery URL in the shell. No source text or provisional reply is
admitted after a failed or missing done. Stop discards unverified router text and
keeps the active-run fence until the local stream worker exits; disconnect is
not represented as an upstream cancellation acknowledgement. Legacy broker stop
semantics are unchanged. Restart discards only incomplete router replies, not
completed/history data or legacy broker partials.

## Chapter authoring follow-up

`chapter-authoring` declares frontier / claude-opus-5-5 / swap never. Its packaged
agent-run authoring and review contract remains pinned, unchanged. The current
agent workflow cannot be reduced to a single text route without changing tool
execution, authoring receipts and review admission. This release does **not**
claim that authoring is router-executed. Migrate that runtime separately; never
pretend that a manifest declaration moves the agent itself.

## Verification

`qa.test_model_router` exercises real HTTP fake-router transport and admission,
needs_owner, missing grant, wrong model, missing done, explicit swaps, router
down, persisted provenance, stop fencing and broker-only configuration rollback.
The existing discussion/lookup suites continue to cover context and answer
validation. `qa/router-sheet-preview.cjs` intercepts all Wisdom writes and uses
candidate assets in the real shell; it verifies recovery, captions, retained
draft and live Nebula/Signal redressing. This is a candidate fixture, not a live
installation claim. Set `WISDOM_HOST_URL` to the owner's shell Wisdom entry.
