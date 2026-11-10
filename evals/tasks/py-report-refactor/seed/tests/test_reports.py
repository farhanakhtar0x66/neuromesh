import unittest

from reports import sales_report


class ReportTest(unittest.TestCase):
    def test_sales(self):
        out = sales_report([{"region": "North", "units": 3, "revenue": 12.5}])
        self.assertEqual(out.splitlines()[2], "North       3    12.50")


if __name__ == "__main__":
    unittest.main()
