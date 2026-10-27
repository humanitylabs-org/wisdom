"""Keep the unchanged upstream multi-platform Python base publicly installable."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
DIGEST = 'sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1'


class BaseMirror(unittest.TestCase):
    def test_mirror_keeps_all_upstream_platforms_and_digest(self):
        workflow = (ROOT / '.github/workflows/python-mirror.yml').read_text()
        self.assertIn('docker.io/library/python@' + DIGEST, workflow)
        self.assertIn('skopeo copy --all --preserve-digests', workflow)
        self.assertIn('ghcr.io/humanitylabs-org/mirror-python:3.12-slim', workflow)
        self.assertIn('sha256sum', workflow)
        self.assertIn('diff -u', workflow)

    def test_wisdom_installs_without_docker_hub(self):
        compose = (ROOT / 'runtipi/docker-compose.yml').read_text()
        dockerfile = (ROOT / 'Dockerfile').read_text()
        image = 'ghcr.io/humanitylabs-org/mirror-python:3.12-slim@' + DIGEST
        self.assertIn('image: ' + image, compose)
        self.assertIn('FROM ' + image, dockerfile)
        self.assertNotIn('image: python:', compose)
        self.assertNotIn('FROM python:', dockerfile)

    def test_source_package_and_storage_are_unchanged(self):
        compose = (ROOT / 'runtipi/docker-compose.yml').read_text()
        manifest = (ROOT / 'wizard.md').read_text()
        self.assertIn('package: source', manifest)
        self.assertIn('compose: runtipi/docker-compose.yml', manifest)
        self.assertIn('${APP_SOURCE_DIR}:/app:ro', compose)
        self.assertIn('${APP_DATA_DIR}/data:/data', compose)
        self.assertIn('${ROOT_FOLDER_HOST}/media/Wisdom:/media/Wisdom', compose)
        self.assertIn('command: [python, start.py]', compose)

    def test_only_canonical_main_can_publish(self):
        workflow = (ROOT / '.github/workflows/python-mirror.yml').read_text()
        publisher = workflow.split('  verify:')[0]
        self.assertIn("github.repository == 'humanitylabs-org/wisdom'", publisher)
        self.assertIn("github.ref == 'refs/heads/main'", publisher)
        self.assertIn("github.event_name == 'push' || github.event_name == 'workflow_dispatch'", publisher)
        self.assertIn('packages: write', publisher)
        self.assertIn('persist-credentials: false', publisher)

    def test_independent_anonymous_pulls_cover_both_install_architectures(self):
        workflow = (ROOT / '.github/workflows/python-mirror.yml').read_text()
        verifier = workflow.split('  verify:')[1]
        self.assertIn('needs: mirror', verifier)
        self.assertIn('permissions: {}', verifier)
        self.assertNotIn('github.token', verifier)
        self.assertNotIn('secrets.', verifier)
        self.assertIn('arch: [amd64, arm64]', verifier)
        self.assertIn('docker pull --platform', verifier)
        self.assertIn('DOCKER_CONFIG="$clean/docker"', verifier)
        self.assertIn('unset DOCKER_AUTH_CONFIG', verifier)
        self.assertIn('docker image rm "$ref"', verifier)


if __name__ == '__main__':
    unittest.main()
