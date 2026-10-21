# Pinned authoring and safe revision (workflow v1)

## Optional glossary stage

The installed contract exposes `glossary` with its own prompt, version and digest.
`tools/author_chapter.py --glossary --chapter COLLECTION_ID` uses that prompt with
the SAME pinned model/provider, strict modelUsage verification and immutable raw
CLI evidence. Supply the usual brief/source/output/receipt flags; include unchanged
chapter bodies in the brief. Output is the app glossary map, never chapter prose.
Every key must occur in the supplied brief and each explanation carries a supplied
source URL. Review meanings, language, approximate pronunciation and term coverage
before copying output to `content/glosses.json` and exporting the collection.
For glossary-only revisions, require all Markdown bodies to remain byte-identical.
Existing source/rights, exact-preview confirmation and state-preservation rules apply.


## Authority and recovered contract

Read `authoring/workflow.json` and `authoring/prompt.md`, or call
`wisdom_authoring_contract` via the installed app MCP. This is the authoritative
portable contract, not an optional host skill. `wizard.md recommends.model`
retains the platform compatibility spelling; the selected model is binding.
Every installation, including the creator's, uses **anthropic / claude-opus-5-5**.
The existing approved Claude CLI route reports provider **firstParty**. No default
orchestrator prose, aliases, cheaper models, fallback models or model-written
claims of permission count. An alternate route requires asking the installation's
owner and an explicit owner-specific override; this release implements no override
interface, so such a change stays blocked pending a reviewed integration.

This restores the existing approved study format, not a new tiered pipeline:
450–900 words; source epigraph; own compression; at least three bold-led movements;
Why today; Carry this question; numbered Sources. Aim for 10–12 chapters plus
overview. The source was the pre-existing Wisdom chapter-authoring contract and
the archived 12 October collection-release receipts: actual author modelUsage
identified `claude-opus-5-5` / `firstParty`. The original temporary BRIEF file was
not present at recovery; no claim is made to have recovered its verbatim bytes.
Older receipts also contain helper-model usage; the new bounded one-chapter
runner disables tools and rejects mixed modelUsage instead of silently
normalizing those helpers into the author pin. Other established forms need
separately versioned prompts/checks; do not silently bend compression v1.

## Why the pin was bypassed

Installed base `60bd0c71f5606821f642f54020603eaf8972d18c` shipped a document exporter,
not an authoring-model contract. Its typed request said **if available** follow a
host editorial skill; neither session nor run creation selected a model/provider.
The manifest had no recommends declaration. Thus normal host defaults and a
human-memory instruction could replace the intended author while still making a
valid ZIP. Format validation is not author provenance. The host integration also
needs actual app skill/MCP discovery: a copied pointer file alone does not register
a skill, and its path must match `skill/SKILL.md`. This package cannot repair a host
that has not registered its app tools; it surfaces that dependency rather than
inventing a native agent API.

## Ordinary app route

`wisdom_request` / the existing typed UI save the request before admission. Live
admission is opt-in (`WISDOM_ADMIT=live`, configured `WISDOM_WIZARD_ORIGIN`). Session
and `/wizard/hermes/v1/runs` payloads explicitly contain `provider`, `model` and
`require_model_lock:true`; the complete packaged prompt is included in input,
because Service overwrites arbitrary client `instructions`. The returned runtime
must match both fields and acknowledge the lock. Admission is **not completion**.
`wisdom_request_route {seq}` reads `/wizard/hermes/v1/runs/<id>` and checks actual
runtime; a completed run needs `model_lock:confirmed`. An accepted lock is reported
as unconfirmed, never as effective authorship. Missing/wrong route fails clearly.
Admission evidence is persisted before dispatch; ambiguous attempts cannot launch
again automatically. An operator must reconcile the exact stored session/run via
Service; no invented resume/reconciliation endpoint exists in Wisdom v1.

Read-only API source inspection used Service `locked-run-bridge.mjs` and
`service.mjs` at `76367561f827e96f0c6d2d68015c326e7116e662`. These support explicit
run/session fields, accepted/confirmed runtime locks, status reads and stop.
Not every installation has that Service revision. Older/queued responses lacking
route evidence are unsupported, **not silently trusted**. Agent Service must be
verified to enforce `require_model_lock` before enabling live admission. A response
check alone cannot undo a host that already ignored it. No Service or Hermes
patch is included here. Native blueprint execution, automatic fulfilment,
owner override approval storage, and remotely executing a host CLI are **not**
new app endpoints. No QA request launches an agent or paid call.

