"""Run source-executed synthetic client regressions in normal Python discovery."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LibraryClient(unittest.TestCase):
    def test_cached_freshness_hydration_and_quota(self):
        result = subprocess.run(
            ['node', '--test', 'qa/library-cached-freshness.test.cjs',
             'qa/library-hydration.test.cjs', 'qa/library-partial-quota.test.cjs'],
            cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout)


if __name__ == '__main__':
    unittest.main()
