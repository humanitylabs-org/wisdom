# Contextual AI Look up

## Glossed drop caps (0.4.0-private.15)

A glossed term that opens a section (for example 道 in Laozi) is drawn as the drop cap. It behaves like any
other reader text: a long press selects it (and can drag on into the line to highlight a passage), a quick tap
still opens its translation, anchored to the glyph. A selected or highlighted drop cap is tinted with the
passage. `qa/browser_gloss_dropcap.cjs` covers 360, 412 and 1280 px.

## Copyable pop-ups (0.4.0-private.13)

Translation and Look up pop-ups allow native text selection and copying.
Long-press inside a pop-up to select its text; a tap does not dismiss it while
that text remains selected. Closing the pop-up clears its selection.

Regression: `qa/browser_copy_popups.cjs` covers translation and AI explanations
at 360/412 px, native context-menu admission, selection and clipboard copy.
First shipped in 0.4.0-private.15: the private.13/.14 builds failed the host
lookup contract (`selIn` sat outside the VM-tested gloss block).

Long-press a word or short phrase, then choose **Look up**. The compact popover is
labelled **AI explanation**. It explains the term in its passage rather than
showing dictionary senses. Tapping a pre-authored glossary annotation still opens
that annotation; the long-press action never uses it as a fallback.

## Route and boundary

`POST /api/lookup` accepts `text`, `entry_id`, `body_sha256`, and optional `context`
(a visible surrounding paragraph excerpt). The edition is the hash attached to
the displayed chapter, not a hash fetched after selection. Text is limited to
128 characters / 8 whitespace-delimited words. Context is at most 2,400
characters and must match the selected term's current server-side paragraph,
ignoring rendering-only Markdown and whitespace. Missing or ambiguous matches
fail closed. Only a server-sourced excerpt (up to 800 characters on each side of
the term) is passed to inference, not arbitrary caller context or the full book.

The endpoint reuses `discussions.broker_request` and the same first-party Claude
account, but calls the broker's separate `/lookup` route, which accepts exactly
`claude-haiku-4-5` (Ask AI's `/generate` route keeps exactly `claude-sonnet-5` at
medium effort; each route rejects the other's model and verifies `modelUsage`).
It uses the existing `WISDOM_DISCUSS_URL` and `WISDOM_DISCUSS_TOKEN` operator
configuration. No new credentials, provider, Hermes runtime, personal memory,
owner profile, web tools, or conversation history are used. There is no
dictionary or alternate-model fallback, and no discussion, highlight, progress,
or other owner-state write.

The broker's `/lookup` contract is narrower than discussions: web off, no source
links, one `chapter_excerpt` source (≤2,400 chars), one fixed user message. The
CLI runs with no tools, empty setting sources, empty MCP config, and extended
thinking disabled (`CLAUDE_CODE_DISABLE_THINKING=1`, `MAX_THINKING_TOKENS=0`).
To remove CLI start-up from the request path, the broker keeps one pre-started
lookup process waiting on stdin (`--input-format stream-json`) after the first
lookup. It serves exactly one request, is replaced every 10 minutes (the OAuth
token is fixed at spawn and is never parked near expiry), only matches the exact
same system prompt, and is dropped after 6 hours without a lookup.

The prompt asks for 1–2 plain English sentences, roughly 25–55 words, maximum
70 words, with no headings, lists, multiple senses, citations, or preamble.
The endpoint requires a nonempty bounded completion with the exact model
identity, rejects formatted/oversized outputs, and rechecks the edition after
inference. Semantic quality and sentence count still require human/live review;
these cannot be guaranteed by mechanical validation.

### Streaming

`POST /api/lookup/stream` takes the same body and streams NDJSON:
`{type:'delta',text}` lines as the model writes, then exactly one terminal line,
`{type:'done',text,model,entry_id,body_sha256}` or `{type:'error',status,error}`.
Input/stale errors before inference are a plain `400` JSON response. Deltas are
provisional display text only (bounded to 1,400 characters); the popover shows
them with a trailing ellipsis and replaces them with the validated final text.
The final text alone is cached. A mid-stream validation or model failure sends
one sanitized error line and is not cached. Closing the popover or a newer
selection aborts the browser fetch; the server notices the closed socket on the
next delta and cancels the broker run. `POST /api/lookup` (non-streaming) is kept
for compatibility.

Inference has three local nonwaiting slots, a 30-second broker socket timeout
and checked stream deadline, bounded lines/events/bytes, and best-effort cancel
on an incomplete stream. The browser allows 45 seconds for this route only;
other API calls retain their existing timeout. The broker also retains its own
30-second lookup process deadline. Errors contain no raw broker diagnostics.

- `200`: `{text, model, entry_id, body_sha256}`.
- `400`: invalid selection/context or stale edition, including a change during
  inference. Reopen the chapter and select again.
- `503`: disconnected/busy/failed model, interrupted stream, wrong model, or
  invalid completion. Select **Look up** again to retry; failures are not cached.

Existing same-origin/host guards and `no-store` responses apply. Requests use
JSON POST bodies rather than selected-text query strings. Successful responses
have a bounded, in-memory chapter/edition/text/context-keyed cache. Dismissal,
newer selection, navigation, and edition changes fence late UI replies. No
lookup history is persisted.

## Packaging and verification

The WordNet endpoint, runtime, compiler, database build stage and bundled
license/provenance files have been retired. No dictionary archive or runtime
network download is required by the image build. An old open frontend must be
reloaded; its retired `/api/dictionary` request returns 404, not a silent fallback.

Focused checks (synthetic fixtures, mocked broker; no paid inference):

```sh
python3 -m unittest qa.test_lookup qa.test_discussion_broker qa.test_glossary qa.test_discussions -v
```

Browser streaming check at 360/390/412 px (real server, fake streaming broker):

```sh
WISDOM_QA_CORE=<shared app-client.js> python3 -m qa.browser_lookup_fixture  # prints {url}
PLAYWRIGHT_DIR=<playwright> FIXTURE_URL=<url> EVIDENCE=<dir> node qa/browser_lookup.cjs
```

The normal `test_*.py` discovery includes these contracts. `test_lookup` also
runs the actual lookup frontend functions through `qa/lookup-contract.cjs` using
Node, covering Unicode, context-keyed cache, races, and retry. HTTP tests exercise
the real endpoint with mocked inference and no owner database initialization.
This is not real-model semantic or touch-browser acceptance. Before promotion,
verify the installed route on an English term and romanised Japanese/Sanskrit
terms using actual long press; inspect compactness and contextual meaning, then
confirm Ask AI, highlighting, reading progress and Back still behave normally.
No full image build or deployment is implied by focused unit results.
