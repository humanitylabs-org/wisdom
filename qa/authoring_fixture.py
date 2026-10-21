"""Entirely synthetic catalog/Markdown/art; no owner library dependencies."""
import base64
import json
from pathlib import Path

JPEG = base64.b64decode('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgACAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+hKKKK/Iz7Q//9k=')


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def fixture(path, key='new-study'):
    path = Path(path)
    (path / 'content').mkdir(parents=True)
    for category in ('p', 'c'):
        (path / 'static/wisdom-art' / category).mkdir(parents=True)
    ids = [key + '-overview', key + '-second', key + '-first']
    author = key + '-author'
    catalog = {
        'thinkers': [{'id': author, 'name': 'Nāgā — synthetic author', 'bio': 'A synthetic author.',
                      'series': 'Synthetic chapters', 'url': 'https://example.org/source'},
                     {'id': 'unrelated-author', 'name': 'Unrelated'}],
        # Source catalog order differs intentionally from collection/section order.
        'entries': [{'id': chapter, 'thinker': author, 'part': part,
                     'title': 'Synthetic ' + chapter, 'deck': 'Café · naïve · 道',
                     'published_at': '2026-10-12T00:00:00.000Z',
                     'description': 'Synthetic authoring bridge proof, not a historical claim.',
                     'source_url': 'https://example.org/source', 'origin': 'Wisdom',
                     'initial_read': False, 'initial_archived': False}
                    for part, chapter in zip((2, 1, 0), reversed(ids))] +
                   [{'id': 'unrelated-chapter', 'thinker': 'unrelated-author', 'part': 1,
                     'title': 'Never exported'}],
        'collections': [{'id': key, 'title': 'Synthetic étude', 'form': 'book', 'by': 'Wizard',
                         'thinker': author, 'overview': ids[0], 'entries': ids,
                         'sections': [{'title': '', 'entries': [ids[0]]},
                                      {'title': 'I. Read slowly', 'entries': ids[1:]}]},
                        {'id': 'unrelated', 'title': 'Unrelated', 'entries': ['unrelated-chapter']}],
    }
    write_json(path / 'content/catalog.json', catalog)
    for chapter in ids:
        (path / ('content/' + chapter + '.md')).write_text(
            '# Synthetic étude — ' + chapter + '\n*An invented QA source · ~2 minutes*\n\n'
            '## In their own words\n\n> This sentence is a synthetic fixture, not a quotation. [1]\n\n'
            '## The compression\n\n**My compression: notice before naming.**\n\n'
            '## How this mind moves\n\n**Look.** Café, naïve and 道 survive the journey.\n\n'
            '**Pause.** Return to the page.\n\n**Read.** Preserve the order.\n\n'
            '## Why today\n\n' + 'Quiet attention begins with one thing. ' * 75 +
            '\n\n## Carry this question\n\nWhat did you notice?\n\n## Sources\n\n'
            '[1] https://example.org/source\n', encoding='utf-8')
    # Unselected files can be missing or private; the exporter must never read them.
    (path / 'content/private-not-selected.md').write_text('NOT SELECTED')
    write_json(path / 'content/glosses.json', {
        '道': {'en': 'way', 'roman': 'dào', 'say': 'dow', 'language': 'Chinese', 'lang': 'zh'},
        '無': {'en': 'not selected', 'roman': 'wú'},
    })
    for suffix in ('p/' + author, 'c/' + ids[0], 'p/unrelated-author'):
        (path / ('static/wisdom-art/' + suffix + '.jpg')).write_bytes(JPEG)
    return catalog
