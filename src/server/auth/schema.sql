-- Initial Better Auth 1.7.15 + username schema. Apply only after a database backup.
CREATE SCHEMA IF NOT EXISTS golvia_auth;
CREATE TABLE IF NOT EXISTS golvia_auth."user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false, image text,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
  username text UNIQUE, "displayUsername" text, status text NOT NULL DEFAULT 'active'
);
ALTER TABLE golvia_auth."user" ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE golvia_auth."user" ADD COLUMN IF NOT EXISTS "termsVersion" text;
ALTER TABLE golvia_auth."user" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" timestamptz;
-- Do not merge or discard legacy case variants. A collision aborts the migration for review.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM golvia_auth."user" GROUP BY lower(btrim(email) COLLATE "C") HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Email normalization collision; resolve existing accounts before migration';
  END IF;
END $$;
UPDATE golvia_auth."user" SET email=lower(btrim(email) COLLATE "C") WHERE email<>lower(btrim(email) COLLATE "C");
DROP INDEX IF EXISTS golvia_auth.user_normalized_email_unique;
CREATE UNIQUE INDEX user_normalized_email_unique ON golvia_auth."user" (lower(btrim(email) COLLATE "C"));
CREATE TABLE IF NOT EXISTS golvia_auth.email_verification (
  digest text PRIMARY KEY, user_id text NOT NULL,
  expires_at timestamptz NOT NULL
);
-- Mail is prepared while Better Auth's user transaction is still uncommitted.
ALTER TABLE golvia_auth.email_verification DROP CONSTRAINT IF EXISTS email_verification_user_id_fkey;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='golvia_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON golvia_auth.email_verification TO golvia_app;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS golvia_auth.session (
  id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
  "ipAddress" text, "userAgent" text,
  "userId" text NOT NULL REFERENCES golvia_auth."user"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS golvia_auth.account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES golvia_auth."user"(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
  scope text, password text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS golvia_auth.verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
  "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS session_user_id_idx ON golvia_auth.session("userId");
CREATE INDEX IF NOT EXISTS account_user_id_idx ON golvia_auth.account("userId");
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON golvia_auth.verification(identifier);
