"""Hidden battery for minidb: every answer is compared with what SQLite returns.

The package runs in a child process where the sqlite3 module cannot be imported.
A statement written with a leading "!" is one SQLite rejects; minidb must raise
SQLError there. Prints one PASS/FAIL line per case, then SCORE passed/total.
"""
import json, os, re, subprocess, sys, tempfile, time

BLOCK = "import sys, os\nsys.modules['sqlite3'] = None\nsys.modules['_sqlite3'] = None\nsys.path.insert(0, os.getcwd())\n"
TIME_LIMIT = 5.0


# ---------------------------------------------------------------- child side
def runner(cases_path, out_path):
    sys.modules["sqlite3"] = None
    sys.modules["_sqlite3"] = None
    sys.path.insert(0, os.getcwd())
    import signal

    class Timeout(BaseException):
        pass

    def on_alarm(*_):
        raise Timeout()

    signal.signal(signal.SIGALRM, on_alarm)
    cases = json.load(open(cases_path))
    out = open(out_path, "a")

    def emit(obj):
        out.write(json.dumps(obj) + "\n")
        out.flush()

    try:
        from minidb import Database, SQLError
    except BaseException as e:  # noqa: any failure to import fails every case
        for c in cases:
            emit({"name": c["name"], "fatal": ("import failed: %s: %s" % (type(e).__name__, e))[:200]})
        return

    def enc(v):
        if v is None or type(v) is int or type(v) is str:
            return v
        if type(v) is float and v == v and v not in (float("inf"), float("-inf")):
            return v
        return {"bad": type(v).__name__}

    def run(db, sql):
        try:
            rows = db.execute(sql)
        except SQLError:
            return {"err": 1}
        except Timeout:
            raise
        except Exception as e:
            return {"exc": ("%s: %s" % (type(e).__name__, e))[:160]}
        if not isinstance(rows, (list, tuple)):
            return {"exc": "execute returned " + type(rows).__name__}
        try:
            return {"rows": [[enc(v) for v in r] for r in rows]}
        except Exception as e:
            return {"exc": ("bad rows: %s: %s" % (type(e).__name__, e))[:160]}

    for c in cases:
        emit({"start": c["name"]})
        res = {"name": c["name"]}
        signal.alarm(c.get("alarm", 20))
        try:
            db = Database()
            res["setup"] = [run(db, s) for s in c.get("setup", [])]
            t = time.time()
            res["sql"] = [run(db, s) for s in c["sql"]]
            res["secs"] = time.time() - t
        except Timeout:
            res["fatal"] = "timed out"
        except BaseException as e:
            res["fatal"] = ("%s: %s" % (type(e).__name__, e))[:160]
        finally:
            signal.alarm(0)
        emit(res)


if len(sys.argv) == 4 and sys.argv[1] == "--run":
    runner(sys.argv[2], sys.argv[3])
    sys.exit(0)

import sqlite3  # the answer key; only the parent process has it

# ---------------------------------------------------------------- the cases
CASES = []


def C(group, name, sql, setup=(), limit=None, alarm=20):
    CASES.append({"group": group, "name": "%s: %s" % (group, name), "setup": list(setup), "sql": list(sql), "limit": limit, "alarm": alarm})


def G(group, fixture, statements):
    for s in statements:
        C(group, " ".join(s.split())[:90], [s], setup=fixture)


EMP = [
    "CREATE TABLE dept (id INTEGER PRIMARY KEY, name TEXT NOT NULL, budget REAL)",
    "INSERT INTO dept VALUES (1,'eng',1000.5),(2,'ops',250.0),(3,'sales',NULL),(4,'empty',10.0)",
    "CREATE TABLE emp (id INTEGER PRIMARY KEY, name TEXT, dept_id INTEGER, salary INTEGER, boss INTEGER, rating REAL)",
    "INSERT INTO emp VALUES (1,'Ann',1,120,NULL,4.5),(2,'bob',1,100,1,3.0),(3,'Cy',2,80,1,NULL),(4,'dee',2,80,3,2.5),"
    "(5,'Eve',3,95,1,4.0),(6,'fay',NULL,60,5,1.5),(7,'Gus',1,NULL,2,3.5)",
]
T = ["CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, score REAL DEFAULT 1.5, n INTEGER DEFAULT 7)"]
T3 = T + ["INSERT INTO t (name, email) VALUES ('a', 'a@x'), ('b', 'b@x'), ('c', NULL)"]

