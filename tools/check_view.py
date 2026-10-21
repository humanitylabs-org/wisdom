"""Vanilla view has no compiler; verify required editable source files."""
from pathlib import Path
p=Path(__file__).resolve().parent.parent/'static'
for n in ('index.html','app.js','wisdom.js','manage.js','wizard-appearance.js','wisdom.css'):
 assert (p/n).is_file(),n
print('Wisdom vanilla view source ready')
