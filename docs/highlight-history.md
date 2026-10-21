# Earlier-edition highlight safety

`wisdom.init()` creates the private `wisdom_highlight_history` table without changing
existing highlights. Its columns match the offline migration contract:

```sql
CREATE TABLE IF NOT EXISTS wisdom_highlight_history (
 seq INTEGER PRIMARY KEY,
 entry_id TEXT NOT NULL,
 original_start INTEGER NOT NULL,
 original_end INTEGER NOT NULL,
 original_text TEXT NOT NULL,
 source_body TEXT NOT NULL,
 source_body_sha256 TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'unresolved'
   CHECK(status IN ('unresolved','reanchored')),
 reason TEXT NOT NULL DEFAULT 'Earlier edition — anchor not verified in current text'
);
```

The explicit digest-bound collection revision API snapshots changed-chapter
highlights into this table; see `authoring/PINNED-WORKFLOW.md`. Historical
reconciliation/reanchoring remains an offline, owner-authorized operation. Engine
startup does not invent anchors, migrate bodies, or remove old quotes. A history
row means its original offsets must not be assumed valid in the current edition.
Only explicitly verified `reanchored` rows are usable as current anchors; rows
without history preserve the existing current-highlight behavior.

The normal highlight API exposes `anchor_status` (`current`, `unresolved`, or
`reanchored`) and `reason`. It does **not** expose old source bodies, hashes or
original history fields. The original quote stays in the normal `text` field.
Highlights labels unresolved passages **Earlier edition**, retains Copy and an
explicit Remove action, and does not link a historical range into current words.
A chapter-level header link opens the current chapter, never an old offset.

Unresolved rows cannot paint, activate or be dragged in the current reader and
are excluded from both frontend (including optimistic state) and backend overlap
merging. Explicit highlight removal deletes its matching private history row in
the same transaction. Merge, restart and collection disable/remove do not delete
history. No history table content is included in collection exports.

## Reader edition binding

`wisdom_state` / GET `/api/wisdom` derives `body_sha256` from actual UTF-8 body
bytes, overriding imported metadata. New highlight adds must include this digest
from the **displayed** reader, alongside action/entry_id/start/end/text. A late
request from A after A→B fails without mutation; B→C cannot misattribute it to B.
Missing-digest legacy clients always fail closed (even before a revision); reopen
with the updated reader. Unchanged chapter bodies retain their digest and remain
valid across revisions to other chapters. Selected prose must also occur in the
body after rendering-only Markdown/whitespace normalization. Offsets remain
rendered positions, not raw Markdown indices; this is not automatic reanchoring.

Validation, overlap merge and commit use the same mutation lock as revision apply.
On failure the updated UI restores saved highlights and retains the pending
selection and Copy action, explaining that the chapter must be reopened. Existing
quotes/history/reasons/reactions are not rewritten or deleted by rejection.

Edition publication fsyncs the ZIP, temporary directory, renamed edition and
destination ancestry before SQLite can commit its pointer; failure leaves the old
pointer and personal state intact. Prior immutable editions are not collected.

## Opening quotation anchors

The full-screen epigraph is selectable with the same long-press, handles, Copy,
Highlight and Remove actions as body prose. Its UTF-16 text-node offsets are
appended after the body flow in the highlight index, even though its slide comes
first visually. This keeps all pre-existing body offsets stable without a data
migration. Attribution and section labels are excluded; line breaks between quote
lines retain whitespace. Edition binding and earlier-edition exclusion apply to
both regions unchanged.

Run `node qa/browser_epigraph.cjs` with the browser environment below. It uses a
synthetic multi-line, formatted opening quote and verifies touch selection,
explicit save, drag auto-save, Copy, Remove, reload, resize, gloss/Back, and
preservation of an existing body anchor at phone and desktop widths.

## Focused regression

On the designated QA worker, from an already-pushed commit:

```sh
python3 -m unittest qa.test_release_gates -v
node qa/browser_history.cjs
```

Browser requirements are `PLAYWRIGHT_DIR` (installed Playwright module),
`WISDOM_QA_CORE` (unmodified shared `app-client.js`), `WISDOM_QA_EVIDENCE`
(disposable evidence directory), and optionally `WISDOM_QA_BROWSER` (defaults to
installed Chrome) and `PYTHON`. Set `TMPDIR` to the worker's approved scratch disk.
The browser uses a disposable synthetic library, real HTTP API and real shared
WizardApp core, and writes screenshots, assertions and a synthetic DB receipt.
No production migration, deployment or historical personal content is part of
this regression.

The same Python module exercises the staged-private-portrait export gate through
actual preview and digest-confirmed HTTP ZIP download, alongside enabled,
disabled and removed source compatibility. Exports resolve inherited portraits
through the reader's ownership map, so never-enabled staged assets are ineligible.
