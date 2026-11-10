from datetime import date, timedelta
from decimal import Decimal

from library.books import Book, Catalog
from library.loans import LimitReached, Loan, LoanDesk, NotAvailable
from library.members import Member
from library.report import overdue

cat = Catalog()
cat.add(Book("111", "Dune", "Herbert"), copies=1)
cat.add(Book("222", "Emma", "Austen"), copies=2)
cat.add(Book("333", "Ulysses", "Joyce"), copies=1)
desk = LoanDesk(cat)
ana = Member("a", "Ana", limit=2)
bo = Member("b", "Bo")
assert bo.limit == 3

d0 = date(2026, 1, 1)
l1 = desk.checkout(ana, "111", d0)
assert isinstance(l1, Loan) and l1.due == d0 + timedelta(days=14) and l1.borrowed == d0
try:
    desk.checkout(bo, "111", d0)
    raise AssertionError("expected NotAvailable")
except NotAvailable:
    pass
try:
    desk.checkout(bo, "999", d0)
    raise AssertionError("expected NotAvailable for unknown isbn")
except NotAvailable:
    pass
desk.checkout(ana, "222", d0 + timedelta(days=1))
try:
    desk.checkout(ana, "333", d0)
    raise AssertionError("expected LimitReached")
except LimitReached:
    pass
desk.checkout(bo, "222", d0 + timedelta(days=2))
assert [(l.isbn, l.member_id) for l in desk.active()] == [("111", "a"), ("222", "a"), ("222", "b")]

today = d0 + timedelta(days=20)
report = overdue(desk.active(), today)
assert [(l.isbn, l.member_id, d) for l, d in report] == [("111", "a", 6), ("222", "a", 5), ("222", "b", 4)], report

assert desk.checkin("a", "111", d0 + timedelta(days=14)) == Decimal("0")
assert desk.checkin("a", "222", d0 + timedelta(days=1 + 14 + 3)) == Decimal("0.75")
assert desk.checkin("b", "222", d0 + timedelta(days=200)) == Decimal("10.00")
try:
    desk.checkin("b", "222", today)
    raise AssertionError("expected KeyError")
except KeyError:
    pass
assert desk.active() == []
desk.checkout(bo, "111", today)
print("hidden check passed")
