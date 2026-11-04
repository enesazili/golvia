CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS football_source (
  id text PRIMARY KEY, url text NOT NULL, license text NOT NULL CHECK (license IN ('CC0-1.0','reference-only')), retrieved date NOT NULL
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
