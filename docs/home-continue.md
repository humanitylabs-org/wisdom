# Home: Continue reading

Home answers "where was I?" before anything else (James, 18 Oct 2026).

1. **Continue reading** (top). The collection opened most recently, at the chapter last open, resuming on the exact page this device last showed. A chapter counts as open from its last page turn or opening (`opened_at`, the `wisdom_positions.updated_at` the server already keeps) or its completion (`read_at`). Finishing a chapter (reaching its end page) moves the card to that collection's next chapter. A chapter marked read earlier but reopened and left mid-way stays the target, so an old "mark read" no longer pushes you past a chapter you are still in.
2. **Currently reading**: every other started collection, most recently opened first, each linking to its own resume chapter.
3. **Suggested**: collections not opened yet, newest first. Home shows six; **View all** (right of the heading) opens `#/suggested`, the full list newest first. Back returns Home.

When nothing has been started, the newest fresh collection fills the top slot as before.

## Finished on the rating screen (0.4.0-private.14)

Reaching a chapter's end page, the thumbs up/down screen, finishes it (James, 19 Oct 2026). The `done` write also records 100% in `wisdom_positions`, so its reply already shows the chapter complete, and Home treats a chapter as finished when either the synced progress is 100 or this device's saved page is the end page. Before this, the `done` reply could carry a snapshot taken before the final page write landed, and Home offered "Resume · 1 min left" on the chapter just finished. `qa/home_model.cjs` and `qa/test_done_progress.py` cover both halves.

## Layout

The Continue reading card uses the original Home hero layout unchanged (height, title size, description line, pill). Only its content points at the chapter to resume. `qa/hero-compare.cjs` measures it against the private.7 hero in the live shell.

## Launch behaviour

Opening Wisdom without a deep link lands on Home; Continue reading is one tap from the exact page. A reload or shell frame recreation within a minute of leaving resumes the open book or collection directly. The checkpoint lives in `sessionStorage` (`wisdom:/:open`, `{hash, at}`); the older `localStorage` checkpoint is cleared on load.

## Exact page restore

The reader lays out before web fonts load and again after. Relayouts now carry the exact restored fraction until the reader turns a page, so the second layout no longer rounds a saved page forward by one.

## Highlight popup order

Note, Copy, Look up, Ask AI, Remove highlight (a new selection shows Highlight first).

QA: `qa/home_model.cjs`, `qa/browser_continue.cjs`, `qa/browser_resume.cjs`, `qa/browser_notes.cjs` (popup order), `qa/reading-progress.spec.cjs` (real Wizard shell, read-only).
