"""Starter collections ship to every tester: they must read as a generic edition,
with no references to the owner's own projects, people or rules."""
import os, pathlib, re, unittest, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'starter'
# Generic owner-reference guard. A maintainer adds their own names/hosts through WISDOM_OWNER_TERMS
# (comma-separated regex fragments) so no personal term needs to be committed.
_EXTRA = [t for t in os.environ.get('WISDOM_OWNER_TERMS', '').split(',') if t]
OWNER = re.compile('|'.join([r"\bWizard\b|AI Wizards|tailnet|\.ts\.net|/home/|your (standing )?rule|make this easy"] + _EXTRA), re.I)
AUTHOR_FIELDS = re.compile(r'"by":"Wizard"|Wizard-generated')

class GenericStarter(unittest.TestCase):
    def test_no_owner_references(self):
        bundles = sorted(ROOT.glob('*.zip'))
        if not bundles:
            self.skipTest('public build ships no starter bundles')
        for path in bundles:
            z = zipfile.ZipFile(path)
            for name in z.namelist():
                if name.endswith(('.md', '.json')):
                    text = AUTHOR_FIELDS.sub('', z.read(name).decode())
                    text = re.sub(r'"(id|thinker)":"[^"]*"', '', text)
                    hits = sorted({m.group(0) for m in OWNER.finditer(text)})
                    self.assertEqual(hits, [], f'{path.name}:{name}')

if __name__ == '__main__':
    unittest.main()
