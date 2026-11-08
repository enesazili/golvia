CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS football_source (
  id text PRIMARY KEY, url text NOT NULL, license text NOT NULL CHECK (license IN ('CC0-1.0','reference-only')), retrieved date NOT NULL,
  usage_permission text NOT NULL DEFAULT 'unresolved' CHECK (usage_permission IN ('cleared','unresolved','blocked'))
);
-- Live-usage permission is a separate decision from the dataset licence. A source
-- without a cleared row never reaches football_link, even if a career is verified.
CREATE TABLE IF NOT EXISTS football_source_clearance (
  source_id text PRIMARY KEY REFERENCES football_source(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('cleared','unresolved','blocked')),
  basis text NOT NULL, evidence text NOT NULL,
  reviewed_by text NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE football_source ADD COLUMN IF NOT EXISTS usage_permission text NOT NULL DEFAULT 'unresolved';
ALTER TABLE football_source DROP CONSTRAINT IF EXISTS football_source_usage_permission_check;
ALTER TABLE football_source ADD CONSTRAINT football_source_usage_permission_check
  CHECK (usage_permission IN ('cleared','unresolved','blocked'));
-- CC0 datasets with no upstream restriction are cleared; Transfermarkt sources stay
-- unresolved because its site terms still require separate legal approval.
UPDATE football_source SET usage_permission='cleared' WHERE license='CC0-1.0' AND id NOT LIKE 'tm-%';
UPDATE football_source SET usage_permission='unresolved' WHERE id LIKE 'tm-%';
INSERT INTO football_source_clearance(source_id,status,basis,evidence,reviewed_by)
  SELECT id,'cleared','CC0-1.0','CC0-1.0 dedication (migration backfill)','system:migration'
  FROM football_source WHERE license='CC0-1.0' AND id NOT LIKE 'tm-%'
  ON CONFLICT(source_id) DO NOTHING;
INSERT INTO football_source_clearance(source_id,status,basis,evidence,reviewed_by)
  SELECT id,'unresolved','site-terms','Transfermarkt site terms require separate legal approval','system:migration'
  FROM football_source WHERE id LIKE 'tm-%'
  ON CONFLICT(source_id) DO NOTHING;
CREATE TABLE IF NOT EXISTS football_publish_batch (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id text NOT NULL REFERENCES football_source(id),
  career_ids text[] NOT NULL,
  career_count integer NOT NULL CHECK (career_count >= 0),
  published_by text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}',
  published_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz
);
CREATE TABLE IF NOT EXISTS football_entity (
  id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('player','club','country','national_team')),
  name text NOT NULL, country_id text REFERENCES football_entity(id) DEFERRABLE INITIALLY DEFERRED,
  birth_date date, level text CHECK (level IN ('senior','youth','unknown')), mark text NOT NULL DEFAULT '',
  source_id text NOT NULL REFERENCES football_source(id)
);
CREATE TABLE IF NOT EXISTS football_alias (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, entity_id text NOT NULL REFERENCES football_entity(id) ON DELETE CASCADE,
  label text NOT NULL, search_key text NOT NULL, UNIQUE(entity_id, label)
);
CREATE INDEX IF NOT EXISTS football_alias_prefix ON football_alias(search_key text_pattern_ops);
CREATE INDEX IF NOT EXISTS football_alias_substring ON football_alias USING gin(search_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS football_entity_kind ON football_entity(kind);
ALTER TABLE football_entity DROP CONSTRAINT IF EXISTS football_entity_level_check;
ALTER TABLE football_entity ADD CONSTRAINT football_entity_level_check CHECK (level IN ('senior','youth','unknown'));
CREATE TABLE IF NOT EXISTS football_career (
  id text PRIMARY KEY, player_id text NOT NULL REFERENCES football_entity(id), team_id text NOT NULL REFERENCES football_entity(id),
  from_year integer, to_year integer, appeared boolean NOT NULL, verified boolean NOT NULL,
  source_id text NOT NULL REFERENCES football_source(id), evidence_id text NOT NULL REFERENCES football_source(id),
  CHECK(from_year IS NULL OR from_year BETWEEN 1800 AND 2200),
  CHECK(to_year IS NULL OR to_year BETWEEN 1800 AND 2200),
  CHECK(from_year IS NULL OR to_year IS NULL OR from_year <= to_year)
);
CREATE INDEX IF NOT EXISTS football_career_player_team ON football_career(player_id,team_id);
CREATE INDEX IF NOT EXISTS football_career_playable_team_player ON football_career(team_id,player_id) WHERE verified AND appeared;
CREATE INDEX IF NOT EXISTS football_career_source ON football_career(source_id);
ALTER TABLE football_career ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS football_dataset (id integer PRIMARY KEY CHECK(id=1), version text NOT NULL);
CREATE TABLE IF NOT EXISTS football_import_batch (
  checksum text PRIMARY KEY, version text NOT NULL, origin text NOT NULL CHECK (origin IN ('reviewed','wikidata-candidates')),
  entity_count integer NOT NULL CHECK(entity_count >= 0), career_count integer NOT NULL CHECK(career_count >= 0),
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE VIEW football_link AS
 SELECT DISTINCT c.player_id, CASE WHEN t.kind='national_team' THEN t.country_id ELSE t.id END AS selection_id
 FROM football_career c JOIN football_entity t ON t.id=c.team_id
 JOIN football_source fs ON fs.id=c.source_id AND fs.license='CC0-1.0'
 JOIN football_source_clearance s ON s.source_id=c.source_id AND s.status='cleared'
 WHERE c.verified AND c.appeared AND t.level='senior' AND t.kind IN ('club','national_team');

CREATE TABLE IF NOT EXISTS football_review (
  career_id text PRIMARY KEY REFERENCES football_career(id),
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','hold')),
  reason text NOT NULL DEFAULT '', evidence jsonb,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS football_review_status ON football_review(status,updated_at);
CREATE TABLE IF NOT EXISTS football_review_event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  career_id text NOT NULL REFERENCES football_career(id),
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','hold')),
  reason text NOT NULL, evidence jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE football_review_event ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'decision';
ALTER TABLE football_review_event ADD COLUMN IF NOT EXISTS actor text NOT NULL DEFAULT 'unknown';
ALTER TABLE football_review_event ADD COLUMN IF NOT EXISTS request_id text;
CREATE INDEX IF NOT EXISTS football_review_event_career ON football_review_event(career_id,id DESC);
-- Transfermarkt candidates are imported next to, never over, reviewed careers.
ALTER TABLE football_import_batch DROP CONSTRAINT IF EXISTS football_import_batch_origin_check;
ALTER TABLE football_import_batch ADD CONSTRAINT football_import_batch_origin_check
  CHECK (origin IN ('reviewed','wikidata-candidates','transfermarkt-candidates','wikidata-appearances'));
CREATE TABLE IF NOT EXISTS football_transfer (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES football_entity(id),
  from_team_id text REFERENCES football_entity(id),
  to_team_id text REFERENCES football_entity(id),
  from_team_name text NOT NULL DEFAULT '',
  to_team_name text NOT NULL DEFAULT '',
  transfer_date date,
  season text,
  fee_eur numeric,
  market_value_eur numeric,
  source_id text NOT NULL REFERENCES football_source(id),
  provenance jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS football_transfer_player ON football_transfer(player_id, transfer_date);
CREATE TABLE IF NOT EXISTS football_identity_link (
  source_key text NOT NULL, external_id text NOT NULL,
  entity_id text NOT NULL REFERENCES football_entity(id),
  method text NOT NULL CHECK (method IN ('name+birthdate','name+country','name-exact','name-map','manual')),
  status text NOT NULL CHECK (status IN ('pending','confirmed')),
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_key, external_id)
);
CREATE INDEX IF NOT EXISTS football_identity_link_entity ON football_identity_link(entity_id);