G("expr", [], [
    "SELECT 1 + 2 * 3, (1 + 2) * 3, 10 - 2 - 3, -2 * -3, - 3 + 5",
    "SELECT 7 / 2, -7 / 2, 7.0 / 2, 7 / 2.0, 1 / 3",
    "SELECT 7 % 3, -7 % 3, 7 % -3, 10 / 4 * 4, 10 * 4 / 4, 2 * 3 % 4",
    "SELECT 7 / 0, 7 % 0, 7.0 / 0",
    "SELECT 1 + 1.0, 2 * 1.5, 3 - 0.5, 0.1 + 0.2",
    "SELECT 1 < 2, 2 < 1, 1 = 1.0, 1 != 2, 1 <> 1, 2 >= 2, 1 == 1, 2 <= 1",
    "SELECT 'abc' < 'abd', 'B' < 'a', 'a' = 'A', '10' < '9', 'a' = 'a'",
    "SELECT NULL = NULL, NULL != 1, NULL IS NULL, 1 IS NOT NULL, NULL + 1, NULL || 'a', -NULL",
    "SELECT NULL AND 0, NULL AND 1, NULL OR 1, NULL OR 0, NOT NULL",
    "SELECT 1 AND 1, 1 AND 0, 0 OR 0, NOT 0, NOT 5, 2 AND 3",
    "SELECT NOT 1 = 2, 1 = 1 AND 0 OR 1, 1 = 2 OR 3 = 3 AND 4 = 5",
    "SELECT 1 IN (1, 2), 3 IN (1, 2), 1 IN (1, NULL), 2 IN (1, NULL), 2 NOT IN (1, NULL), 2 NOT IN (1, 3)",
    "SELECT 5 BETWEEN 1 AND 10, 5 NOT BETWEEN 1 AND 10, 11 BETWEEN 1 AND 10, NULL BETWEEN 1 AND 2, 5 BETWEEN 5 AND 5",
    "SELECT 'Hello' LIKE 'h%', 'Hello' LIKE '%LL_', 'Hello' LIKE 'h_llo', 'Hello' LIKE 'ell', 'Hello' NOT LIKE '%z%', NULL LIKE 'a'",
    "SELECT 'a' || 'b', 'a' || 1, 1 || 2, 'v' || 1.5, 'v' || 2.0, 'it''s', 'a' || 'b' = 'ab'",
    "SELECT CASE WHEN 1 > 2 THEN 'a' WHEN 2 > 1 THEN 'b' ELSE 'c' END, CASE 3 WHEN 1 THEN 'one' WHEN 3 THEN 'three' END, CASE WHEN 0 THEN 1 END, CASE NULL WHEN NULL THEN 1 ELSE 0 END",
    "SELECT ABS(-3), ABS(-2.5), ABS(NULL), LENGTH('hello'), LENGTH(''), LENGTH(NULL)",
    "SELECT UPPER('aBc'), LOWER('aBc'), SUBSTR('hello', 2, 3), SUBSTR('hello', 2), SUBSTR('hello', -3), SUBSTR('hello', 4, 10)",
    "SELECT COALESCE(NULL, NULL, 3), COALESCE(NULL, 'x', 3), IFNULL(NULL, 7), IFNULL(1, 7), NULLIF(1, 1), NULLIF(1, 2)",
    "SELECT ROUND(2.5), ROUND(-2.5), ROUND(3.14159, 2), ROUND(7), ROUND(1.5), ROUND(NULL)",
    "SELECT TYPEOF(1), TYPEOF(1.5), TYPEOF('a'), TYPEOF(NULL), TYPEOF(1 = 1), TYPEOF('a' || 1), TYPEOF(1 + 1.0), TYPEOF(7 / 2)",
    "SELECT CAST(3.7 AS INTEGER), CAST(-3.7 AS INTEGER), CAST(5 AS REAL), CAST(12 AS TEXT), CAST('42' AS INTEGER), CAST(NULL AS INTEGER), CAST('3.5' AS REAL), CAST(3.7 AS TEXT)",
    "select 1 as one, 'x' AS ex ;",
    "SeLeCt\n  2\n\t+ 2 ,\n abs( -1 ) , Upper('q')",
    "SELECT 'semi;colon', '  spaces  ', '', 'SELECT'",
    "SELECT 5 WHERE 1 = 0",
    "SELECT 5, 6 WHERE 2 > 1",
])

G("select", EMP, [
    "SELECT * FROM dept ORDER BY id",
    "SELECT name, salary FROM emp WHERE salary > 90 ORDER BY salary DESC, id",
    "SELECT name FROM emp WHERE salary > 90",
    "SELECT id FROM emp WHERE salary IS NULL",
    "SELECT id FROM emp WHERE salary != 80",
    "SELECT id FROM emp WHERE NOT (salary > 90)",
    "SELECT id FROM emp WHERE dept_id = 1 AND salary >= 100 OR boss = 5",
    "SELECT id FROM emp WHERE dept_id IN (1, 3) AND name LIKE '%e%'",
    "SELECT id FROM emp WHERE salary BETWEEN 80 AND 100",
    "SELECT id FROM emp WHERE dept_id NOT IN (1, 2)",
    "SELECT name, salary * 2 AS double, salary + rating FROM emp ORDER BY id",
    "SELECT id, salary / 3, salary % 7, rating * 2, -salary FROM emp ORDER BY id",
    "SELECT e.name FROM emp AS e WHERE e.id = 3",
    "SELECT e.name, emp2.id FROM emp e, emp emp2 WHERE e.id = 4 AND emp2.id = e.boss",
    "SELECT name FROM emp ORDER BY name",
    "SELECT name FROM emp ORDER BY LOWER(name) DESC",
    "SELECT id, salary FROM emp ORDER BY salary, id",
    "SELECT id, salary FROM emp ORDER BY salary DESC, id DESC",
    "SELECT id, rating FROM emp ORDER BY rating DESC, id",
    "SELECT name, salary AS s FROM emp WHERE salary IS NOT NULL ORDER BY s DESC, name",
    "SELECT name, dept_id FROM emp ORDER BY 2 DESC, 1",
    "SELECT id FROM emp ORDER BY dept_id, salary DESC, id",
    "SELECT name FROM emp ORDER BY salary * -1, id",
    "SELECT id FROM emp ORDER BY id LIMIT 3",
    "SELECT id FROM emp ORDER BY id LIMIT 3 OFFSET 2",
    "SELECT id FROM emp ORDER BY id LIMIT 0",
    "SELECT id FROM emp ORDER BY id DESC LIMIT 5 OFFSET 6",
    "SELECT id FROM emp ORDER BY id LIMIT 10 OFFSET 20",
    "SELECT DISTINCT salary FROM emp",
    "SELECT DISTINCT dept_id FROM emp ORDER BY dept_id",
    "SELECT DISTINCT dept_id, salary FROM emp",
    "SELECT DISTINCT salary / 50 FROM emp ORDER BY 1",
    "SELECT id, CASE WHEN salary >= 100 THEN 'high' WHEN salary >= 80 THEN 'mid' ELSE 'low' END FROM emp ORDER BY id",
    "SELECT id, COALESCE(salary, 0) + 1, IFNULL(rating, -1.0) FROM emp ORDER BY id",
    "SELECT name || '-' || dept_id FROM emp ORDER BY id",
    "SELECT UPPER(name), LENGTH(name) FROM emp WHERE LENGTH(name) = 2",
    "SELECT * FROM emp WHERE id = 6",
    "SELECT id FROM emp WHERE salary > rating * 30 ORDER BY id",
    "SELECT id FROM emp WHERE boss IS NULL OR dept_id IS NULL",
    "SELECT COUNT(*) FROM emp WHERE name > 'a'",
    "SELECT emp.id, emp.name FROM emp WHERE emp.rating >= 3.5 AND NOT emp.id = 1",
])

