"""Prevent catalog/Compose/native-builder version drift before packaging."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
IMAGE = "ghcr.io/humanitylabs-org/wisdom:"


def assert_release_version(root, release_version=None):
    root = Path(root)
    version = json.loads((root / "runtipi/config.json").read_text())["version"]
    manifest = re.findall(r"^version: (\S+)$", (root / "wizard.md").read_text(), re.M)
    images = re.findall(r"^\s+image: (\S+)$", (root / "runtipi/docker-compose.yml").read_text(), re.M)
    assert manifest == [version], f"manifest version mismatch: {manifest!r} != {version}"
    if re.search(r"^\s+package: source$", (root / "wizard.md").read_text(), re.M):
        # runtime.package: source -> the App Manager mounts the pinned commit into the pinned official Python base,
        # which must be digest-identical to the Dockerfile base the CI image is built from (docs/python-base-mirror.md).
        base = re.search(r"^FROM (\S+)", (root / "Dockerfile").read_text(), re.M).group(1)
        assert images == [base], f"Compose image mismatch: {images!r} != {[base]!r}"
    else:
        assert images == [IMAGE + version], f"Compose image mismatch: {images!r} != {[IMAGE + version]!r}"
    if release_version is not None:
        assert release_version == version, f"native release version mismatch: {release_version} != {version}"
    return version


class ReleaseVersion(unittest.TestCase):
    def test_compose_image_equals_catalog_manifest_and_native_release_version(self):
        version = json.loads((ROOT / "runtipi/config.json").read_text())["version"]
        self.assertEqual(assert_release_version(ROOT, version), version)

    def test_previous_compose_image_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / "runtipi", root / "runtipi")
            shutil.copyfile(ROOT / "wizard.md", root / "wizard.md")
            shutil.copyfile(ROOT / "Dockerfile", root / "Dockerfile")
            compose = root / "runtipi/docker-compose.yml"
            # copytree preserves sealed source modes; mutate only our disposable file.
            compose.chmod(compose.stat().st_mode | stat.S_IWUSR)
            compose.write_text("services:\n  wisdom:\n    image: " + IMAGE + "0.4.0-private.35\n")
            with self.assertRaisesRegex(AssertionError, "Compose image mismatch"):
                assert_release_version(root, "0.4.0-private.36")

    def test_native_builder_version_drift_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, "native release version mismatch"):
            assert_release_version(ROOT, "0.4.0-private.35")


class ReadOnlyReleaseFixture(unittest.TestCase):
    def test_release_checks_from_sealed_source_leave_bytes_and_modes_unchanged(self):
        def snapshot(source):
            return {
                p.relative_to(source).as_posix(): (
                    stat.S_IMODE(p.stat().st_mode),
                    hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None,
                )
                for p in [source, *sorted(source.rglob("*"))]
            }

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            source = base / "source"
            (source / "qa").mkdir(parents=True)
            shutil.copytree(ROOT / "runtipi", source / "runtipi")
            shutil.copyfile(ROOT / "wizard.md", source / "wizard.md")
            shutil.copyfile(ROOT / "Dockerfile", source / "Dockerfile")
            module = Path(__file__).read_text()
            shutil.copyfile(Path(__file__), source / "qa/test_release_version.py")
            # Executable negative control: precisely the pre-fix fixture, not a mock.
            fix = "            compose.chmod(compose.stat().st_mode | stat.S_IWUSR)\n"
            self.assertEqual(module.count(fix), 1)
            (source / "qa/test_release_version_before.py").write_text(module.replace(fix, ""))
            for p in source.rglob("*"):
                p.chmod(0o555 if p.is_dir() else 0o444)
            source.chmod(0o555)
            before = snapshot(source)
            writable_tmp = base / "tmp"
            writable_tmp.mkdir()
            env = {**os.environ, "TMPDIR": str(writable_tmp), "PYTHONDONTWRITEBYTECODE": "1"}
            # Select the original three checks only, avoiding recursive regression runs.
            runner = (
                "import runpy,sys,unittest; "
                "m=runpy.run_path(sys.argv[1]); "
                "s=unittest.defaultTestLoader.loadTestsFromTestCase(m['ReleaseVersion']); "
                "r=unittest.TextTestRunner(verbosity=2).run(s); "
                "sys.exit(not r.wasSuccessful())"
            )
            for name, expected in [("test_release_version_before.py", 1), ("test_release_version.py", 0)]:
                with self.subTest(module=name):
                    result = subprocess.run(
                        [sys.executable, "-B", "-c", runner, str(source / "qa" / name)],
                        cwd=source, env=env, text=True, capture_output=True, timeout=15,
                    )
                    output = result.stdout + result.stderr
                    self.assertEqual(result.returncode, expected, output)
                    self.assertIn("Ran 3 tests", output)
                    if expected:
                        self.assertIn("PermissionError", output)
                        self.assertIn("test_previous_compose_image_is_rejected", output)
                        self.assertIn("FAILED (errors=1)", output)
                    else:
                        self.assertIn("\nOK\n", output)
                    self.assertEqual(snapshot(source), before, "sealed source bytes or modes changed")


if __name__ == "__main__":
    unittest.main()
