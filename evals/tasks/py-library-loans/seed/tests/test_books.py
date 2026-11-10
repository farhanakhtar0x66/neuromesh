import unittest

from library.books import Book, Catalog


class CatalogTest(unittest.TestCase):
    def test_copies(self):
        c = Catalog()
        c.add(Book("1", "Dune", "Herbert"), copies=2)
        self.assertEqual(c.copies("1"), 2)
        self.assertEqual(c.copies("x"), 0)


if __name__ == "__main__":
    unittest.main()