G("aggregate", EMP, [
    "SELECT COUNT(*), COUNT(salary), COUNT(dept_id), COUNT(DISTINCT salary), COUNT(DISTINCT dept_id) FROM emp",
    "SELECT SUM(salary), AVG(salary), MIN(salary), MAX(salary) FROM emp",
    "SELECT SUM(rating), AVG(rating), MIN(rating), MAX(rating) FROM emp",
    "SELECT MIN(name), MAX(name) FROM emp",
    "SELECT SUM(salary), AVG(salary), MIN(salary), MAX(salary), COUNT(*), COUNT(salary) FROM emp WHERE id > 100",
    "SELECT SUM(salary), MAX(salary), COUNT(salary), COUNT(*) FROM emp WHERE id = 7",
    "SELECT dept_id, COUNT(*), SUM(salary) FROM emp GROUP BY dept_id",
    "SELECT dept_id, AVG(salary) FROM emp GROUP BY dept_id ORDER BY dept_id",
    "SELECT dept_id, COUNT(*) FROM emp GROUP BY dept_id HAVING COUNT(*) > 1",
    "SELECT dept_id FROM emp GROUP BY dept_id HAVING SUM(salary) >= 160 ORDER BY dept_id",
    "SELECT dept_id, MAX(salary) - MIN(salary), COUNT(*) + 1, SUM(salary) * 2 FROM emp GROUP BY dept_id",
    "SELECT salary, COUNT(*) FROM emp GROUP BY salary ORDER BY COUNT(*) DESC, salary",
    "SELECT dept_id, boss, COUNT(*) FROM emp GROUP BY dept_id, boss",
    "SELECT salary / 50, COUNT(*) FROM emp GROUP BY salary / 50",
    "SELECT dept_id, COUNT(*) FROM emp WHERE salary > 1000 GROUP BY dept_id",
    "SELECT COUNT(*) FROM emp WHERE salary > 1000",
    "SELECT dept_id, SUM(CASE WHEN salary >= 100 THEN 1 ELSE 0 END) FROM emp GROUP BY dept_id",
    "SELECT SUM(salary + 1), SUM(salary) + 1, MAX(salary + rating) FROM emp",
    "SELECT dept_id, COUNT(*) AS n FROM emp GROUP BY dept_id ORDER BY n DESC, dept_id",
    "SELECT COUNT(*), dept_id FROM emp WHERE dept_id IS NOT NULL GROUP BY dept_id HAVING AVG(salary) > 85",
    "SELECT LENGTH(name), COUNT(*) FROM emp GROUP BY LENGTH(name)",
    "SELECT TYPEOF(SUM(salary)), TYPEOF(AVG(salary)), TYPEOF(SUM(rating)), TYPEOF(COUNT(*)) FROM emp",
    "SELECT dept_id, MAX(salary) FROM emp GROUP BY dept_id HAVING dept_id > 1",
    "SELECT AVG(salary), SUM(rating) FROM emp WHERE dept_id = 2",
])

G("join", EMP, [
    "SELECT emp.name, dept.name FROM emp JOIN dept ON emp.dept_id = dept.id ORDER BY emp.id",
    "SELECT e.name, d.name FROM emp e INNER JOIN dept d ON e.dept_id = d.id WHERE d.budget > 500",
    "SELECT e.name, d.name FROM emp e LEFT JOIN dept d ON e.dept_id = d.id ORDER BY e.id",
    "SELECT d.name, e.name FROM dept d LEFT OUTER JOIN emp e ON e.dept_id = d.id ORDER BY d.id, e.id",
    "SELECT d.name FROM dept d LEFT JOIN emp e ON e.dept_id = d.id WHERE e.id IS NULL",
    "SELECT d.name, COUNT(e.id), COUNT(*) FROM dept d LEFT JOIN emp e ON e.dept_id = d.id GROUP BY d.name",
    "SELECT d.id, e.id FROM dept d LEFT JOIN emp e ON e.dept_id = d.id AND e.salary > 90 ORDER BY d.id, e.id",
    "SELECT d.id, e.id FROM dept d LEFT JOIN emp e ON e.dept_id = d.id WHERE e.salary > 90 ORDER BY d.id, e.id",
    "SELECT e.name, b.name FROM emp e JOIN emp b ON e.boss = b.id ORDER BY e.id",
    "SELECT e.name, b.name FROM emp e LEFT JOIN emp b ON e.boss = b.id ORDER BY e.id",
    "SELECT e.name, b.name, d.name FROM emp e JOIN emp b ON e.boss = b.id JOIN dept d ON b.dept_id = d.id ORDER BY e.id",
    "SELECT e.id, b.id, bb.id FROM emp e LEFT JOIN emp b ON e.boss = b.id LEFT JOIN emp bb ON b.boss = bb.id ORDER BY e.id",
    "SELECT COUNT(*) FROM emp, dept",
    "SELECT COUNT(*) FROM emp CROSS JOIN dept",
    "SELECT e.id, d.id FROM emp e, dept d WHERE e.dept_id = d.id AND d.name = 'ops'",
    "SELECT d.name, SUM(e.salary), AVG(e.rating) FROM emp e JOIN dept d ON e.dept_id = d.id GROUP BY d.name HAVING SUM(e.salary) > 100 ORDER BY 2 DESC",
    "SELECT dept.* FROM emp JOIN dept ON emp.dept_id = dept.id WHERE emp.id = 5",
    "SELECT e.*, d.name FROM emp e JOIN dept d ON e.dept_id = d.id WHERE e.id = 2",
    "SELECT * FROM emp e JOIN dept d ON e.dept_id = d.id WHERE e.id = 3",
    "SELECT a.id, b.id FROM emp a JOIN emp b ON a.salary < b.salary WHERE b.id = 2 ORDER BY a.id",
    "!SELECT id FROM emp JOIN dept ON emp.dept_id = dept.id",
    "!SELECT name FROM emp e JOIN dept d ON e.dept_id = d.id",
    "SELECT d.name, t.n FROM dept d JOIN (SELECT dept_id, COUNT(*) AS n FROM emp GROUP BY dept_id) AS t ON t.dept_id = d.id ORDER BY d.id",
    "SELECT x.name FROM (SELECT name, salary FROM emp WHERE salary > 90) x ORDER BY x.salary",
    "SELECT e.name FROM emp e JOIN dept d ON e.dept_id = d.id AND d.name LIKE 'e%'",
])

