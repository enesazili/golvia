-- Apply with db:migrate in a transaction, after the existing auth schema and a backup.
CREATE TABLE IF NOT EXISTS social_friendship (
  user_a text NOT NULL REFERENCES golvia_auth."user"(id) ON DELETE CASCADE,
  user_b text NOT NULL REFERENCES golvia_auth."user"(id) ON DELETE CASCADE,
  requester text NOT NULL REFERENCES golvia_auth."user"(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','accepted','rejected','cancelled','blocked')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_a,user_b), CHECK(user_a COLLATE "C" < user_b COLLATE "C"), CHECK(requester IN (user_a,user_b))
);
CREATE INDEX IF NOT EXISTS social_friendship_recipient ON social_friendship(user_b,status);
CREATE TABLE IF NOT EXISTS social_block (
  blocker text NOT NULL REFERENCES golvia_auth."user"(id) ON DELETE CASCADE,
  blocked text NOT NULL REFERENCES golvia_auth."user"(id) ON DELETE CASCADE,
  PRIMARY KEY(blocker,blocked), CHECK(blocker<>blocked)
);
CREATE INDEX IF NOT EXISTS social_block_target ON social_block(blocked,blocker);
CREATE TABLE IF NOT EXISTS social_invite (
  id text PRIMARY KEY,
  sender text NOT NULL REFERENCES golvia_auth."user"(id) ON DELETE CASCADE,
  recipient text NOT NULL REFERENCES golvia_auth."user"(id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('pending','accepted','rejected','cancelled','expired')),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  match_id text UNIQUE, CHECK(sender<>recipient)
);
CREATE UNIQUE INDEX IF NOT EXISTS social_invite_pending_pair ON social_invite(LEAST(sender COLLATE "C",recipient COLLATE "C"),GREATEST(sender COLLATE "C",recipient COLLATE "C")) WHERE status='pending';
CREATE INDEX IF NOT EXISTS social_invite_sender ON social_invite(sender,status,expires_at);
CREATE INDEX IF NOT EXISTS social_invite_recipient ON social_invite(recipient,status,expires_at);
CREATE INDEX IF NOT EXISTS social_invite_expiry ON social_invite(expires_at) WHERE status='pending' OR(status='accepted' AND match_id IS NULL);
CREATE TABLE IF NOT EXISTS social_match (
  id text PRIMARY KEY,
  user0 text REFERENCES golvia_auth."user"(id) ON DELETE SET NULL,
  user1 text REFERENCES golvia_auth."user"(id) ON DELETE SET NULL,
  status text NOT NULL CHECK(status IN ('active','completed','cancelled')),
  started_at timestamptz NOT NULL, ended_at timestamptz,
  score0 smallint CHECK(score0 BETWEEN 0 AND 3), score1 smallint CHECK(score1 BETWEEN 0 AND 3),
  winner smallint CHECK(winner IN (0,1)), reason text,
  CHECK(user0 IS NULL OR user1 IS NULL OR user0<>user1),
  CHECK(status<>'completed' OR (score0 IS NOT NULL AND score1 IS NOT NULL AND ended_at IS NOT NULL AND reason IS NOT NULL AND reason IN ('finished','forfeit') AND
    ((reason='forfeit' AND winner IS NOT NULL) OR (reason='finished' AND ((score0=score1 AND winner IS NULL) OR (score0>score1 AND winner IS NOT NULL AND winner=0) OR (score1>score0 AND winner IS NOT NULL AND winner=1))))))
);
CREATE INDEX IF NOT EXISTS social_match_user0 ON social_match(user0,started_at DESC);
CREATE INDEX IF NOT EXISTS social_match_user1 ON social_match(user1,started_at DESC);
CREATE TABLE IF NOT EXISTS social_notification (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipient text NOT NULL REFERENCES golvia_auth."user"(id) ON DELETE CASCADE,
  actor text REFERENCES golvia_auth."user"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('request','friend-accepted','invite','invite-accepted','invite-rejected','invite-cancelled')),
  reference text NOT NULL, seen boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recipient,kind,reference)
);
CREATE INDEX IF NOT EXISTS social_notification_recipient ON social_notification(recipient,id DESC);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='golvia_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON social_friendship,social_block,social_invite,social_match,social_notification TO golvia_app;
    GRANT USAGE,SELECT ON SEQUENCE social_notification_id_seq TO golvia_app;
  END IF;
END $$;
