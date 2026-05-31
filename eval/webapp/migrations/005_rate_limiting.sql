CREATE TABLE IF NOT EXISTS rate_limit_requests (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rate_limit_requests_lookup_idx
  ON rate_limit_requests (key, category, created_at DESC);