G("subquery", EMP, [
    "SELECT name FROM emp WHERE dept_id IN (SELECT id FROM dept WHERE budget > 100)",
    "SELECT name FROM emp WHERE dept_id NOT IN (SELECT id FROM dept WHERE budget > 500)",
    "SELECT name FROM dept WHERE id NOT IN (SELECT dept_id FROM emp)",
    "SELECT name FROM dept WHERE id NOT IN (SELECT dept_id FROM emp WHERE dept_id IS NOT NULL)",
    "SELECT name FROM emp WHERE salary > (SELECT AVG(salary) FROM emp)",
    "SELECT name, (SELECT name FROM dept WHERE dept.id = emp.dept_id) FROM emp ORDER BY id",
    "SELECT d.name, (SELECT COUNT(*) FROM emp e WHERE e.dept_id = d.id) FROM dept d ORDER BY d.id",
    "SELECT d.name, (SELECT MAX(salary) FROM emp e WHERE e.dept_id = d.id) FROM dept d ORDER BY d.id",
    "SELECT name FROM dept d WHERE EXISTS (SELECT 1 FROM emp e WHERE e.dept_id = d.id AND e.salary > 90)",
    "SELECT name FROM dept d WHERE NOT EXISTS (SELECT 1 FROM emp e WHERE e.dept_id = d.id)",
    "SELECT name FROM emp e WHERE salary = (SELECT MAX(salary) FROM emp x WHERE x.dept_id = e.dept_id)",
    "SELECT (SELECT name FROM emp WHERE id = 99), (SELECT COUNT(*) FROM emp WHERE id = 99), (SELECT 5)",
    "SELECT name FROM emp WHERE id IN (SELECT boss FROM emp WHERE boss IN (SELECT id FROM emp WHERE dept_id = 1))",
    "SELECT COUNT(*) FROM (SELECT DISTINCT dept_id FROM emp) AS t",
    "SELECT AVG(n) FROM (SELECT COUNT(*) AS n FROM emp GROUP BY dept_id) AS t",
    "SELECT name FROM emp WHERE 3 IN (SELECT id FROM dept) AND id < 3",
    "SELECT name FROM emp WHERE id IN (SELECT id FROM dept WHERE id > 100)",
    "SELECT e.name FROM emp e WHERE (SELECT COUNT(*) FROM emp s WHERE s.boss = e.id) >= 2",
    "SELECT name, salary - (SELECT MIN(salary) FROM emp) FROM emp WHERE salary IS NOT NULL ORDER BY id",
    "SELECT d.id FROM dept d WHERE d.budget > (SELECT SUM(e.salary) FROM emp e WHERE e.dept_id = d.id)",
    "SELECT id, EXISTS (SELECT 1 FROM emp s WHERE s.boss = emp.id) FROM emp ORDER BY id",
])

G("union", EMP, [
    "SELECT id FROM dept UNION SELECT dept_id FROM emp WHERE dept_id IS NOT NULL",
    "SELECT dept_id FROM emp UNION ALL SELECT id FROM dept",
    "SELECT salary FROM emp UNION SELECT salary FROM emp ORDER BY 1",
    "SELECT name FROM dept UNION ALL SELECT name FROM emp WHERE id < 3 ORDER BY name LIMIT 4",
    "SELECT 1, 'a' UNION SELECT 1, 'a' UNION SELECT 2, 'b'",
    "SELECT id, name FROM dept WHERE id = 1 UNION ALL SELECT id, name FROM emp WHERE id = 1 ORDER BY 2 DESC",
    "!SELECT 1, 2 UNION SELECT 1",
])

# ---- changing data
C("write", "insert with a column list, defaults and automatic ids", T + [
    "INSERT INTO t (name) VALUES ('a')", "INSERT INTO t (name, email) VALUES ('b', 'b@x'), ('c', NULL)", "SELECT * FROM t ORDER BY id"])
C("write", "an explicit id, then automatic ids continue after it", T + [
    "INSERT INTO t (id, name) VALUES (10, 'a')", "INSERT INTO t (name) VALUES ('b')",
    "INSERT INTO t VALUES (NULL, 'c', NULL, 2, 3)", "SELECT id, name, score, n FROM t ORDER BY id"])
C("write", "automatic id after deleting the largest", T3 + [
    "DELETE FROM t WHERE id = 3", "INSERT INTO t (name) VALUES ('d')", "SELECT id, name FROM t ORDER BY id"])
C("write", "automatic id after deleting everything", T3 + [
    "DELETE FROM t", "INSERT INTO t (name) VALUES ('d')", "SELECT id, name FROM t"])
C("write", "insert from a select", [
    "CREATE TABLE a (x INTEGER, y TEXT)", "CREATE TABLE b (x INTEGER, y TEXT)",
    "INSERT INTO a VALUES (1,'p'),(2,'q'),(3,'r')", "INSERT INTO b SELECT x * 10, y || '!' FROM a WHERE x > 1",
    "INSERT INTO b (y) SELECT y FROM a WHERE x = 1", "SELECT * FROM b", "INSERT INTO a SELECT * FROM a", "SELECT COUNT(*), SUM(x) FROM a"])
C("write", "update with expressions and a where", T3 + [
    "UPDATE t SET n = n * 2 + 1, score = score + 0.5 WHERE id >= 2", "SELECT id, n, score FROM t ORDER BY id",
    "UPDATE t SET name = name || '!'", "UPDATE t SET n = 0 WHERE id = 99", "SELECT name, n FROM t ORDER BY id"])
C("write", "update reads the old values of the row", [
    "CREATE TABLE p (a INTEGER, b INTEGER)", "INSERT INTO p VALUES (1, 2), (3, 4)", "UPDATE p SET a = b, b = a", "SELECT * FROM p"])
C("write", "update and delete with subqueries", EMP + [
    "UPDATE emp SET salary = (SELECT MAX(salary) FROM emp) WHERE dept_id IN (SELECT id FROM dept WHERE name = 'ops')",
    "SELECT id, salary FROM emp ORDER BY id",
    "DELETE FROM emp WHERE dept_id NOT IN (SELECT id FROM dept WHERE budget IS NOT NULL)", "SELECT id FROM emp",
    "DELETE FROM dept WHERE NOT EXISTS (SELECT 1 FROM emp WHERE emp.dept_id = dept.id)", "SELECT name FROM dept"])
C("write", "delete with a where, then everything", T3 + [
    "DELETE FROM t WHERE email IS NULL OR name = 'a'", "SELECT name FROM t", "DELETE FROM t", "SELECT COUNT(*) FROM t"])
