"""UI model regressions, discovered by the standard unittest runner (Node required)."""
from pathlib import Path
import os
import subprocess
import unittest


class CollectionHome(unittest.TestCase):
    def test_collection_home_model(self):
        root = Path(__file__).resolve().parents[1]
        result = subprocess.run([os.environ.get('NODE', 'node'), 'qa/home_model.cjs'],
                                cwd=root, text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
