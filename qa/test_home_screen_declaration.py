"""Wisdom declares its own home-screen pin capabilities; the shell has no Wisdom table."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = (ROOT / "wizard.md").read_text()
BLOCK = re.search(r"^home_screen:\n((?:[ \t]+.*\n|[ \t]*#.*\n)+)", MANIFEST, re.M)


class HomeScreenDeclaration(unittest.TestCase):
    def test_declares_offline_position_and_route(self):
        self.assertIsNotNone(BLOCK, "wizard.md must declare home_screen")
        block = BLOCK.group(1)
        self.assertRegex(block, r"(?m)^\s+offline: true\b", "offline pin")
        self.assertRegex(block, r"(?m)^\s+position_keys: \[\"wisdom:\*:pos:\*\"\]", "per-pin reading place")
        self.assertRegex(block, r"(?m)^\s+route_state: wisdom\b", "own route state")

    def test_position_pattern_matches_the_reader_key_and_only_it(self):
        reader = (ROOT / "static/wisdom.js").read_text()
        # posKey in wisdom.js builds 'wisdom:<path>:pos:<chapter>'
        self.assertTrue("posKey=id=>'wisdom:'+new URL('.',location.href).pathname+':pos:'+id" in reader, "posKey shape changed")
        pattern = re.compile(r"^wisdom:.*:pos:.*$")
        self.assertTrue(pattern.match("wisdom:/wisdom/:pos:chapter-1"))
        self.assertFalse(pattern.match("wisdom:/wisdom/:size"))
        self.assertFalse(pattern.match("content:read:chapter"))

    def test_route_state_and_replica_prefix_match_the_app(self):
        self.assertTrue("replaceState({wisdom:true" in (ROOT / "static/wisdom.js").read_text(), "route state key changed")
        self.assertTrue("prefix:'wisdom-'" in (ROOT / "static/offline.js").read_text(), "replica prefix changed")


if __name__ == "__main__":
    unittest.main()
