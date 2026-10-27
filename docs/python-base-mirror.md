# Python base mirror

Wisdom's source-package runtime needs the official Python image, not a rebuilt
Wisdom image. Docker Hub's anonymous per-IP limit can block fresh installs.

The `Mirror public Python base` GitHub Actions workflow copies the complete pinned
upstream index to `ghcr.io/humanitylabs-org/mirror-python:3.12-slim` using
`skopeo copy --all --preserve-digests`. It copies every platform, attestation and
layer; it does not rebuild Python, modify its labels or publish app/owner content.
The upstream and mirror index digest must both remain:

`sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1`

Only this repository's canonical main can publish. A separate credential-free
hosted job pulls both tag and digest for linux/amd64 and linux/arm64. Publication
is not complete until those anonymous pulls pass. If the organization creates a
private package, an administrator must make it public and rerun verification.
The workflow can be dispatched again on main to repair or reverify the same pin;
updating Python requires a separately reviewed upstream digest change.

The public index resolves `humanitylabs-org/wisdom` to an immutable commit and
`wizard.md` selects `runtipi/docker-compose.yml`. App Manager generates the
`wisdom:wizardapps` store entry from that recipe and mounts the selected source
commit read-only at `/app`. The legacy `wizard-app-store` has no Wisdom entry;
there is no second hand-maintained compose pin to update there.

After changing the recipe, refresh discovery with:

```sh
curl -fsS https://apps.aiwizards.com/v1/publish \
  -H 'Content-Type: application/json' \
  -d '{"repo":"humanitylabs-org/wisdom"}'
```

Then read `/v1/apps/humanitylabs-org/wisdom` and `/v1/search?id=wisdom`, check the
returned install commit, and fetch its `runtipi/docker-compose.yml` to verify the
GHCR reference. A successful publish response alone is not index verification.
