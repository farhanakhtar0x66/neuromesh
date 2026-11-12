CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  received TEXT NOT NULL,
  install TEXT NOT NULL,
  type TEXT NOT NULL,
  version TEXT,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_received ON reports (received);
