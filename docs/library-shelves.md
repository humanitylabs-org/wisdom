# Library shelves and explicit collection downloads

Home remains content-first. The existing card style links directly to
`#/shelf/shared` (Shared library) and `#/shelf/private` (My library), also reachable
from Browse and Manage collections. Reading lists still span both shelves.
Scope is **provenance, not access control or licensing**. Both shelves belong to
this private installation. “Shared” means approved private-testing distribution;
it never implies public publication, a public repository, or rights clearance.

## Trust and persistence

- File, HTTP and MCP imports default to **private**, even if uploaded JSON says
  `library_scope: shared`, or declares `rights: redistributable`.
- The operator-controlled `WISDOM_COLLECTION_SOURCE` manifest approves its
  digest-verified bundles as shared. Point it only at approved source content.
- A fresh starter imports only the existing four approved bundles and stamps
  their collections `starter:private-testing-20261015`. No starter bytes changed.
- Old databases gain the `wisdom_collection_scopes` table without classifying any
  old content as shared. Completed/skipped-existing starters do not reseed or
  retrospectively approve content. Pending seed imports resume idempotently.
- Scope rows bind collection ID, bundle ID and original archive SHA256. Absent or
  mismatched approval means private. Explicit private overrides survive source
  re-imports, starter retries and enable/disable/remove cycles.
- `/data` and `/media/Wisdom` remain separate persistent mounts. Image updates
  neither copy personal content into source nor reset reading state or documents.

`/api/wisdom` and `wisdom_state` return each enabled collection's `library_scope`,
`library_provenance` and `bundle_id`. Entry scope is shared only when it belongs
exclusively to approved shared collections. Thinkers can span both shelves.
Reading state is never a source for export.

## Trusted offline migration API (not HTTP/MCP)

Stop the target app and configure `WISDOM_DATA` and `WISDOM_LIBRARY` to the
**offline destination**, not a running installation. Initialize the schema with
`library.init(c)` on a SQLite connection using `sqlite3.Row`. After importing and
validating exact archives, the operator can call:

```python
library.set_collection_scope(
    c, bundle_id, collection_id,
    expected_sha256=verified_archive_digest,
    scope='shared',
    provenance='operator-reviewed-approved-starter-match',
)
```

The operator must independently compare the selected collection's full document
metadata, source bodies, artwork and relevant glosses against approved material.
A digest here protects the selected destination archive from accidental drift;
it does **not** itself prove distribution permission. This Python API is trusted
operator authority. No remote API, uploaded manifest field or rights declaration
can invoke it. It changes only a scope row, never IDs, archive bytes or reading
state. It commits the change; read back with `library.collection_scope(c, bundle,
collection_id)` and the state API after restart.

For an extended private edition, explicitly use `scope='private'` and a suitable
provenance, e.g. `operator-private-extended-edition`. In the approved owner merge,
Around Every Circle's extended original (including `circle-nagarjuna`) stays
wholly in **My library**, retaining original IDs and reading references. The
nine-chapter approved starter does not authorize its additional chapter. An
operator may separately approve the three exact approved matching collections.
Do not stage a colliding starter over an extended edition or broaden approval.

## Preview → confirm → download

Open a collection, choose **Export this collection…**, review its title, ordered
texts, declared rights/licence/attribution and exact file/digest inventory, then
**Confirm download only**. Back or Close cancels without a download. No upload,
public link, remote publication, or scope change occurs.

API:
1. `POST /api/library/export/preview` with `{"id":"collection-id"}`.
2. After explicit approval, `POST /api/library/export` with
   `{"id":"collection-id","sha256":"<preview sha256>","confirm":true}`.
   Response: `application/zip`, attachment filename, `X-Content-SHA256`.

MCP equivalents: `wisdom_export_preview`, then `wisdom_export` with the same
arguments (returns `zip_base64`). An agent must show the preview and obtain an
explicit collection-specific export choice first. Never auto-export a whole
library or treat a request to read as permission to share.

The deterministic version-1 ZIP contains exactly one collection, its ordered
chapter bodies (byte-exact), document metadata, selected chapter artwork,
required thinker metadata/portraits, and glosses used in those texts. A required
portrait may come from a retained disabled bundle only with identical thinker
metadata. Unknown/runtime metadata, initial reading flags, unrelated glossary
entries, other collections, highlights, reading positions, preferences, requests
and databases are excluded. The immutable source archive is validated and digest
checked again; the exact output digest must match the preview. External deep-dive
references fail closed rather than silently adding unselected content. Enable a
collection before exporting it. The exported bundle gets no trusted scope stamp;
importing it elsewhere defaults to My library. Export never grants sharing rights.

## Optional collection requests

Browse and My library show the existing typed request workflow only when
`WISDOM_ADMIT=live` and `WISDOM_WIZARD_ORIGIN` are configured. No microphone or new
agent integration is introduced. Requests remain durably saved before admission;
failed admission reports saved/not sent with retry. Generated ZIPs go through the
same private staging API and need review/enable. The owning operator must verify
real Agent Service admission independently; QA must not submit live requests.

## Focused verification

Run on the designated development worker, never against personal mounts:

```
python3 -m unittest qa.test_portable qa.test_starter qa.test_library_scope qa.test_shared_thinkers qa.test_author_collection -v
node --check static/manage.js
node --check static/wisdom.js
```

Browser QA can be run with `WISDOM_QA_CORE` pointing to an unmodified real shared
`app-client.js`, `PLAYWRIGHT_DIR` to an installed Playwright module, and
`WISDOM_QA_EVIDENCE`/`TMPDIR` to worker storage, then `node qa/browser_scope.cjs`.
It starts and removes a disposable synthetic server, records the actual core
SHA256, screenshots and downloaded ZIP, and never accesses owner data.

Browser QA must load the real shared `/wizard-os-home/core/app-client.js`, not a
WizardApp stub. Verify home → either shelf → collection → reader → Back remains
inside the app; collection export preview → Back cancels; confirmation downloads
only selected files; at root a single Back remains in the app. Re-check private
import + reading state after restart. Live owner migration/deployment is separate
from source acceptance.