C("write", "text keeps quotes, accents and line breaks", [
    "CREATE TABLE s (v TEXT)", "INSERT INTO s VALUES ('it''s'), ('héllo wörld'), ('line1\nline2'), (''), ('a|b;c')",
    "SELECT v, LENGTH(v) FROM s", "SELECT COUNT(*) FROM s WHERE v = 'it''s'"])
C("write", "a real column stores whole numbers as floats", [
    "CREATE TABLE r (v REAL)", "INSERT INTO r VALUES (1), (2.5), (NULL)", "SELECT v, TYPEOF(v) FROM r",
    "UPDATE r SET v = 4 WHERE v = 2.5", "SELECT v FROM r", "SELECT SUM(v), MAX(v) FROM r"])
C("write", "create if not exists, drop, drop if exists", T + [
    "CREATE TABLE IF NOT EXISTS t (zzz INTEGER)", "INSERT INTO t (name) VALUES ('a')", "SELECT name FROM t",
    "!CREATE TABLE t (a INTEGER)", "DROP TABLE t", "!SELECT * FROM t", "!DROP TABLE t", "DROP TABLE IF EXISTS t",
    "CREATE TABLE t (a INTEGER)", "SELECT * FROM t"])
C("write", "indexes: made, kept right through changes, dropped", EMP + [
    "CREATE INDEX emp_dept ON emp (dept_id)", "CREATE INDEX emp_two ON emp (salary, boss)",
    "CREATE INDEX IF NOT EXISTS emp_dept ON emp (dept_id)", "!CREATE INDEX emp_dept ON emp (salary)",
    "SELECT id FROM emp WHERE dept_id = 2", "UPDATE emp SET dept_id = 2 WHERE id = 1", "SELECT id FROM emp WHERE dept_id = 2",
    "DELETE FROM emp WHERE id = 3", "INSERT INTO emp (name, dept_id, salary) VALUES ('new', 2, 80)",
    "SELECT id FROM emp WHERE dept_id = 2", "SELECT id FROM emp WHERE salary = 80 AND boss = 3", "SELECT id FROM emp WHERE dept_id IS NULL",
    "DROP INDEX emp_dept", "!DROP INDEX emp_dept", "SELECT id FROM emp WHERE dept_id = 2",
    "!CREATE INDEX i2 ON nosuch (x)", "!CREATE INDEX i3 ON emp (nosuch)"])

# ---- constraints and errors
C("error", "a duplicate primary key is rejected", T3 + [
    "!INSERT INTO t (id, name) VALUES (1, 'dup')", "!UPDATE t SET id = 1 WHERE id = 2", "SELECT id, name FROM t ORDER BY id"])
C("error", "NULL in a NOT NULL column is rejected", T3 + [
    "!INSERT INTO t (name) VALUES (NULL)", "!INSERT INTO t (email) VALUES ('e')", "!UPDATE t SET name = NULL WHERE id = 1",
    "SELECT id, name FROM t ORDER BY id"])
C("error", "a duplicate in a UNIQUE column is rejected, several NULLs are fine", T3 + [
    "!INSERT INTO t (name, email) VALUES ('z', 'a@x')", "INSERT INTO t (name, email) VALUES ('d', NULL)",
    "!UPDATE t SET email = 'b@x' WHERE id = 1", "UPDATE t SET email = 'a@x' WHERE id = 1", "SELECT id, email FROM t ORDER BY id"])
C("error", "a failed insert of several rows inserts none", T3 + [
    "!INSERT INTO t (name, email) VALUES ('d', 'd@x'), ('e', 'e@x'), ('f', 'a@x')", "SELECT name FROM t",
    "INSERT INTO t (name) VALUES ('g')", "SELECT id FROM t WHERE name = 'g'"])
C("error", "a failed update changes no row", T3 + ["!UPDATE t SET email = 'same'", "SELECT email FROM t ORDER BY id"])
C("error", "a text primary key", [
    "CREATE TABLE k (code TEXT PRIMARY KEY, v INTEGER)", "INSERT INTO k VALUES ('a', 1), ('b', 2)", "!INSERT INTO k VALUES ('a', 3)",
    "SELECT * FROM k WHERE code = 'b'", "SELECT COUNT(*) FROM k"])
C("error", "the wrong number of values, an unknown column in insert", T + [
    "!INSERT INTO t VALUES (1, 'a')", "!INSERT INTO t (name, email) VALUES ('a')", "!INSERT INTO t (nosuch) VALUES (1)",
    "!INSERT INTO t (name) VALUES ('a', 'b')", "SELECT COUNT(*) FROM t"])
C("error", "an unknown table", T + ["!SELECT * FROM nosuch", "!DELETE FROM nosuch", "!INSERT INTO nosuch VALUES (1)", "!UPDATE nosuch SET a = 1"])
C("error", "an unknown column, even when the table is empty", T + [
    "!SELECT nosuch FROM t", "!SELECT t.nosuch FROM t", "!SELECT x.name FROM t", "!SELECT name FROM t WHERE nosuch = 1"])
C("error", "an unknown column in update, order by and group by", T + [
    "!UPDATE t SET nosuch = 1", "!SELECT name FROM t ORDER BY nosuch", "!SELECT COUNT(*) FROM t GROUP BY nosuch", "!UPDATE t SET n = nosuch"])
C("error", "bad syntax in select", T + ["!SELEC 1", "!SELECT FROM t", "!SELECT 1 +", "!SELECT * FROM t WHERE", "!SELECT (1", "!SELECT * FROM t ORDER"])
C("error", "bad syntax elsewhere", T + [
    "!SELECT 'abc", "!INSERT INTO t VALUES", "!CREATE TABLE (a INTEGER)", "!UPDATE t SET", "!SELECT * FROM t LIMIT", "!DELETE t"])
C("error", "an unknown function, a stray token", T + ["!SELECT NOSUCHFUNC(1)", "!SELECT 1 FROM t t2 t3", "!SELECT 1,", "!SELECT * FROM"])
C("error", "errors leave the data as it was", T3 + [
    "!SELECT nosuch FROM t", "!INSERT INTO t (id, name) VALUES (2, 'x')", "!SELEC", "SELECT id, name, email, score, n FROM t ORDER BY id"])

