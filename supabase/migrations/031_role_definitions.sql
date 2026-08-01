-- Canonical role registry. Replaces the users.role CHECK constraint (which
-- silently duplicated its allowed-values list in every consumer, including
-- coreflow-shell's separate repo) with a real table + foreign key, so
-- "what roles exist" has exactly one source of truth that other apps/repos
-- can query live instead of hardcoding a copy.

CREATE TABLE IF NOT EXISTS role_definitions (
  role        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO role_definitions (role, label, sort_order) VALUES
  ('admin',                'Admin',                10),
  ('document_controller',  'Document Controller',  20),
  ('reviewer',             'Reviewer',             30),
  ('engineering_manager',  'Engineering Manager',  40),
  ('manager',              'Manager',              45),
  ('project_manager',      'Project Manager',      50),
  ('vendor',               'Vendor',               60),
  ('developer',            'Developer',            70)
ON CONFLICT (role) DO NOTHING;

-- Swap the CHECK constraint for a foreign key against the new table — adding
-- a role from here on is one INSERT, not a constraint rewrite in every repo.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_fkey FOREIGN KEY (role) REFERENCES role_definitions(role);

ALTER TABLE role_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can read role_definitions"
  ON role_definitions FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "developers can manage role_definitions"
  ON role_definitions FOR ALL
  USING (
    EXISTS (SELECT 1 FROM users WHERE auth_user_id = auth.uid() AND role = 'developer')
  );
