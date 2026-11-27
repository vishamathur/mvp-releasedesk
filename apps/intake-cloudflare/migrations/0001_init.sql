-- D1 schema for the intake site (binding DB). Replaces the PHP data/ directory.
-- submissions/ -> submissions, finance-*.json -> finance_artifacts, status/ -> status,
-- outbox/ + sent/ + dead/ -> outbox.state, ratelimit/ -> rate_hits, app.log -> events.
-- Times are Unix seconds (UTC). Retention (RETENTION_DAYS, default 30) runs at most hourly from api/intake.php.

CREATE TABLE IF NOT EXISTS submissions (
  request_id TEXT PRIMARY KEY,
  pid        TEXT NOT NULL CHECK (pid IN ('PID-ER', 'PID-NC')),
  card_json  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS submissions_created ON submissions (created_at);

CREATE TABLE IF NOT EXISTS finance_artifacts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id      TEXT NOT NULL,
  assessment_json TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_artifacts_request ON finance_artifacts (request_id);
CREATE INDEX IF NOT EXISTS finance_artifacts_created ON finance_artifacts (created_at);

-- One row per request. tokenHash is sha256(statusToken); the token itself is never stored.
-- version is an optimistic lock for api/lead-update.php (the PHP used flock).
CREATE TABLE IF NOT EXISTS status (
  request_id      TEXT PRIMARY KEY,
  pid             TEXT NOT NULL,
  token_hash      TEXT NOT NULL,
  status          TEXT NOT NULL,
  next_gate_json  TEXT,
  quote_json      TEXT,
  update_ids_json TEXT NOT NULL DEFAULT '[]',
  history_json    TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS status_updated ON status (updated_at);

-- Signed Site -> Lead envelopes. queued -> sent, or dead after 50 attempts.
CREATE TABLE IF NOT EXISTS outbox (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL,
  kind          TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  state         TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'sent', 'dead')),
  last_error    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_state ON outbox (state, updated_at);

-- Sliding-window rate limit. bucket = sha256(name + ":" + client IP); the IP is not stored.
CREATE TABLE IF NOT EXISTS rate_hits (
  bucket TEXT NOT NULL,
  ts     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_hits_bucket_ts ON rate_hits (bucket, ts);

-- IDs, codes and reasons only. Never customer text, keys or signatures.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  event_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_at ON events (at);

-- Throttle markers: last_cleanup (hourly retention), last_drain (outbox retry every 5 minutes).
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
