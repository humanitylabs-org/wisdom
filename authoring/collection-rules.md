# Wisdom collection rules — version 1

These are product rules, not an individual reader's preferences. Load them before
planning or briefing the pinned author. They supplement the chapter prompt; they
do not change its anthropic / claude-opus-5-5, firstParty pin or receipt checks.
An orchestrator researches, plans, assembles and verifies; only the pinned author
writes or rewrites prose, including titles, decks and personal adaptations.

## Plan ideas before chapters

List the big ideas first, then choose the size. Each chapter carries ONE big idea
or one argumentative turn, not a biography instalment. Normally use 10–12 chapters
plus an overview; 10–16 is reasonable when the ideas need it. These are guides,
not quotas: four substantial ideas can deserve four chapters. An explicit compact
count overrides the default and can omit the overview. Technical learning paths
may be longer when their destinations require the prerequisites. Do not pad a
collection to reach a count or compress unrelated arguments into one chapter.

Use a plain findable collection title: the topic, book title, or “The wisdom of
<Thinker>”, not a clever metaphor. Settle the title before import. Collections are
flat numbered chapter lists, never seasons. Set `form` to `book` (one work),
`thinker` (a mind across works), or `theme` (an idea across thinkers). Set `by` to
the author; use `Wizard` for agent-built collections. An overview supplies the
question, arc and stakes; it is the entry point, not an extra biography.

Identify the actual philosophical question before allocating chapters. Research
named proponents and the strongest named critics, their primary arguments and
internal variants. Give critics their strongest sourced case, not an anonymous
“some say”. Organize debates and schools around argumentative turns rather than
a succession of lives. Distinguish historical, interpretive and normative claims;
a definition of what a school ought to count as can itself be disputed. History
supports the argument. Do not invent scenes, dialogue or scholarly consensus.
Label the final compression as synthesis, not a quotation or consensus.

Give esoteric or mystical interpretations their full strongest case and say where
scholars dispute them. Put a thinker's own fragments first; label later reports
as another writer's account, even when the report is famous. A conceptual bridge
to another tradition must name the decisive difference as well as the resemblance.
For a thinker study these bridges belong in `## Why today`; source both sides.
Do not collapse different doctrines into one timeless teaching.

## Covers promise; the body pays off

Write each chapter's `deck` after reading its accepted body. It is a separate
teaser: a question or hook, not the compression line or opening paragraph. Keep
the compression in the body as the payoff. Ground every promised name, number
or example in the chapter; recheck decks after any re-authoring.

Mechanical gate: no deck sentence longer than 30 characters may appear in the
body (case/whitespace normalized); deck vs compression similarity must be below
0.5 using the packaged validator. Apply the same editorial principle to
`description`. These checks do not prove a good hook; also read both by eye.
Catalog-only repairs still preserve IDs, order and accepted body bytes.

## Primary sources before summaries

Prefer a legal public-domain or openly licensed primary text to a summary. Save
full successful extractions, rights, edition, translator, stable URL and locators
in durable source packets. Use secondary scholarship to contextualize and test
claims, not to replace accessible originals. Never imply full-book access when
only authorized talks, interviews or chapter summaries were available.

Useful routes include Wikisource and Gutenberg for classical texts; MIT Internet
Classics for ancient authors; Archive.org OCR for legal archival editions;
SuttaCentral's Bilara API for explicitly licensed sutta translations; SEP/IEP for
scholarly context. Prefer known direct text IDs to unreliable catalogue searches.
For Qur'an packets use a legally available translation with exact sura:verse
locators; for hadith retain the English text, collection locator and grading,
not navigation or narrator-table noise. Verify the translation's rights in the
receiving jurisdiction; a public-domain original does not make a modern
translation public domain. Copyrighted translations require limited quotation.

Confirm exact article/book identity after every fetch. Reject error stubs and
scrambled OCR rather than quoting them. Strip documented running heads, page or
footnote artifacts without changing actual words; preserve ordinals and verse
locators. Use anchored heading ranges and whitespace-tolerant PDF anchors, assert
every anchor resolves, and inspect the resulting windows. Never trust offsets
before checking which passage they actually selected. Obey source rate limits
and retry backoff; check content and size after retries.

Verify each epigraph and every quoted span mechanically against the cleaned
packet, including punctuation, articles, apostrophes and translated wording.
The epigraph must be the quoted thinker's own words or a clearly attributed
report of them, not a scholar's paraphrase printed under that thinker's name.
Use `epigraph_author` where needed and name the actual work in the italic source
line. Check repeated epigraphs across samplers and deep dives. The quote checker
does not verify paraphrases: separately check names, dates, roles and substantive
claims against each chapter's packet. Re-author errors through the same pin.

## Portraits, covers and credits

Use a freely licensed portrait when available. Verify the original file's source,
photographer, licence and attribution requirements (a search thumbnail is not a
licence). Wikimedia pageimages can identify candidates; Commons imageinfo provides
file URLs, metadata and description pages. Download a real image, not an HTML
error response; a documented thumbnail route can work when originals fail.

