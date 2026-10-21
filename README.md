# Wisdom — private testing edition

Version 0.4.0-private.24. Keep this repository and all release artifacts private.

AI routing: see [Connection Router deployment and evidence contract](docs/connection-router.md).

Candidate source: pinned authoring and safe existing-collection revision are
documented in [the app-owned workflow](docs/authoring/PINNED-WORKFLOW.md).
This version label does not imply an image was built or deployed.

Fresh installs contain exactly four existing owner-selected collections (45 texts):
- `steve-jobs` — The wisdom of Steve Jobs (10)
- `tao-te-ching` — The wisdom of the Tao Te Ching (13)
- `black-mirror` — The wisdom of Black Mirror (13)
- `around-every-circle` — Around Every Circle (9)

The last title is an exact match, not a guess. Its embedded `circle-nagarjuna` chapter
is deliberately omitted under the explicit Nāgārjuna exclusion. Datura and the
standalone Nāgārjuna collection are absent. Texts are existing generated summaries,
commentary and public-domain source quotations; no book/episode files are included.
Only selected chapter/thinker artwork and relevant glosses accompany these bundles.
No owner SQLite database, highlights, reading history, requests or credentials ship.

## Installation contract for the receiving agent

Use the private prerelease assets for the machine's architecture. Verify SHA256SUMS,
then `gzip -dc wisdom-image-ARCH.tar.gz | docker load`. The loaded canonical tag is
`ghcr.io/humanitylabs-org/wisdom:0.4.0-private.24`. Registry access is not implied.
The installer must not replace a preloaded image with an older registry version.

Package manifest: `wizard.md`; Runtipi schema-2 recipe: `runtipi/docker-compose.yml`.
The private catalog must resolve this package to the exact release commit, not old main.
If the box only supports default-branch private installs, wait for the release PR to
merge or have the platform owner register the exact private record. Do not list this
content on the public index or make the repository/image public.

Set `WISDOM_ORIGINS` to the receiving Wizard's exact browser origin. Keep backend
loopback/private; Host/Origin fences are not per-user authentication. Port 9200 inside
the container; `/healthz`, `/api/wisdom`, `/api/library`, `/openapi.json`, `/mcp`.
The Wizard gateway must supply its approved `/wizard-os-home/core/app-client.js`.
The app does not vendor a replacement client or own a service worker/microphone.

Persist BOTH mounts: app data at `/data`, documents at `/media/Wisdom`. Mount sources
at `/sources:ro` (empty is valid). Startup briefly prepares top-level mount ownership,
then drops to uid/gid 1000 with no effective capabilities. The container is read-only.
The starter marker lives in the database. Initial import resumes safely after a crash;
subsequent starts never reseed or reset removed/disabled collections. An existing
nonempty library/state/media folder is left intact, without adding demonstration data.
`WISDOM_STARTER_DIR` can select an operator-owned seed path; contract tests point it
at a nonexistent directory to test the unseeded engine separately.

## Acceptance

Open all four collections, read a chapter, save progress/star/highlight, replace the
container with the same mounts, and read back state. Import/disable/re-enable operates
on immutable validated document bundles; state remains separate. Typed search works.
Back is delegated to WizardApp and must close an overlay/nested view without exiting.
The release receipt records the exact tested source, image and browser evidence.

## Shared library / My library

See [library shelves and export](docs/library-shelves.md) for the trust model,
explicit single-collection download API/MCP and trusted offline migration API.
Uploaded/generated bundles default private regardless of licence. Existing
installations are not silently reclassified; only trusted starter/source approval
can assign shared provenance. Export never publishes or changes scope.

## Optional integrations and deferred work

Typed collection requests appear only with `WISDOM_ADMIT=live` and
`WISDOM_WIZARD_ORIGIN` configured; otherwise the UI explains the missing service.
Keep `WISDOM_ADMIT=disabled` in test releases. Real Agent Service admission needs
separate owner-side verification. No microphone is added. Public distribution,
licensing and full per-user onboarding remain separate work.
