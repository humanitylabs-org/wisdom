"""Finishing a chapter (its end page) syncs 100% progress with the done mark. Synthetic state only."""
import unittest

import wisdom
from qa import test_pinned_revision as fixtures


class DoneProgress(fixtures.StateCase):
    def entry(self, state):
        return next(e for e in state['entries'] if e['id'] == self.chapter)

    def test_done_snapshot_reports_full_progress(self):
        wisdom.react(self.c, {'kind': 'entry', 'id': self.chapter, 'field': 'progress', 'value': 88})
        e = self.entry(wisdom.react(self.c, {'kind': 'entry', 'id': self.chapter, 'field': 'done', 'value': True}))
        self.assertTrue(e['read'])
        self.assertEqual(e['progress'], 100)
        self.assertIsNotNone(e['opened_at'])

    def test_done_without_prior_position(self):
        e = self.entry(wisdom.react(self.c, {'kind': 'entry', 'id': self.chapter, 'field': 'done', 'value': True}))
        self.assertEqual(e['progress'], 100)


if __name__ == '__main__':
    unittest.main()
