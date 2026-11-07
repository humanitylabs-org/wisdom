"""The app uses the shared, immutable Wizard component kit, not a local fork."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'static' if (ROOT / 'static').is_dir() else ROOT


class SharedStyle(unittest.TestCase):
    def test_imported_component_kit_matches_its_source_pin(self):
        lock = json.loads((ROOT / 'wizard-style-lock.json').read_text())
        self.assertEqual(lock['source'], 'https://github.com/humanitylabs-org/wizard-os')
        self.assertEqual(len(lock['revision']), 40)
        for name, digest in lock['files'].items():
            self.assertEqual(hashlib.sha256((WEB / name).read_bytes()).hexdigest(), digest, name)

    def test_reader_type_and_size_controls_keep_their_authored_roles(self):
        css = (WEB / 'wisdom.css').read_text()
        import re
        sizes = {}
        for size in (0, 2, 3):
            selector = '.wb-reader[data-size="%s"] .wb-flow' % size
            found = re.search(re.escape(selector) + r'\{font-size:([^}]+)\}', css)
            self.assertIsNotNone(found)
            if found: sizes[size] = found.group(1)
        self.assertEqual(len(set(sizes.values())), 3, 'A−/A+ must not collapse to the same size')
        self.assertIn('--wb-display:var(--wz-font-reading)', css, 'Editorial headlines remain serif')
        self.assertRegex(css, r'\.wb-opener-copy h1\{[^}]*clamp\(', 'Keep responsive cover headline scale')

    def test_hosted_panel_defaults_use_opaque_skin_roles(self):
        css = (WEB / 'wizard-appearance.css').read_text()
        for selector in ('html[data-wz-hosted] .sheet', 'html[data-wz-hosted] .wb-sheet-card', 'html[data-wz-hosted] :is(.wb-hlpop,.wb-glosspop)'):
            # Text-bearing overlays stay opaque: the skin's overlay tint is composited over the opaque panel/base role
            # (tests/opaque_overlays_browser.cjs proves it in a browser), never left translucent.
            rule = css.split(selector + '{', 1)[1].split('}', 1)[0]
            self.assertIn('linear-gradient(var(--wz-overlay', rule, selector)
            self.assertRegex(rule, r'var\(--wz-(panel|base)\b', selector)

    def test_entrypoint_loads_the_shared_component_classes(self):
        entry = (WEB / 'index.html').read_text()
        self.assertIn('wizard-ui.css', entry)
        scripts = '\n'.join(p.read_text() for p in WEB.glob('*.js') if not p.name.startswith('wizard-'))
        self.assertIn('wz-button', entry + scripts)


    def test_every_local_asset_the_entrypoint_loads_is_served(self):
        """index.html's own files must be in server.STATIC, or the reader gets a JSON 404 and loses the kit."""
        import ast, re
        tree = ast.parse((ROOT / 'server.py').read_text())
        static = next(ast.literal_eval(n.value) for n in tree.body
                      if isinstance(n, ast.Assign) and any(getattr(t, 'id', '') == 'STATIC' for t in n.targets))
        entry = (WEB / 'index.html').read_text()
        local = {u for u in re.findall(r'(?:href|src)="([^"]+)"', entry) if not re.match(r'(?:[a-z]+:|/|#)', u)}
        self.assertTrue({'wizard-tokens.css', 'wizard-ui.css', 'wizard-sheet.js'} <= local)
        self.assertEqual(sorted(local - static), [])
        self.assertEqual(sorted(n for n in static if not (WEB / n).is_file()), [])


if __name__ == '__main__': unittest.main()
