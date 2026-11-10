import unittest
from datetime import datetime

from cron import next_run


class CronTest(unittest.TestCase):
    def test_every_quarter_hour(self):
        self.assertEqual(next_run("*/15 * * * *", datetime(2026, 1, 1, 10, 7)), datetime(2026, 1, 1, 10, 15))


if __name__ == "__main__":
    unittest.main()