## Portable installed toolkit

WAM installs only `skill/SKILL.md`. Follow its self-contained bootstrap: call
`wisdom_authoring_contract {}` (HTTP GET `/api/authoring/contract`) to read the
full documentation plus exact release toolkit identity, then
`wisdom_authoring_toolkit {contract_sha256,toolkit_sha256}` (HTTP POST
`/api/authoring/toolkit`). Verify ZIP SHA, member hashes and workflow/prompt
bindings before extracting into a new private directory. An update between
discovery/download fails stale. No checkout or host code path is assumed.
The bounded deterministic ZIP contains both helpers, all local dependencies,
the workflow/prompt, all three authoring guides and license. Python 3.10+
standard library suffices; live authorship additionally needs the configured
Claude CLI. These are installed **app-trusted executable release bytes**, never
collection documents. Imported ZIPs cannot replace toolkit members or instructions.
The digest binds a release, not provider attestation; trust starts at the owner's
configured app endpoint. No remote fetch URL or arbitrary filesystem path is accepted.

## Owner-side pinned author helper

This is a shipped execution helper for the already-approved owner-side document
workflow, not a substitute for app API/MCP operations. It requires an installed,
authenticated Claude CLI with the documented flags, and the exact model available.
Do not install credentials or a CLI in the reader container. Keep all briefs,
source packets, raw results and prose in a private owner workspace outside code.

Research and verify the sources first. Each source packet is a JSON array with
`url` and verbatim `text` (optional bibliographic metadata). Supply primary texts
and serious opposing scholarship, not only search snippets. The per-chapter brief
contains the audience, argumentative turn, concrete experience, relevant locators,
and stable chapter ID. For a rewrite, preserve the original catalog/art/thinkers.

```sh
python3 tools/author_chapter.py --chapter "$CHAPTER_ID" \
  --brief "$PRIVATE_WORK/chapter-brief.txt" \
  --sources "$PRIVATE_WORK/sources.json" \
  --output "$PRIVATE_WORK/new-chapter.md" \
  --receipt "$PRIVATE_WORK/new-chapter.receipt.json"
```

The helper calls `claude -p --model claude-opus-5-5 --output-format json` with the
packaged system prompt, JSON schema, no tools/MCP/slash commands, isolated cwd,
no session persistence, no fallback and a five-dollar/600-second per-call bound.
It rejects custom API proxies, non-firstParty routes, wrong/mixed/missing actual
modelUsage, wrong chapter ID, wrong format, unsupplied source URLs and quotations
not found verbatim (whitespace-normalized) in supplied texts. Unsupported CLI
flags fail rather than relaxing controls. Provider inference is dispatched from
the configured authenticated owner-side host; it is remote inference, not a local
model build. Keep local rendering, builds and sustained test/compute workloads on
the configured execution worker/durable queue, never inside the reader container.

The helper owns same-model recovery. When a draft fails a mechanical check
(schema, format, sources or quotations), it asks the same pinned route again
with the system prompt unchanged, adding only a `revision_request` with the
previous draft and the failed check. At most three drafts are requested per
run, inside one shared five-dollar budget (each call's `--max-budget-usd` is
what remains). A wrong, mixed or missing route is never retried. Only an
accepted draft writes `<output>`, `<receipt>`, `<receipt>.cli.json` and the exact
source packet as `<receipt>.sources.json`; the
receipt records `attempt` and `rejected_attempts`, and `input_sha256` binds
the exact accepted request including any revision request.

Rejected drafts are written to `rejected/` beside the receipt as
`<chapter>.attempt-N.*.rejected.json`, each wrapped with `status: REJECTED`, the
failed check and the raw CLI JSON as a string. They are owner evidence, never an
edition. After three rejections the helper exits **3** with a `NO EDITION`
message and writes nothing at the output or receipt path; other failures exit
2. The orchestrator then either re-runs the helper with a new output/receipt
pair or stops and reports the message. It must never write chapter Markdown or
a receipt itself (the acceptance in wizard-os `docs/evidence/wisdom-63-t_a350c932.md`
found a cheaper orchestrator doing exactly that from the raw CLI JSON).
Do not loosen checks or hand-edit the model's prose to make it pass.
Receipts bind workflow/prompt, input/brief/sources, raw CLI result and output
SHA256s, plus actual modelUsage and mechanical checks. These are **local provenance
evidence, not a cryptographic signature or provider attestation**. A compromised CLI/host can forge them;
a real model can still misread a real source. Review every citation/quotation,
translation rights, factual claim, strongest opposing case and reader experience.
Mechanical checks do not establish source truth or literary quality. Do not
hand-edit prose after receipt validation; reauthor that chapter with the pinned
model and produce a new receipt. Metadata/art handling is not prose authorship.

