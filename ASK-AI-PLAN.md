# Wisdom · Ask AI — approved 16 Oct 2026

Outcome: select or revisit a passage, discuss it in Wisdom with a minimally prompted independent Claude model and web search, retain exact edition context and conversations. Scholar/tutor evolution is deferred: resurface after James has used the companion. No Archimedes routing, SOUL.md, memories, Hermes changes, unrelated app navigation or full guest rebuild.

Design: fixed overlay phone bottom sheet (peek -> expanded for keyboard/send), desktop 400px right overlay. Never repaginate underlying reader. Quote, chapter label, web toggle, starter questions, streamed transcript with Sources used, draft composer. Opening never generates. Close/back stays in reader; reopening restores draft and saved messages; server work continues while closed. App/chapter discussion list is a find/reopen surface, not generic new chat. Existing highlight toolbar gets Ask AI/Open discussion. Shared WizardApp Back/update holds/appearance. No page numbers invented: chapter title plus existing reader page if available.

Route: shipped Python app owns DB/persistence/anchoring and context. Configured HTTP NDJSON inference endpoint, independent host service calling first-party Claude CLI with replaced system prompt, isolated HOME/config/cwd, empty MCP/settings/skills, only WebSearch/WebFetch if enabled. Model claude-opus-5-5 (app recommends). HTTP endpoint owns no personal state. No provider fallback. Source text is data, not instructions. App sends selected passage + immutable full chapter snapshot + bounded relevant same-collection excerpts; source URLs are metadata, not purported read content. Explicit citations and model provenance. App receives deltas and final source evidence. Browser cannot control prompt/model/CLI/URLs.

API contract (relative to app base):
- GET api/discussions -> {threads:[{id,entry_id,chapter_title,quote,body_sha256,start,end,updated,message_count,preview}],configured:bool,model:string}
- GET api/discussions/<id> -> {id,entry_id,chapter_title,quote,body_sha256,start,end,web_enabled,messages:[{id,role,content,state,sources:[{label,title,url?,text?}],error?}],active:bool,detached:bool,model:string}
- POST api/discussions {entry_id,body_sha256,start,end,text,highlight_id?} -> thread (idempotent per edition/range/text). Server creates exact snapshot; no model call.
- POST api/discussions/<id>/ask {question,request_id,web_enabled} -> thread. request_id idempotent and conflict checked; accepted runs persist and execute independently. Poll GET thread ~1s while active to render true streamed deltas; paused polling while panel closed resumes on open.
- POST api/discussions/<id>/stop {} -> thread. Cancel inference, retain partial.
- Failed/interrupted ask retry same question with NEW request_id; UI preserves failed transcript and explicit retry state; no auto retries.

Integration JS module global WisdomDiscussion: configure({base,getContext,navigateTo}), open(anchor), list(entryId?), has(entryId,hash,start,end), isOpen(), close(), refresh(). getContext returns current chapter context if needed; anchor={entry_id,body_sha256,start,end,text,highlight_id?}. Module creates own overlay, event handlers, lazy data loading. Shell calls shared back handler / module itself follows shipped API. Parent handles wiring to wisdom.js and index.html, API/server/DB, model broker, release.

Acceptance:
1. Fresh selection and saved highlight open idle UI; Explain returns a REAL independent model response, streamed and persisted; follow-up uses prior context and sources. Web on can perform a real search and off has no search tools.
2. Close/Back/reopen/reload preserves passage and draft; desktop/360/412px touch layouts stay usable. Full chapter read position unchanged; nested Back keeps app open. Highlight/thread reopens exact edition; revised/removed text preserves snapshot.
3. Request identity isolation, race-safe one active turn, interrupted/retry states, origin guard, no model/system prompt override, no Archimedes filesystem/tools/history; model failure shown honestly.
4. Builds, browser QA, broad tests on Thales /Volumes/ThalesMedia. Source only/lightweight checks on VPS. Commits pushed before image/preview; main by PR. Existing owner data preserved. Verify installed live image and source with readback.

First slice: create anchored thread -> ask via independent endpoint -> render persisted stream. Then polish and focused regression, then release. User has authorized build and existing app deploy; public listing or broader runtime changes not authorized.
