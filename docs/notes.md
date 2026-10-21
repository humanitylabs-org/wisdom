# Notes on passages

A note is a typed comment attached to a passage. Select words (or tap a saved highlight), then tap **Note**.
The sheet shows the passage and a text field that is focused straight away.

- **Voice:** inside Wizard, the note field is an ordinary focused text field, so tapping the orb dictates into it
  through the shell's focused-field dictation. Wisdom ships no microphone and no transcription of its own.
- **Saving:** a note on a fresh selection saves the highlight and the note in one write. A note on a saved
  highlight updates only the note. Delete clears the note and keeps the highlight.
- **Merging:** when highlights merge (Kindle-style overlap), every note is kept, in passage order, separated by a blank line.
- **Removing:** Remove on a highlight that carries a note asks once more ("Remove highlight and note?").
- **Back:** system Back closes the sheet and stays on the chapter or Highlights page; an unsaved draft is kept
  for that passage until the app reloads, and holds app updates while unsaved.
- **Where notes show:** a solid underline marks a noted highlight in the chapter (dotted still means an Ask AI
  discussion). The Highlights page shows each note under its quote, with Note / Edit note.

## API

`POST /api/wisdom/highlight` (and MCP `wisdom_highlight`):

- `{action:"add", entry_id, start, end, text, body_sha256, note?}` adds a highlight with an optional note.
- `{action:"note", id, note}` sets a note; an empty string clears it. At most 8000 characters.

Highlights in `GET /api/wisdom` carry `note` (empty string when none). Existing databases gain the column on start-up.

## Proof

`qa/test_notes.py` (API, merge, validation, MCP, upgrade) and `qa/browser_notes.cjs` (360/390px touch flow,
shell focused-field dictation insert, Back, edit, delete, remove confirmation, reload). The browser test needs
`WISDOM_QA_FIELD` pointing at the shell's real `core/focused-field.js`, besides the usual
`PLAYWRIGHT_DIR`, `WISDOM_QA_CORE` and `WISDOM_QA_EVIDENCE`. Browser emulation is not proof of the orb on a
physical phone; that remains the activation check.
