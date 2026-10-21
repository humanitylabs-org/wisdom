# Collection authoring bridge

Read [PINNED-WORKFLOW.md](PINNED-WORKFLOW.md) before authoring or revising.
The app pins anthropic / claude-opus-5-5; the default orchestrator cannot author.
Owner-side utility: `tools/author_collection.py`. The image ships the portable
contract, prompt and helpers, but never executes a host CLI inside the reader.

## Inputs and scope

Use a completed source directory with `content/catalog.json`, UTF-8 Markdown
`content/<chapter-id>.md`, optional `content/glosses.json`, and optional JPEGs
under `static/wisdom-art/p/<thinker-id>.jpg` and `c/<chapter-id>.jpg`.

Select exactly one collection ID. Section order is authoritative; a redundant
`entries` list must agree with it. The overview must already be included in that
order. Only member chapters, their thinkers (and the collection's thinker),
matching chapter-body glosses and the corresponding existing JPEGs are read.
There is no recursive copy, full-library mode or schema conversion. Glosses are
selected by exact text occurrence, matching the reader. Foreign-script coverage,
quote verification and editorial quality remain the existing writer's tests.

Unknown metadata fields fail visibly; supported fields include the current
catalog's `kind`, `origin_id`, `body_sha256` and collection `art`. The reader still
derives its collection art from included chapter/thinker assets; custom art
aliases are not a new supported asset type. Missing optional art/gloss files are
allowed, but present symlinks, special files and malformed selected data fail.
Each file is limited to 2 MiB, expanded bundles to the importer's 24 MiB/1,500
files. Parent directories and source root cannot be symlinks. The source is read
only; concurrent edits are not a transactional authoring snapshot. Freeze the
completed writer checkout before export, then retain the immutable ZIP.

## Export

```sh
python3 tools/author_collection.py export \
  --source "$AUTHORING_SOURCE" --collection "$COLLECTION_ID" \
  --output "$BUNDLE_FILE" --license "$CONTENT_LICENSE" \
  --attribution "$CONTENT_ATTRIBUTION" --rights private
```

The default rights are **private**. License and attribution are required and
must cover text, translation, quotations and art; unknown rights are not
redistributable. `--rights unknown` is available; `redistributable` is an explicit
owner assertion, not an automatic legal assessment. Per-chapter provenance and
source links are preserved. Art credit JSON is not a supported archive member:
incorporate required art credits in the supplied attribution (or retain them in
the owner-side evidence); do not claim permission from an absent credit.

`--bundle-id` optionally supplies a distinct safe bundle ID, otherwise the
collection ID is used. ZIP members/order/timestamps/permissions are deterministic
for the same content and Python/zlib toolchain. A byte-identical existing output
is reused; different files are never overwritten. Export runs the **actual
unchanged `library.inspect_bundle`** before writing. It prints a JSON receipt
with SHA-256, selected chapter order and archive member list.

## Stage, review, explicitly enable

```sh
python3 tools/author_collection.py install \
  --bundle "$BUNDLE_FILE" --endpoint "$WISDOM_ENDPOINT"
# Owner review/approval is a separate gate:
python3 tools/author_collection.py install \
  --bundle "$BUNDLE_FILE" --endpoint "$WISDOM_ENDPOINT" \
  --transport mcp --enable
```

The endpoint is an explicit configured app base URL; optional path prefixes are
preserved. HTTP(S) only, no URL credentials/query/fragment, no redirected uploads.
There is no built-in credential store or auth bypass. Use the app's configured,
reachable local API/MCP route. Missing network/auth permissions fail honestly.
Default transport is API; MCP uses `wisdom_import`, `wisdom_library`,
`wisdom_bundle`, `wisdom_state`. Default action only stages. Explicit `--enable`
is the only activation flag. The installer reads back exact bundle ID+SHA/status
from the library and, if enabled, reads chapter bodies/order from the reader.

Retain and retry the **same ZIP**, not a new export after writer edits. If upload
or activation times out, an explicit retry of that immutable file is safe under
the importer. Disabled/removed bundles stay so unless explicitly enabled. No
failures delete content, progress, highlights, registry entries or directories.

## Shared thinkers and explicit revisions

New bundle/chapter/collection IDs must remain unused by all imported bundles,
including disabled/removed ones. An existing thinker ID is supported when all
metadata has identical canonical JSON bytes and supplied portrait bytes agree.
Portrait absence inherits the retained portrait rather than deleting it. See
[SHARED-THINKERS.md](SHARED-THINKERS.md) for the precise contract and copied-owner
container proof. Use original catalog metadata, not reader-computed fields.

Do not rename an existing person, copy the full private library, replace the
migration bundle or discard reading state. Ordinary import still rejects changed
bytes under an existing bundle ID. Use the digest-bound revision preview/apply
workflow in [PINNED-WORKFLOW.md](PINNED-WORKFLOW.md). Appending/removing chapters
and cross-collection migrations remain unsupported.

## Verification and staged integration

`qa/test_author_collection.py` covers selection, order, rights, deterministic
retry, source confinement, metadata and actual importer collisions. Run along
with `qa.test_portable` on the designated remote worker. The disposable
`qa/prove_authoring_container.py` exercises the CLI against the actual running
container API/MCP before and after restart, with a synthetic private-import
baseline plus a distinct newly authored collection. The worker runner also
checks runtime-source hashes; no real agent jobs are submitted.

`OPERATOR-SKILL.md` and `CRON-HANDOFF.md` are **staged instruction artifacts**, not
installed skills or scheduler changes. Parent integration/activation and full
batch migration remain separate gates.