# ---- transactions
C("transaction", "rollback undoes insert, update and delete", T3 + [
    "BEGIN", "INSERT INTO t (name) VALUES ('d')", "UPDATE t SET n = 99 WHERE id = 1", "DELETE FROM t WHERE id = 2",
    "SELECT id, n FROM t ORDER BY id", "ROLLBACK", "SELECT id, n FROM t ORDER BY id"])
C("transaction", "commit keeps the changes", T3 + [
    "BEGIN", "INSERT INTO t (name) VALUES ('d')", "DELETE FROM t WHERE id = 1", "COMMIT", "SELECT id, name FROM t ORDER BY id",
    "BEGIN", "UPDATE t SET n = 1", "ROLLBACK", "SELECT DISTINCT n FROM t"])
C("transaction", "begin inside a transaction is an error and the transaction stays open", T3 + [
    "BEGIN", "INSERT INTO t (name) VALUES ('d')", "!BEGIN", "INSERT INTO t (name) VALUES ('e')", "ROLLBACK", "SELECT COUNT(*) FROM t"])
C("transaction", "commit and rollback with none open", T + ["!COMMIT", "!ROLLBACK", "BEGIN", "COMMIT", "!COMMIT", "BEGIN", "ROLLBACK", "!ROLLBACK"])
C("transaction", "a failed statement inside a transaction keeps the rest", T3 + [
    "BEGIN", "INSERT INTO t (name) VALUES ('d')", "!INSERT INTO t (id, name) VALUES (1, 'dup')", "!SELECT nosuch FROM t",
    "INSERT INTO t (name) VALUES ('e')", "COMMIT", "SELECT name FROM t ORDER BY id"])
C("transaction", "rollback undoes a created table", [
    "BEGIN", "CREATE TABLE z (a INTEGER)", "INSERT INTO z VALUES (1)", "SELECT * FROM z", "ROLLBACK", "!SELECT * FROM z",
    "CREATE TABLE z (b TEXT)", "INSERT INTO z VALUES ('ok')", "SELECT * FROM z"])
C("transaction", "rollback brings back a dropped table", T3 + [
    "BEGIN", "DROP TABLE t", "!SELECT * FROM t", "ROLLBACK", "SELECT name FROM t ORDER BY id", "!INSERT INTO t (name, email) VALUES ('q', 'a@x')"])
C("transaction", "automatic ids after a rollback", T + [
    "INSERT INTO t (name) VALUES ('a')", "BEGIN", "INSERT INTO t (name) VALUES ('b')", "ROLLBACK",
    "INSERT INTO t (name) VALUES ('c')", "SELECT id, name FROM t ORDER BY id"])
C("transaction", "rollback with an index in place", EMP + [
    "CREATE INDEX emp_dept ON emp (dept_id)", "BEGIN", "UPDATE emp SET dept_id = 4 WHERE dept_id = 1", "DELETE FROM emp WHERE id = 5",
    "SELECT id FROM emp WHERE dept_id = 4", "ROLLBACK", "SELECT id FROM emp WHERE dept_id = 4", "SELECT id FROM emp WHERE dept_id = 1",
    "SELECT id FROM emp WHERE dept_id = 3"])

# ---- speed
def rows_sql(table, rows, per=500):
    return ["INSERT INTO %s VALUES %s" % (table, ",".join(rows[i:i + per])) for i in range(0, len(rows), per)]

AB = (["CREATE TABLE a (id INTEGER PRIMARY KEY, k INTEGER, v INTEGER)", "CREATE TABLE b (id INTEGER PRIMARY KEY, k INTEGER, w INTEGER)"]
      + rows_sql("a", ["(%d,%d,%d)" % (i, (i * 7) % 5000, i % 13) for i in range(1, 5001)])
      + rows_sql("b", ["(%d,%d,%d)" % (i, (i * 11) % 5000, i) for i in range(1, 5001)]))
BIG = (["CREATE TABLE big (id INTEGER PRIMARY KEY, code TEXT, grp INTEGER, val REAL)"]
       + rows_sql("big", ["(%d,'c%d',%d,%s)" % (i, i, (i * 37) % 2000, repr(i * 0.5)) for i in range(1, 20001)])
       + ["CREATE INDEX big_code ON big (code)"])
C("speed", "join of two 5,000-row tables on an equality with no index", [
    "SELECT COUNT(*), SUM(a.v + b.w) FROM a JOIN b ON a.k = b.k",
    "SELECT COUNT(*), COUNT(b.id) FROM a LEFT JOIN b ON a.k = b.k AND b.w > 2500",
    "SELECT a.id, b.id FROM a, b WHERE a.k = b.k AND a.id < 4 ORDER BY a.id"], setup=AB, limit=TIME_LIMIT, alarm=150)
C("speed", "IN (SELECT ...) between two 5,000-row tables", [
    "SELECT COUNT(*) FROM a WHERE k IN (SELECT k FROM b WHERE w > 2500)",
    "SELECT COUNT(*) FROM a WHERE k NOT IN (SELECT k FROM b WHERE w > 2500)"], setup=AB, limit=TIME_LIMIT, alarm=150)
C("speed", "2,000 single-row selects by primary key and by an indexed column",
  ["SELECT val, code FROM big WHERE id = %d" % ((i * 7919) % 20000 + 1) for i in range(1000)]
  + ["SELECT id FROM big WHERE code = 'c%d'" % ((i * 104729) % 20000 + 1) for i in range(1000)], setup=BIG, limit=TIME_LIMIT, alarm=150)
C("speed", "2,000 single-row updates by primary key and by an indexed column",
  ["UPDATE big SET val = val + 1 WHERE id = %d" % ((i * 7919) % 20000 + 1) for i in range(1000)]
  + ["UPDATE big SET grp = grp + 1 WHERE code = 'c%d'" % ((i * 104729) % 20000 + 1) for i in range(1000)]
  + ["SELECT SUM(val), SUM(grp) FROM big"], setup=BIG, limit=TIME_LIMIT, alarm=150)