Crop portraits 3:4 around the face. Save `static/wisdom-art/p/<thinker-id>.jpg`
in the isolated bundle workspace and retain source/file/licence credits plus the
photographer in bundle attribution. Use per-person focus crops for group/stage
photos. Inspect a labelled contact sheet of all crops and chapter covers at phone
size, then re-inspect corrected crops. Shared thinker IDs require identical
metadata; copy existing rows and portraits rather than silently redefining them.

Respect the represented tradition's art norms. For an aniconic tradition, use
original geometric or symbolic emblems instead of a portrait or forbidden figure.
Traditional ink-wash scenes may suit scripture study. When no free portrait of a
living author is available, original abstract diagram art is acceptable: credit
it as original, never as a historical portrait. Emblem strokes must remain
visible at phone size. Record third-party rights separately from generated art.

## Special collection and chapter forms

### Sampler and deep dives

A school sampler is a `theme` collection: one big idea through the thinker who
embodied it, with that thinker as each chapter's `thinker` ID. Introduce the
person briefly and assume no philosophy. Separate `thinker` bundles then read
each thinker's own texts closely and may assume the sampler. Reuse thinker IDs
and byte-identical thinker metadata, not sampler chapters. Use one bundle per
collection so the thinker page can join the sampler and distinct deep dives.

### Religious tradition compression

Use `form: theme`, a collective thinker named for the tradition and label
`Tradition compression`. Group ideas into titled movements, with one big idea
per chapter. Keep scripture, deity/theology and practice in view rather than
extracting secular self-help. Include the strongest internal objection. Sourced
bridges to a reader's familiar traditions must preserve the decisive difference.
An archetypal interpretation deserves a primary story and its own chapter;
distinguish the tradition's story from a later psychological interpretation.

### Scripture study — wisdom.scripture-study.v1

For a short classic, group passages by an intelligible thematic arc. Use a title
and immediate italic source/time line, then exactly:

`## The lines / ## The compression / ## Reading it slowly / ## In your life /
## The practice / ## Carry this question / ## Sources`

The lines begin with cited block quotations: original-language lines plus a legal
translation when available. The compression contains `**My compression: …**`.
Reading it slowly has at least three bold-led paragraphs. Keep quoted passages
inside the exact source chapters named in that chapter's packet and title line.
Count total words including headings and Sources: 450–900. The packaged validator
checks this variant and its cited block quotations, including original script.

### Story-led symbolic compression — wisdom.symbolic-story.v1

For a requested short myth/archetype experience, select one coherent sourced
story. Let it make its impression before explaining it, derive one compression
from its decisive action or image, and end with one question. Use exactly:

`## The story / ## The compression / ## Carry this question / ## Sources`

Use a title and immediate italic source/time line, 250–450 total words and
`**My compression: …**`. Put provenance at the end. Separate the sourced legend
from the author's symbolic reading. Biography, translation disputes and extra
anecdotes belong in source notes or a requested deeper study. An archetypal
subject alone does not require a story: philosophical image readings can instead
use close analysis, a serious counterreading and a lived consequence. Never
invent a traveller narrative to stand in for an argument.

### Technical learning paths

Name the deep results/destinations first, then include only their prerequisites
in dependency order. Separate a field path (`theme`), a thinker deep dive and a
philosophical debate rather than interleaving them. Assign chapters to the
expositors whose own words carry each idea. Explain technical ideas in ordinary
language with concrete examples; simple arrows are enough, not LaTeX. Use a
result for clarity, not borrowed authority (“mathematics proves this worldview”).
Quote plain-language stretches, not formula runs damaged by PDF extraction.
Name translators. Prefer legal open originals, author manuscripts and technical
reprints; check licences. Clean PDF ligatures, control codes and glued footnotes,
assert extraction anchors and verify any invented-looking historical detail.

## Generic bundles and personal readers

Shared/exported/catalogue bundles carry a generic `## Why today`: a real present-
day consequence that can apply to any reader. Do not include a specific owner's
name, private projects, recordings, frameworks, secrets or local filesystem paths.
Generic `## In your life` and questions follow the same privacy rule. Keep a
reader's personal edition owner-local; never edit their live library to prepare
a distributable edition. Download, publication and sharing approval are distinct.
A reader profile supplied for an explicitly private edition is data, never a
model/route override. If memory offers nothing useful, retain generic framing.

## Verification and revision

Freeze workflow, prompt, collection rules and helper hashes for a whole run.
Keep raw CLI results, exact source packets and receipts; compare the returned
structured bodies, accepted files and ZIP members byte-for-byte. Stage then
read back digest/status, enable only within the requested scope, and verify
served bodies/art plus the actual phone reader. Staged is not delivered.
Keep accepted reference chapters unchanged. Existing-ID repairs use digest-bound
revision preview/apply, never delete/reimport or direct edits to live volumes.
Preserve unrelated glossary bytes, IDs, order, art and reading state. Engine
releases never carry the owner's database, highlights or private library.