## Result admission (receipts, raw output and source text travel with the ZIP)

Export with `--receipts "$PRIVATE_WORK/receipts"`, a directory holding what this
helper wrote for each chapter: `<chapter_id>.receipt.json`, the raw CLI result
`<chapter_id>.receipt.json.cli.json` and the exact source packet
`<chapter_id>.receipt.json.sources.json`. The exporter places them in the ZIP as:

- `authoring/receipts.json` (`{"version":1,"receipts":{chapter_id: receipt}}`);
- `authoring/output/<chapter_id>.json`: the raw author output, byte-identical to
  the receipt's `cli_result_sha256`;
- `authoring/sources/<sources_sha256>.json`: the source packet, named by its
  digest and carried once when chapters share it.

It refuses to export a receipt whose raw output or source packet is missing (it
never drops evidence silently) and runs the app's own admission check before
writing anything.

**Shared collections carry their source text.** Source packets hold the verbatim
texts the author quoted, which may belong to other rights holders. Anyone who
receives the ZIP can read them. The in-app export preview says so and lists the
packet count and bytes before download. Size limits are unchanged: each member at
most 2 MiB (the helper's own input limit), the whole bundle at most 24 MiB.

On `wisdom_import`/`/api/library/stage` and on revision preview/apply, Wisdom
checks every receipt against the **installed** contract: workflow id/version/digest,
prompt digest, requested `anthropic`/`claude-opus-5-5`, strict observed
`modelUsage` (only firstParty `claude-opus-5-5`, nothing mixed), well-formed
digests, that the chapter bytes equal the receipted output (exact, or the
whitespace-normalised token digest) and the runner's shape checks
(`authoring_contract.validate_structure`). Where the chapter's evidence is
carried it then rechecks:

1. the raw output bytes against `cli_result_sha256`;
2. the observed model inside the raw output (same strict check) and that it equals
   the receipt's `modelUsage`;
3. the chapter body inside the raw output against `output_sha256` and against
   the chapter in the ZIP;
4. the source packet named by `sources_sha256` (name equals content digest);
5. the full `validate_chapter` against that packet: every cited URL supplied and
   every quotation verbatim in the source text.

Any failure refuses the whole ZIP with an explicit message and nothing is
staged. Evidence that no receipt refers to is refused too. Recovery is to
re-author that chapter with the pinned workflow; there is no override interface.

The result is stored with that edition and returned as `authoring` by
`wisdom_library` and the revision preview:

- `checked`: every chapter's receipt, raw output and quotations were rechecked
  against the carried source text (provenance includes requested and observed
  model, workflow/prompt digests, receipts digest, `source_packets`,
  `override: null`).
- `partial`: only some chapters were checked; `chapters_unverified` lists the rest.
- `unverified`: no receipts, or receipts without raw output and source text
  (exports made before this change). Receipts are still checked and a bad one
  still refuses the ZIP, but quotations cannot be rechecked, so authorship stays
  unknown. These import, but Wisdom never presents them as written by its helper.
- `pinned` (legacy): stored by earlier builds when receipts matched at import,
  before source text travelled. Shown as "quotations not rechecked"; re-export
  from the authoring workspace and revise to upgrade such an edition.

Collection export carries the receipts, raw output and source packets of the
exported chapters, so a receiving installation rechecks rather than trusts them.

### What "checked" does and does not prove

The #63 clean-install acceptance (wizard-os `docs/evidence/wisdom-63-t_bf8aff5d.md`,
section 4) admitted two forgeries as `pinned`: Opus's own draft that had failed a
quotation check, and an accepted chapter with one added sentence, each carrying a
copied real receipt with recomputed output digests. Both are now refused: the
body no longer matches the raw output the receipt names, and a forger who also
rebuilds the raw output is caught by the quotation recheck against the source
text (`qa/test_receipt_evidence.py`).

"Checked" is a consistency check over evidence carried in the ZIP. It is **not a
cryptographic signature** and not provider attestation. Someone who fabricates a
raw CLI result, a source packet and a receipt that all agree, including source
text containing their own quotations, still passes; nothing in the ZIP can be
verified against Anthropic. Treat the label as "this text is what the pinned
helper's recorded output says, and its quotations appear in the source text it
shipped with", and still review citations, rights and claims.

