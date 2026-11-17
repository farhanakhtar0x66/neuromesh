# Invoice totals and the monthly report disagree by a cent; one customer has a negative line

At month end we compare `python -m billing report` with the invoices we actually sent. For some customers the two
are a cent apart, and there is no pattern we can see: not one jurisdiction, not one customer, and when we work a
line out by hand we sometimes get the invoice's figure and sometimes the report's. Smallest case we found: an
order with a single line of 1 x 0.24 in TX shows 0.01 tax on the invoice, while the report counts 0.02 for it.

Separately, finance found an invoice for a customer on a loyalty discount where one line, a clearance item with its
own discount on top, came out with a negative total.

We need to be able to trust these numbers, both ways. Please find out why this happens and fix it. We would rather
you fix the cause than add a patch where the symptom shows up.
