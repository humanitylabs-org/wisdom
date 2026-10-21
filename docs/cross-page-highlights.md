# Cross-page highlight selection

During a long-press selection, drag into the reader's bottom-right corner and hold for **950 ms**. The reader turns to the next body column without releasing the pointer, preserving the character-range anchor. Move onto the new page's words to continue; lift to save one contiguous highlight. Keeping the pointer in the corner repeats the turn every 950 ms. Bottom-left works in reverse. Both precision handles support the same gesture.

- Corners occupy the outer `min(72px, 18% of stage width)` and bottom 88px of the reader stage, including its footer. Entering a corner selects through the current column edge; a turn extends to the first word of the next column (last word of the previous column).
- No turn happens on an ordinary tap, swipe or idle selection. A new corner dwell begins only during an active selection/handle drag. Leaving the corner, lifting, pointer cancellation/lost capture, navigation, resizing, tab hiding or window blur cancels the timer.
- Body pages only: no wrapping to the next chapter, end card, opener or epigraph. Epigraph offsets are stored after the body despite its earlier visual position, so crossing that boundary would not be a contiguous passage.
- Direct selection retains the existing contract: fewer than five words stay blue and unsaved; five or more save on release. A pending selection's handles stay pending regardless of the resulting range length. Explicit Highlight remains required for pending selections.
- Cancelled gestures do not save. Cancelling a saved/pending handle adjustment restores its pre-drag endpoints. Ordinary page navigation still clears the active selection as before.
- Column turns deliberately snap without transition while selecting, avoiding hit tests against moving CSS-column coordinates. Ordinary navigation retains its animation.

## Focused browser proof

Run on the browser QA worker, not the control-plane host. Use a scratch/evidence location on its work volume. Requirements: Node, Python 3, installed Playwright, Chrome, and the real shared `app-client.js` file.

```sh
PLAYWRIGHT_DIR=/path/to/node_modules/playwright \
WISDOM_QA_CORE=/path/to/real/app-client.js \
WISDOM_QA_EVIDENCE=/path/to/evidence \
TMPDIR=/path/to/work-volume/tmp \
node qa/browser_cross_page.cjs
```

The runner starts and stops its own loopback HTTP server with a fresh synthetic library and temporary SQLite storage. It uses CDP `Input.dispatchTouchEvent`, records trusted touch pointer events, asserts actual mutation counts, and reads saved highlights back from the server. It does not use `dispatchEvent` or contact an owner instance.

Coverage: dwell timing, contiguous next-page range and exact saved text, reload/progress restoration, four/five-word threshold, corner exit/lift/cancel, pending and saved handle drags, repeated turns, reverse selection, chapter bounds, normal tap/swipe, navigation/resize cancellation, browser Back, native-selection suppression. Core selection is repeated at 360, 390 and 1280px. JSON receipts contain asset hashes and measured timing samples; screenshots show held, saved and pending-handle states.

Companion regressions: `qa/browser_epigraph.cjs`, `qa/browser_epigraph_author.cjs`, `qa/browser_resume.cjs`, `qa/lookup-contract.cjs`. Browser emulation is not proof on a physical Android/iOS device or the hosted native shell; those remain activation checks. No VM image rebuild is needed for this JS-only behavior change.
