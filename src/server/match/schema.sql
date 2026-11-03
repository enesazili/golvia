-- Match lifecycle journal. Game state itself remains in the owning process; see matchJournal.ts.
CREATE TABLE IF NOT EXISTS golvia_match (
  id text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('practice','versus')),
  instance_id text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  close_reason text
);

CREATE INDEX IF NOT EXISTS golvia_match_open ON golvia_match (mode, closed_at) WHERE closed_at IS NULL;

-- The runtime application role may record lifecycle changes but cannot delete matches.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'golvia_app') THEN
    GRANT SELECT, INSERT, UPDATE ON golvia_match TO golvia_app;
  END IF;
END $$;
