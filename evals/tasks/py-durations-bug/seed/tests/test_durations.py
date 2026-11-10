import unittest

from durations import parse_duration


class ParseTest(unittest.TestCase):
    def test_hours(self):
        self.assertEqual(parse_duration("2h"), 7200)


if __name__ == "__main__":
    unittest.main()
