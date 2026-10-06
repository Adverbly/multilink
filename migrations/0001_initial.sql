-- Paid subdomains and their branding.
CREATE TABLE sites (
  name TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT '',
  logo TEXT,
  show_make_own INTEGER NOT NULL DEFAULT 1,
  claim_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Owner public keys. Labels are private to the owner.
CREATE TABLE owner_keys (
  site TEXT NOT NULL REFERENCES sites (name),
  id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (site, id)
);

-- Checkouts. A subdomain has at most one pending claim at a time.
CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  public_key TEXT NOT NULL,
  key_label TEXT NOT NULL DEFAULT '',
  session_id TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX claims_one_pending ON claims (site) WHERE status = 'pending';

-- Single-use "forgot key" links. Only a hash of each token is stored.
CREATE TABLE recovery_tokens (
  token_hash TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- Recent "forgot key" requests, kept for a day for rate limiting.
CREATE TABLE recovery_requests (
  site TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX recovery_requests_by_time ON recovery_requests (created_at);
