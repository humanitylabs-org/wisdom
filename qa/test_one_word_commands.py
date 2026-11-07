import re, unittest, pathlib
import discussions as d

ROOT = pathlib.Path(__file__).resolve().parent.parent


class OneWordCommands(unittest.TestCase):
    """owner request, 22 Oct: Ask AI shortcuts insert exactly their one-word label; the prompt defines each word."""

    def test_chips_are_single_words(self):
        js = (ROOT / 'static' / 'discussions.js').read_text()
        rows = re.findall(r"(passage|chapter): \[[^\n]*?, \[([^\]]*)\]\]", js)
        self.assertEqual({k for k, _ in rows}, {'passage', 'chapter'})
        for _, chips in rows:
            words = re.findall(r"'([^']*)'", chips)
            self.assertIn('Simplify', words)
            for w in words:
                self.assertRegex(w, r'^[A-Z][a-z]+$')

    def test_prompts_define_every_command(self):
        for system in (d.SYSTEM, d.CHAPTER_SYSTEM):
            for w in ('Explain =', 'Simplify =', 'Example =', 'Challenge =', 'Summarize =', 'Apply ='):
                self.assertIn(w, system)


if __name__ == '__main__':
    unittest.main()
