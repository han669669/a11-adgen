-- Phase 1: web app accounts (email + password, allow-listed) and sessions.
CREATE TABLE users (
  email TEXT PRIMARY KEY,          -- lower case
  pw_hash TEXT NOT NULL,           -- pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>
  created_at TEXT NOT NULL
);

-- Only the SHA-256 of a session token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES users(email),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_email ON sessions(email);

-- Failed sign-ins, for a simple lock-out (5 in 15 minutes per email).
CREATE TABLE login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX login_failures_email ON login_failures(email, at);

-- The composed final (real logo + grain) for a final render, made when the board sees it finish.
ALTER TABLE renders ADD COLUMN composed_key TEXT;
