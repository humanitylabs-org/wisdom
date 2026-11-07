# Collection planning is part of the installed authoring contract

The authoritative portable rules are [`authoring/collection-rules.md`](../../authoring/collection-rules.md),
versioned independently as `wisdom.collection-rules` v1. Both
`wisdom_authoring_contract` and `wisdom_authoring_toolkit` include the full rules
and their SHA256. The toolkit ZIP includes that file and the special-form prompts;
its checksum also binds every helper and dependency. There is no dependency on an
owner's local skills directory or a source checkout.

The rules cover planning the idea list and count, overview, book/thinker/theme,
`by`, named serious critics, debates and schools, esoteric readings, sourced
cross-tradition bridges, plain titles, independent cover teasers, primary-source
routes, portraits/crops/credits and tradition-sensitive art, samplers plus separate
deep dives, tradition compressions, technical learning paths, scripture study,
story-led symbolic compression, generic distribution and protected revisions.

## Compatibility and the author route

The existing thinker-study `authoring/prompt.md` and `authoring/workflow.json` bytes
are deliberately unchanged. Existing pinned receipts and starter bundles remain
valid; new collection rules have their own version and hash, rather than
retroactively claiming old authors saw new instructions. New helper requests
include those rules and new receipts carry `collection_rules_sha256`. Admission
rejects a supplied rules hash that does not match this release. An old receipt
without that optional field remains honestly an older chapter receipt.

The pinned route is unchanged: anthropic / claude-opus-5-5, firstParty, no
fallback. `tools/author_chapter.py --format` supports:

- `wisdom.compression.v1` (default, existing thinker-study prompt)
- `wisdom.scripture-study.v1` (450–900 total words)
- `wisdom.symbolic-story.v1` (250–450 total words)

The two new forms have their own v1 prompt identities in
`authoring/form-prompts.json`. Discovery returns their exact prompt text and hash.
Receipts must name the selected stage/prompt/format; runner and import admission
reject a returned shape different from the selected format. Source and raw CLI
modelUsage checks are retained for all forms. Selecting a short form is not a
way to weaken the default thinker's word minimum.

`validate_deck` rejects copied sentences longer than 30 normalized characters and
SequenceMatcher similarity >=0.5 to the compression payoff. New exports run it
before producing a ZIP. Import admission additionally runs it on chapters whose
receipts carry the new collection-rules hash. Legacy document imports do not
suddenly fail on cover copy they were already allowed to contain.

## What was extracted from the former owner supplement

These sections are now duplicated by the portable package (product rules, not
private identity):

- **Procedure**: primary-source-first, supported forms, pinned authorship and
  quotation/claim checks, registration concepts, portrait procedure, staged
  delivery/readback and retained provenance.
- **Owner edition vs generic edition**: outbound generic text and preservation of
  the reader's personal library, without private paths or a particular owner's
  project names. Runtime personalization is separately designed below.
- **Collection titles**; **Collection size and forms** (including sampler/deep
  dives, religious tradition and technical fields).
- **Philosophical debates and schools**, including disputed mystical readings and
  qualified cross-tradition parallels.
- **Scripture-study variant**.
- **Pitfalls**: independent deck/payoff, total word counts, exact epigraph author
  and source, copied thinker identities, source-truth vs quote verification,
  preserving unrelated bundle/glossary bytes.
- **primary-source-routes reference**: generic source routes, legal translations,
  exact locators, cleaning, anchor assertions and quote anchors.
- **technical-learning-paths reference**: destination-first dependency ordering,
  separate field/thinker/debate arcs, plain-language exposition, sources and art.
- From the reader/chapters supplement: **Story-led symbolic compression** and
  explicit requested counts overriding the default template.

Not extracted: private accepted chapter examples, a reader's philosophy or
projects, anecdote/voice tastes, private workspaces/build histories, local gateway
and deployment commands, named people's reading interests, local QA machine
paths, and operational source/release ownership. Such material remains an
optional reader-specific supplement, never an alternate authoring pipeline.
No owner skill is edited by this port.

## Personalization is a separate consequential slice

The existing runtime does not yet supply a section-only completion/admission
protocol or safe highlight translation between personal/generic bodies. Shipping
those together with this portable-rules change would broaden a read-only
contract/toolkit release into owner-state and agent-side-effect work. In
particular, `server.admit()` currently records an author run but does not consume
its output, and `collection_revision.apply()` preserves changed-body highlights
as earlier-edition quotes; it explicitly does **not** reanchor them. Treating either
as a finished personalization primitive would be unsafe.

The next slice has a complete implementation/acceptance design in
[PERSONALIZATION.md](PERSONALIZATION.md). This release does not claim to
personalize imported collections, expose a toggle, or automatically call a
reader's agent. It never rewrites an existing library.
