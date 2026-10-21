# Epigraph attribution metadata

An entry in `content/catalog.json` may include `"epigraph_author": "A. E. Waite"`.
This is optional plain-text attribution for the opening epigraph only, not the
chapter's thinker identity. The reader uses a nonblank string verbatim and
HTML-escapes it; absent, empty, whitespace-only or non-string values retain the
existing thinker-name fallback. Do not put Markdown/HTML in this field.

The existing document importer, revision pipeline and state projection already
preserve entry metadata, so this feature needs no engine/schema migration.
Revision approval is still bound to the exact new bundle digest. Adding this
field must not change chapter Markdown, thinker IDs/records, edition body hashes,
or personal reading state. Attribution is excluded from highlight text offsets.

Verification (synthetic data only, on the designated QA worker):

```sh
python3 -m unittest qa.test_pinned_revision.StateCase.test_epigraph_author_survives_import_revision_and_state -v
node qa/browser_epigraph_author.cjs
```

The browser environment is the same as `docs/highlight-history.md`. The browser
checks explicit attribution, legacy fallback, invalid-value fallback, escaping,
unchanged thinker labels, and identical quote/body text and body hash at phone
and desktop widths. `qa/browser_epigraph.cjs` covers existing selection actions.
