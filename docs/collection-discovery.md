# Collection-first discovery

Home is ordered: collection/read hero → Currently reading → Suggested → Browse and search.
An unstarted collection's hero opens its overview page and names the collection. Currently
reading uses the existing reading-list membership/order, capped at four, in the pick-card
format. Suggested retains its recommendation order, capped at six. Discovery links/counts
are derived from the enabled catalogue.

Search returns collections only. It matches folded/case-insensitive collection title, bio,
form and thinker names, scoped to the current Shared/My library page when applicable.
Queries are retained per route when returning from a collection; typing adds no history.
An empty query restores the normal grid. Shelf pages do not repeat scope-switch links.
Browse retains its controls and layout, but its library tiles, view tabs and results count
and show collections. Highlights remain individual saved passages.

## Chapter-state aggregation (no new persisted state)

- All: every enabled collection, including an empty collection.
- To read: at least one non-archived chapter, preserving the previous To read rule.
  Reading/finishing a chapter alone is not equivalent to explicitly archiving it.
- Starred: at least one starred chapter, including an archived starred chapter.
- Archived: at least one chapter and every chapter archived; mixed collections stay active.
- The collection overview is not a numbered chapter and does not affect these filters.
- Ordering follows the first chapter appearing in the existing view's order; remaining
  collections keep catalogue order. A chapter in several collections can qualify each.

Visible collection Back uses domain history, falling back to home on a cold launch. The
shared client remains the browser/host Back owner. The app consumes a same-route Back
from the shared guard on cold deep links as a domain step, while explicit export/manager
sheet dismissal consumes only its own history entry.

## Focused checks

On the designated browser/build host with Node, Python and Playwright installed:

```
python3 -m unittest discover -s qa -p 'test_*.py' -v
node qa/browser_home.cjs
node qa/browser_scope.cjs
node qa/browser_history.cjs
```

Browser scripts require `PLAYWRIGHT_DIR`, `WISDOM_QA_CORE` (an unmodified copy of the
actual shared app-client.js), and a separate `WISDOM_QA_EVIDENCE` directory for each run.
`WISDOM_QA_BROWSER` defaults to Chrome. Set `TMPDIR` on the designated data volume.
The fixture is disposable; it never uses the owner's library. Home tests cover 412px
and 360px widths. Model tests run through the standard unittest discovery runner.