C("speed", "group by, count distinct and order by with a limit over 20,000 rows", [
    "SELECT grp, COUNT(*), SUM(val), AVG(val), MIN(code) FROM big GROUP BY grp",
    "SELECT grp FROM big GROUP BY grp HAVING COUNT(*) >= 10 ORDER BY grp DESC LIMIT 10",
    "SELECT COUNT(DISTINCT grp), COUNT(DISTINCT code) FROM big",
    "SELECT id FROM big ORDER BY val DESC, id LIMIT 5",
    "SELECT DISTINCT grp FROM big ORDER BY grp LIMIT 3 OFFSET 1000"], setup=BIG, limit=TIME_LIMIT, alarm=150)


# ---------------------------------------------------------------- the answer key
def oracle(case):
    con = sqlite3.connect(":memory:", isolation_level=None)
    want = []
    for s in case["setup"] + case["sql"]:
        bad = s.startswith("!")
        try:
            rows = con.execute(s[1:] if bad else s).fetchall()
        except sqlite3.Error as e:
            if not bad:
                print("BATTERY BUG: SQLite rejects [%s]: %s" % (s[:120], e))
                sys.exit(3)
            want.append("err")
            continue
        if bad:
            print("BATTERY BUG: SQLite accepts [%s]" % s[:120])
            sys.exit(3)
        want.append([list(r) for r in rows])
    con.close()
    return want


def rank(v):
    if v is None:
        return (0, 0)
    if isinstance(v, (int, float)):
        return (1, v)
    return (2, str(v))


def same_value(a, b):
    if type(a) is not type(b):
        return False
    if type(a) is float:
        return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))
    return a == b


def same_rows(want, got, ordered):
    if len(want) != len(got):
        return False
    if not ordered:
        try:
            want = sorted(want, key=lambda r: [rank(v) for v in r])
            got = sorted(got, key=lambda r: [rank(v) if not isinstance(v, dict) else (3, "") for v in r])
        except TypeError:
            return False
    return all(len(w) == len(g) and all(same_value(x, y) for x, y in zip(w, g)) for w, g in zip(want, got))


def short(x):
    s = json.dumps(x, ensure_ascii=False)
    return s if len(s) <= 150 else s[:150] + "..."


def judge(case, want, res):
    """None when the case passes, else why it fails."""
    if res is None:
        return "not run"
    if "fatal" in res:
        return res["fatal"]
    got = res.get("setup", []) + res.get("sql", [])
    stmts = case["setup"] + case["sql"]
    for s, w, g in zip(stmts, want, got):
        text = " ".join(s.lstrip("!").split())[:110]
        if "exc" in g:
            return "[%s] raised %s" % (text, g["exc"])
        if w == "err":
            if "err" not in g:
                return "[%s] should raise SQLError, returned %s" % (text, short(g.get("rows")))
            continue
        if "err" in g:
            return "[%s] raised SQLError, SQLite returns %s" % (text, short(w))
        if not same_rows(w, g["rows"], re.search(r"\bORDER\s+BY\b", s, re.I) is not None):
            return "[%s] returned %s, SQLite returns %s" % (text, short(g["rows"]), short(w))
    if case["limit"] is not None and res.get("secs", 1e9) > case["limit"]:
        return "took %.1f s, the limit is %.0f s" % (res["secs"], case["limit"])
    return None


def run_cases(cases):
    """Run minidb on the cases in child processes; a crash or a hang costs only the case it happened in."""
    results, pending, restarts = {}, list(cases), 0
    work = tempfile.mkdtemp(prefix="minidb-check-")
    while pending and restarts < 8:
        cases_path, out_path = os.path.join(work, "cases%d.json" % restarts), os.path.join(work, "out%d.jsonl" % restarts)
        payload = [{"name": c["name"], "setup": [s.lstrip("!") for s in c["setup"]], "sql": [s.lstrip("!") for s in c["sql"]], "alarm": c["alarm"]} for c in pending]
        json.dump(payload, open(cases_path, "w"))
        open(out_path, "w").close()
        try:
            subprocess.run([sys.executable, os.path.abspath(__file__), "--run", cases_path, out_path],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=420)
        except subprocess.TimeoutExpired:
            pass
        started = None
        for line in open(out_path):
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if "start" in obj:
                started = obj["start"]
            else:
                results[obj["name"]] = obj
        if started is not None and started not in results:
            results[started] = {"name": started, "fatal": "crashed or hung"}
        pending = [c for c in pending if c["name"] not in results]
        if started is None and pending:
            break
        restarts += 1
    return results


# ---------------------------------------------------------------- saving and the command line
def child(code, *args, timeout=90):
    return subprocess.run([sys.executable, "-c", BLOCK + code, *args], capture_output=True, text=True, timeout=timeout)


SESSION = r"""
import json
from minidb import Database, SQLError
path, stmts, hard = sys.argv[1], json.loads(sys.argv[2]), sys.argv[3] == "1"
db = Database(path)
out = []
for s in stmts:
    try:
        out.append([list(r) for r in db.execute(s)])
    except SQLError:
        out.append("ERR")
print(json.dumps(out))
sys.stdout.flush()
if hard:
    os._exit(0)
db.close()
"""


def session(path, stmts, hard=False):
    p = child(SESSION, path, json.dumps(stmts), "1" if hard else "0")
    if p.returncode != 0:
        raise RuntimeError((p.stderr.strip().split("\n") or ["?"])[-1][:120])
    return json.loads(p.stdout.strip().split("\n")[-1])


def strict(a, b):
    if type(a) is not type(b):
        return False
    if isinstance(a, list):
        return len(a) == len(b) and all(strict(x, y) for x, y in zip(a, b))
    return a == b


def cli(db, sql):
    code = "import runpy\nsys.argv = ['minidb', sys.argv[1], sys.argv[2]]\nrunpy.run_module('minidb', run_name='__main__', alter_sys=True)\n"
    p = child(code, db, sql)
    return p.returncode, p.stdout.splitlines(), p.stderr


EXTRA = []
tmp = tempfile.mkdtemp(prefix="minidb-files-")


def extra(group, name):
    def add(fn):
        EXTRA.append((group, "%s: %s" % (group, name), fn))
        return fn
    return add


MAKE = ["CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, v REAL)", "INSERT INTO t VALUES (1, 'a', 1.5), (2, 'it''s', NULL)"]


@extra("saving", "data written without a transaction is there in another process")
def _():
    f = os.path.join(tmp, "a.db")
    session(f, MAKE, hard=True)
    return strict(session(f, ["SELECT * FROM t ORDER BY id"]), [[[1, "a", 1.5], [2, "it's", None]]])


