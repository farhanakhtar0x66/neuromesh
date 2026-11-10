"""Books and the catalog of how many copies the library owns."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Book:
    isbn: str
    title: str
    author: str


class Catalog:
    def __init__(self):
        self._books = {}
        self._copies = {}

    def add(self, book, copies=1):
        self._books[book.isbn] = book
        self._copies[book.isbn] = self._copies.get(book.isbn, 0) + copies

    def get(self, isbn):
        return self._books.get(isbn)

    def copies(self, isbn):
        return self._copies.get(isbn, 0)
