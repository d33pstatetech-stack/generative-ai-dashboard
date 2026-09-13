CREATE TABLE IF NOT EXISTS balance_cache (
  provider TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS manual_balances (
  provider TEXT PRIMARY KEY,
  value REAL,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
