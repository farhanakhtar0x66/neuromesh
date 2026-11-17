def up(conn):
    conn.execute("CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, body TEXT)")


def down(conn):
    conn.execute("DROP TABLE posts")
