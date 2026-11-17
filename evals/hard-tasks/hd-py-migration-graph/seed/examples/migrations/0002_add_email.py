def up(conn):
    conn.execute("ALTER TABLE users ADD COLUMN email TEXT")


def down(conn):
    conn.execute("ALTER TABLE users DROP COLUMN email")
