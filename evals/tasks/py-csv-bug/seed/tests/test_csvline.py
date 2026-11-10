import unittest

from csvline import split_line


class SplitTest(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(split_line("a,b,c"), ["a", "b", "c"])

    def test_quoted_comma(self):
        self.assertEqual(split_line('a,"b,c",d'), ["a", "b,c", "d"])


if __name__ == "__main__":
    unittest.main()