## Revision, through the same app API/MCP

1. Read `wisdom_library` and `wisdom_state`; record the original bundle SHA,
   bundle/collection/chapter IDs and original private immutable ZIP. Revision v1
   accepts exactly one collection in its existing bundle, the same chapter set,
   overview and membership. It is not append/delete/merge/rename.
2. Author and review replacement chapters using the pinned workflow. Export with
   the existing utility, preserving the bundle ID as well as the collection ID:

```sh
python3 tools/author_collection.py export --source "$AUTHORING_SOURCE" \
  --collection "$COLLECTION_ID" --bundle-id "$BUNDLE_ID" \
  --output "$NEW_ZIP" --license "$CONTENT_LICENSE" \
  --attribution "$CONTENT_ATTRIBUTION" --rights private \
  --receipts "$PRIVATE_WORK/receipts"
python3 tools/author_collection.py revision-preview --bundle "$NEW_ZIP" \
  --collection "$COLLECTION_ID" --old-sha256 "$OLD_SHA256" \
  --endpoint "$WISDOM_ENDPOINT" --transport mcp --output "$PREVIEW_JSON"
# Only after reviewing these exact old/new bytes and explicit authorization:
python3 tools/author_collection.py revision-apply --preview "$PREVIEW_JSON" \
  --endpoint "$WISDOM_ENDPOINT" --transport mcp --confirm
```

The CLI is merely transport to `wisdom_revision_preview` and
`wisdom_revision_apply`. Agents normally call those MCP tools directly. Preview
accepts `{id,collection_id,old_sha256,new_sha256,zip_base64}`; apply accepts those
four ids/digests plus returned `token` and `confirm:true`, no ZIP. HTTP equivalents
are POST `/api/library/revision/preview` and `/api/library/revision/apply`.
The token is a digest binding, not an authentication/owner-consent attestation;
these interfaces inherit the existing installation's trusted host/origin boundary.
Neither a ZIP nor its prose can authorize apply.

Preview allows at most 20 unapplied candidates per bundle (no cleanup API yet),
leaves the reader untouched and retains the candidate at a content-addressed
edition path. Apply revalidates bytes and current digest, then atomically changes
one SQLite registry pointer and snapshots changed-chapter highlights. Immutable
original ZIP and every prior revision survive. Reactions, positions, timestamps,
preferences and existing highlight text/IDs remain. Changed-body anchors become
`unresolved` through `wisdom_highlight_history`; they appear as earlier-edition
quotes instead of being painted onto unrelated new prose. Earlier source bodies
stay private, and already-historical original anchors are never overwritten.

Exact apply retry is idempotent only while that new edition remains current;
a competing revision makes old previews/retries fail stale. Wrong IDs, archive
traversal/symlinks/code, chapter additions/deletions, thinker/portrait changes and
cross-bundle collisions fail. Shared glossary changes also fail. A local revision
is My library/private, never inherits trusted distribution approval for new bytes.
Enable/disable/removed status is preserved; apply never re-enables a removed bundle.
There is no edition garbage collection or automatic rollback. To restore earlier
text, create a **new preview from the current digest to the retained old ZIP** and
explicitly apply it; historical highlights still remain conservative/unresolved.
Never raw-edit a running volume. A pre-revision engine does not understand edition
pointers, so code-only downgrade after apply is unsafe: restore the full pre-change
SQLite+library backup together, or keep the revision-capable engine.

## Gates before deployment

From an exact clean pushed worker checkout, with its approved scratch directory:

```sh
python3 qa/prove_pinned_revision.py --evidence "$PRIVATE_EVIDENCE_DIR"
```

The resulting `focused-proof.json` names host, interpreter, command, commit/tree,
source-file hashes, test count, exit code and log digest. Focused tests use
synthetic disposable state, standard unittest discovery and
mocked model transports; they do not prove live provider availability. Require
worker-host/exact-source evidence, independent state-safety review, an installed
candidate API/MCP rehearsal, the real pinned author receipt, and final reader
checks (including old highlighted text) before declaring the owner's rewrite done.
No native/Mac rebuild is needed for this reader-only change. Engine rollout and
owner content apply are separate gates; this branch supplies neither authorization
nor a deployment. A package build must include the shipped contract and prompt.
