build a small command-line expense tracker in python: i can add an expense with an amount, a category and a note, list my expenses, see totals per category and per month, and export everything to csv. save the data in a json file so it is still there next time, handle bad input without crashing, and include tests

Details that must hold:

- The program is started as `python3 expenses.py [--file PATH] <command> ...`. `--file` comes before the command and names the JSON data file (default `expenses.json` in the current folder). The file is created on the first `add`. Other modules and packages next to `expenses.py` are fine; only the Python standard library is available.
- `add AMOUNT CATEGORY [--note TEXT] [--date YYYY-MM-DD]` adds an expense and prints its id. Ids are whole numbers starting at 1 and are never reused. The date defaults to today. An amount is a positive number with at most two decimals (`12`, `12.5`, `12.50`); anything else is bad input. The category is trimmed and stored in lower case; an empty category is bad input.
- `list [--category C] [--month YYYY-MM] [--json]` shows the expenses, oldest date first, and in the order they were added within a day. With `--json` it prints a JSON array of objects with the keys `id`, `date`, `amount`, `category`, `note`; `amount` is a string with exactly two decimals (`"12.50"`).
- `totals --by category|month [--json]` shows the total per category (keys are category names) or per month (keys are `YYYY-MM`). With `--json` it prints one JSON object mapping each key to a two-decimal string. Totals are exact: ten expenses of `0.10` total `"1.00"`.
- `delete ID` removes one expense. An unknown id is bad input.
- `export PATH` writes a CSV file with the header `id,date,amount,category,note` and one row per expense in the same order as `list`, quoted as CSV requires (a note may contain commas, quotes and line breaks). It prints how many rows it wrote.
- Bad input (a bad amount, date, month, id, an unknown command, a missing argument) prints one line to stderr and exits with status 2, with no traceback, and changes nothing. A data file that is not valid JSON is not overwritten: the program says so on stderr and exits with status 1.
- A change is written so that a crash cannot leave a half-written file (write a temporary file, then rename it).
