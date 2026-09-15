-- Stand-ins for what Supabase provides, so the landing migrations run on plain
-- PostgreSQL in CI and locally. Not applied anywhere else.

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS vault;
CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (
	name text PRIMARY KEY,
	decrypted_secret text NOT NULL
);
INSERT INTO vault.decrypted_secrets VALUES ('landing_rpc_secret', 'test-secret')
ON CONFLICT (name) DO NOTHING;
