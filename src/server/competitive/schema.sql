-- Account IDs are retained as opaque identifiers after account deletion. Public queries join
-- active accounts; no email or session credentials are copied into match history.
CREATE TABLE IF NOT EXISTS competitive_rating (
  user_id text NOT NULL, mode text NOT NULL,
  elo integer NOT NULL DEFAULT 1000 CHECK (elo >= 0),
  wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses integer NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws integer NOT NULL DEFAULT 0 CHECK (draws >= 0),
  PRIMARY KEY (user_id, mode)
);
CREATE INDEX IF NOT EXISTS competitive_rating_board ON competitive_rating(mode, elo DESC, user_id);
CREATE TABLE IF NOT EXISTS competitive_match (
  id text PRIMARY KEY, mode text NOT NULL CHECK (mode = '3-2-1'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  started_at timestamptz NOT NULL, ended_at timestamptz,
  score0 integer CHECK (score0 BETWEEN 0 AND 3), score1 integer CHECK (score1 BETWEEN 0 AND 3),
  winner smallint CHECK (winner IN (0,1)), reason text,
  CHECK (status = 'active' OR (ended_at IS NOT NULL AND ended_at >= started_at)),
  CONSTRAINT competitive_match_result_check CHECK (status <> 'completed' OR (score0 IS NOT NULL AND score1 IS NOT NULL AND reason IS NOT NULL
    AND ((reason = 'forfeit' AND winner IS NOT NULL) OR (reason = 'finished' AND ((score0 = score1 AND winner IS NULL) OR (score0 > score1 AND winner IS NOT NULL AND winner = 0) OR (score1 > score0 AND winner IS NOT NULL AND winner = 1))))))
);
-- Replace the unnamed 1.0 result check on existing installations; keep this migration repeatable.
DO $$ DECLARE old_name text; BEGIN
  SELECT conname INTO old_name FROM pg_constraint
  WHERE conrelid = 'competitive_match'::regclass AND contype = 'c'
    AND conname <> 'competitive_match_result_check'
    AND pg_get_constraintdef(oid) LIKE '%reason%finished%' LIMIT 1;
  IF old_name IS NOT NULL THEN EXECUTE format('ALTER TABLE competitive_match DROP CONSTRAINT %I', old_name); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'competitive_match'::regclass AND conname = 'competitive_match_result_check') THEN
    ALTER TABLE competitive_match ADD CONSTRAINT competitive_match_result_check CHECK (status <> 'completed' OR (score0 IS NOT NULL AND score1 IS NOT NULL AND reason IS NOT NULL
      AND ((reason = 'forfeit' AND winner IS NOT NULL) OR (reason = 'finished' AND ((score0 = score1 AND winner IS NULL) OR (score0 > score1 AND winner IS NOT NULL AND winner = 0) OR (score1 > score0 AND winner IS NOT NULL AND winner = 1))))));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS competitive_participant (
  match_id text NOT NULL REFERENCES competitive_match(id), seat smallint NOT NULL CHECK (seat IN (0,1)),
  user_id text NOT NULL, active boolean NOT NULL DEFAULT true,
  elo_before integer CHECK (elo_before >= 0), elo_after integer CHECK (elo_after >= 0),
  PRIMARY KEY (match_id, seat), UNIQUE (match_id, user_id)
);
-- One account cannot be in two active ranked matches, even through different sockets.
CREATE UNIQUE INDEX IF NOT EXISTS competitive_one_active ON competitive_participant(user_id) WHERE active;
CREATE INDEX IF NOT EXISTS competitive_history ON competitive_participant(user_id, match_id);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'golvia_app') THEN
    GRANT SELECT, INSERT, UPDATE ON competitive_rating, competitive_match, competitive_participant TO golvia_app;
  END IF;
END $$;
