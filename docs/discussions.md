# Passage discussions

Ask AI is a Wisdom-owned conversation attached to an exact passage and chapter
edition. It does not create a Wizard chat or invoke the owner's assistant.

The reader sends only the selected anchor to the app server. The server verifies
its chapter hash and quote, snapshots the full chapter, then supplies that snapshot,
this discussion's prior completed turns, and up to three relevant same-collection
excerpts to an independent inference endpoint. Original source links are explicitly
marked unread until a web tool retrieves them. Old discussions retain their original
snapshot when a collection is revised or removed.

## Runtime contract

`WISDOM_DISCUSS_URL` and `WISDOM_DISCUSS_TOKEN` are optional operator settings.
Without them the library/reader works and discussions show an honest disconnected
state. They are server-side, never returned to the browser. The app-pinned discussion model is
`claude-sonnet-5` (chapter authoring stays on `claude-opus-5-5`); no automatic provider or model fallback is allowed.

The endpoint accepts authenticated `POST /generate` with the explicit context
contract in `discussions.context()` and returns newline-delimited JSON:

- `{"type":"delta","text":"…"}`
- `{"type":"source","source":{"label":"web","title":"…","url":"https://…"}}`
- `{"type":"done","text":"final answer","model":"claude-sonnet-5"}`
- or `{"type":"error","message":"actionable nonsecret failure"}`.

`POST /cancel` accepts `{run_id}` and must terminate its owned inference process.
The broker is private server-to-server infrastructure; do not publish its port.

An optional first-party Claude adapter is shipped at `tools/discussion_broker.py`.
It uses a fresh explicit prompt and full supplied conversation per turn, isolated
HOME/config/cwd, no persisted Claude sessions, no setting sources or MCP servers,
no skills or slash commands, and only WebSearch/WebFetch when web search is enabled.
No filesystem, shell, private history or background-agent tools are available.
The operator supplies these environment variables outside source control:

- `WISDOM_AI_HOME`: private adapter state directory, separate from the owner agent.
- `WISDOM_AI_TOKEN`: strong server-to-server bearer credential.
- `WISDOM_AI_CLI`: installed first-party Claude executable.
- `WISDOM_AI_CREDENTIALS`: operator-provisioned first-party account credentials file.
- `WISDOM_AI_BIND` / `WISDOM_AI_PORT`: private listen address/port.

Only the OAuth access token is inherited in memory; personal configuration and
memory files are not copied. Provider sign-in failures surface as failed turns;
repair the same route. No provider substitution is built in.

## Persistence and recovery

Two additive SQLite tables hold discussion snapshots and message state. Request
IDs are scoped per discussion and payload-checked. One active turn per discussion
is enforced in SQLite. The app accepts before inference and streams into durable
message content; the browser polls that content without owning execution. Closing
the sheet does not stop inference. Explicit Stop retains partial output. Service
restart marks stale streaming rows interrupted; retries are deliberate new turns.

API:

- `GET /api/discussions`: list anchored discussions and configured model.
- `POST /api/discussions`: create/reopen by exact chapter hash/range/quote.
- `GET /api/discussions/<id>`: saved messages, active state and edition status.
- `POST /api/discussions/<id>/ask`: `{question,request_id,web_enabled}`.
- `POST /api/discussions/<id>/stop`: `{}`.

These routes use the reader's existing host/origin guards. The public app MCP
intentionally does not expose private discussion transcripts to an assistant.
There is no endpoint for overriding the model, prompt, executable or provider.

## Deferred direction

James noted that this could later become, or feed into, a scholar/tutor agent.
That is deliberately outside this release. Resurface the option after he has used
the reading companion; keep personal tutoring instructions and cross-discussion
memory out of this initial discussion policy.

## Whole-chapter discussions (0.4.0-private.10)

Every chapter's end page has **Discuss with AI** (James, 18 Oct 2026). It opens the same
discussion sheet with no passage selected: `POST /api/discussions` with exactly
`{entry_id, body_sha256, scope: "chapter"}`. The thread is stored with `start = end = 0` and an
empty quote, one per chapter edition (repeat opens return it), and is served with
`scope: "chapter"` (passage threads report `scope: "passage"`). The model receives the full
chapter as before, with a system prompt that names the whole chapter as the subject. The button
reads **Continue discussion** once that chapter thread has messages.

## Back across chapters

Back (left tap, swipe right, ArrowLeft) on a chapter's cover turns to the previous chapter of the
collection at its last page, replacing the route like Keep reading does. The first chapter's cover
stays put. Guarded by `qa/browser_chapter_end.cjs`.

## Chat layout (0.4.0-private.11)

James, 19 Oct 2026: the sheet should feel like chatting with an AI, never a contact form.
The sheet sizes to its content until a conversation needs the room. The composer is one
pill: a globe toggle for web search (same `web_enabled` flag), an auto-growing one-line field
and a round send/stop button whose accessible name stays `Send`/`Stop`. Starter chips sit just
above it. Your messages are right-aligned bubbles; replies read as plain text without role
labels. There is no disclaimer line; the status line appears only for real state (opening,
replying, offline, earlier edition). Guarded by `qa/discussions-chat-preview.cjs`.