@extra("saving", "a committed transaction is kept, an open one is lost when the program dies")
def _():
    f = os.path.join(tmp, "b.db")
    session(f, MAKE + ["BEGIN", "INSERT INTO t VALUES (3, 'c', 2.0)", "COMMIT", "BEGIN", "INSERT INTO t VALUES (4, 'd', 0.5)",
                       "UPDATE t SET name = 'zzz'", "CREATE TABLE gone (a INTEGER)"], hard=True)
    return strict(session(f, ["SELECT id, name FROM t ORDER BY id", "SELECT * FROM gone"]), [[[1, "a"], [2, "it's"], [3, "c"]], "ERR"])


@extra("saving", "a rollback is not saved")
def _():
    f = os.path.join(tmp, "c.db")
    session(f, MAKE + ["BEGIN", "DELETE FROM t", "DROP TABLE t", "ROLLBACK"])
    return strict(session(f, ["SELECT COUNT(*) FROM t"]), [[[2]]])


@extra("saving", "constraints, defaults and automatic ids survive reopening")
def _():
    f = os.path.join(tmp, "d.db")
    session(f, ["CREATE TABLE u (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL DEFAULT 'none', n INTEGER DEFAULT 7)",
                "INSERT INTO u (email) VALUES ('a')"])
    got = session(f, ["INSERT INTO u (email) VALUES ('b')", "INSERT INTO u (email) VALUES ('a')",
                      "INSERT INTO u (email, name) VALUES ('c', NULL)", "SELECT * FROM u ORDER BY id"])
    return strict(got, [[], "ERR", "ERR", [[1, "a", "none", 7], [2, "b", "none", 7]]])


@extra("saving", "values keep their types and their text")
def _():
    f = os.path.join(tmp, "e.db")
    session(f, ["CREATE TABLE v (i INTEGER, r REAL, s TEXT)",
                "INSERT INTO v VALUES (1, 1.0, '1'), (NULL, 2.5, 'héllo\nwörld | \"x\"'), (-5, NULL, '')"])
    got = session(f, ["SELECT * FROM v ORDER BY r"])
    return strict(got, [[[-5, None, ""], [1, 1.0, "1"], [None, 2.5, "héllo\nwörld | \"x\""]]])


@extra("saving", "a dropped table and deleted rows stay gone, an index still answers")
def _():
    f = os.path.join(tmp, "f.db")
    session(f, MAKE + ["CREATE TABLE x (a INTEGER)", "INSERT INTO x VALUES (1), (2), (3)", "CREATE INDEX t_name ON t (name)",
                       "DROP TABLE x", "DELETE FROM t WHERE id = 1", "INSERT INTO t (name, v) VALUES ('new', 9)"])
    got = session(f, ["SELECT * FROM x", "SELECT id, v FROM t WHERE name = 'new'", "SELECT COUNT(*) FROM t", "CREATE INDEX t_name ON t (v)"])
    return strict(got, ["ERR", [[3, 9.0]], [[2]], "ERR"])


@extra("saving", "a missing file is created, and each file is its own database")
def _():
    f, g = os.path.join(tmp, "g.db"), os.path.join(tmp, "h.db")
    session(f, MAKE)
    return os.path.exists(f) and strict(session(g, ["SELECT * FROM t"]), ["ERR"])


@extra("command line", "rows are printed joined by |, NULL as nothing")
def _():
    code, out, _err = cli(os.path.join(tmp, "cli.db"),
                          "CREATE TABLE t (a INTEGER, b TEXT, c REAL); INSERT INTO t VALUES (1, 'x;y', 2.5), (2, NULL, 3.0); SELECT * FROM t ORDER BY a")
    return code == 0 and out == ["1|x;y|2.5", "2||3.0"]


@extra("command line", "a second call sees the file; several selects print in order; a trailing ; is fine")
def _():
    code, out, _err = cli(os.path.join(tmp, "cli.db"), "SELECT COUNT(*) FROM t; SELECT b, a FROM t WHERE a = 1; SELECT 'a', NULL, 2;")
    return code == 0 and out == ["2", "x;y|1", "a||2"]


@extra("command line", "an error prints Error: to stderr, exits 1, keeps what came before and skips the rest")
def _():
    f = os.path.join(tmp, "cli.db")
    code, out, err = cli(f, "INSERT INTO t VALUES (3, 'z', 1.0); SELECT * FROM nosuch; INSERT INTO t VALUES (4, 'w', 1.0)")
    code2, out2, _ = cli(f, "SELECT a FROM t ORDER BY a")
    return code == 1 and err.startswith("Error:") and "Traceback" not in err and out == [] and code2 == 0 and out2 == ["1", "2", "3"]


@extra("command line", "bad syntax is an error too")
def _():
    code, out, err = cli(os.path.join(tmp, "cli2.db"), "SELEC 1")
    return code == 1 and err.startswith("Error:") and "Traceback" not in err


# ---------------------------------------------------------------- run
def main():
    wants = {c["name"]: oracle(c) for c in CASES}
    only = os.environ.get("MINIDB_ONLY")
    cases = [c for c in CASES if not only or c["group"] == only]
    results = run_cases(cases) if os.path.isdir("minidb") or os.path.exists("minidb.py") else {}
    passed, groups = 0, {}

    def record(group, name, why):
        nonlocal passed
        ok = why is None
        passed += ok
        g = groups.setdefault(group, [0, 0])
        g[0] += ok
        g[1] += 1
        print("PASS " + name if ok else "FAIL %s -- %s" % (name, why))

    for c in cases:
        record(c["group"], c["name"], judge(c, wants[c["name"]], results.get(c["name"])))
    for group, name, fn in EXTRA:
        if only and group != only:
            continue
        try:
            why = None if fn() else "wrong result"
        except subprocess.TimeoutExpired:
            why = "timed out"
        except Exception as e:
            why = ("%s: %s" % (type(e).__name__, e))[:150]
        record(group, name, why)
    total = sum(g[1] for g in groups.values())
    print("GROUPS " + ", ".join("%s %d/%d" % (k, v[0], v[1]) for k, v in groups.items()))
    print("SCORE %d/%d" % (passed, total))
    sys.exit(0 if passed == total else 1)


main()
