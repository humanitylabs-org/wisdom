# Opaque text overlays

Owner rule: a text-bearing floating panel is fully opaque. Scrims may still dim. Keep the existing tint and geometry.

Reuse:
- overlay panel material: REUSE `--wz-panel`

Extend the existing app overlay selectors with opaque backing only. No new component implementation.

## Serving source

- Source: `wisdom_wizardapps-wisdom-1:/app/static (image sha256:f22204d3a444eb46be4f39f23014ce67dec5091010121b1980227dd31feddaa1)`
- Base commit: `6d51d4b08ceb3969480971196e743fb952f96ddd`
- Evidence: Running Runtipi container labels identify source revision 6d51d4b; docker-copied static CSS all matches it byte-for-byte. The old ~/apps/wizard-wisdom is not live.

## Pixel regression

Browser: Chromium / Playwright on the build worker; synthetic CSS-only fixtures; all network requests aborted. No private API or user data.

Five skins (nebula/grove/tide/ember/signal), hosted (`html.wz-hosted` plus the production `data-wz-hosted` marker) and standalone, plus a token-free standalone fallback. Each panel interior must render identically over loud text versus nothing. Exact screenshot byte equality, no tolerance. `will-change: transform` retains the raster layer to stabilize gradient dithering; no panel fill or visible opacity is replaced by the fixture.

- Same final test against unmodified baseline CSS: **15 failing comparisons / 66** (expected failure).
- Patched CSS: **0 failing comparisons / 66**.
- Baseline leaking selectors: `{".sheet": 5, ".wb-hlpop": 5, ".wb-sheet-card": 5}`.

```sh
NODE_PATH=<playwright-modules> TOKENS_CSS=<shell-web/kit/wizard-tokens.css> \
  QA_RESULT=after.json node tests/opaque_overlays_browser.cjs
# Negative control: point SOURCE_ROOT at the original CSS tree.
SOURCE_ROOT=<baseline> NODE_PATH=<playwright-modules> \
  TOKENS_CSS=<shell-web/kit/wizard-tokens.css> QA_RESULT=before.json \
  node tests/opaque_overlays_browser.cjs
```

Raw receipts are retained on the build worker under `<receipt dir>/before.json` and `after.json`. Only CSS, this test, and this note changed.

## Deployment handoff — NOT performed

Rebuild the current Runtipi Wisdom image on the build worker with only static/wizard-appearance.css changed; update the image in the installed app's compose file and promote/recreate through Runtipi, preserving the existing data/library mounts. Static files are baked into /app/static, not bind-mounted.

Do not promote the entire branch over live code: the branch deliberately starts at the serving revision. Apply only the CSS delta to preserve later or owner-specific release work.
