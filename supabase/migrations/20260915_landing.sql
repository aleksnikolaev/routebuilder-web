-- Landing page requests and contact events. 2026-09-15.
--
-- The site never touches these tables directly. The Worker calls two
-- functions with the publishable key and a shared secret that lives in Vault
-- (landing_rpc_secret) and in the Worker's secrets. The publishable key alone,
-- which any browser can read, is not enough to write anything.
--
-- Visitor IPs are never stored: the Worker hashes them with a salt that only it
-- holds, and the hash is used for rate limiting.

CREATE TABLE IF NOT EXISTS public.landing_requests (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	created_at timestamptz NOT NULL DEFAULT now(),
	name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
	email text NOT NULL CHECK (
		char_length(email) BETWEEN 3 AND 200
		AND email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
	),
	company text CHECK (char_length(company) <= 160),
	message text CHECK (char_length(message) <= 4000),
	ip_hash text NOT NULL CHECK (char_length(ip_hash) = 64),
	user_agent text CHECK (char_length(user_agent) <= 400)
);
ALTER TABLE public.landing_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS landing_requests_ip_created
	ON public.landing_requests (ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS public.landing_events (
	id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	created_at timestamptz NOT NULL DEFAULT now(),
	event text NOT NULL CHECK (event IN ('page_view', 'click_email', 'click_whatsapp', 'click_linkedin')),
	path text CHECK (char_length(path) <= 200),
	ip_hash text NOT NULL CHECK (char_length(ip_hash) = 64)
);
ALTER TABLE public.landing_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS landing_events_ip_created
	ON public.landing_events (ip_hash, created_at DESC);

-- Default privileges in this project grant table access to anon and
-- authenticated. RLS already blocks them; revoking closes the door twice.
REVOKE ALL ON public.landing_requests FROM anon, authenticated;
REVOKE ALL ON public.landing_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.landing_submit(
	p_secret text,
	p_name text,
	p_email text,
	p_company text,
	p_message text,
	p_ip_hash text,
	p_user_agent text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
	expected text;
	recent int;
BEGIN
	SELECT decrypted_secret INTO expected FROM vault.decrypted_secrets WHERE name = 'landing_rpc_secret';
	-- Fail closed: a missing secret in Vault rejects every call.
	IF expected IS NULL OR p_secret IS DISTINCT FROM expected THEN
		RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
	END IF;

	SELECT count(*) INTO recent
	FROM landing_requests
	WHERE ip_hash = p_ip_hash AND created_at > now() - interval '1 hour';
	IF recent >= 5 THEN
		RETURN 'rate_limited';
	END IF;

	INSERT INTO landing_requests (name, email, company, message, ip_hash, user_agent)
	VALUES (
		btrim(p_name),
		lower(btrim(p_email)),
		nullif(btrim(p_company), ''),
		nullif(btrim(p_message), ''),
		p_ip_hash,
		left(p_user_agent, 400)
	);
	RETURN 'ok';
END
$$;

CREATE OR REPLACE FUNCTION public.landing_track(
	p_secret text,
	p_event text,
	p_path text,
	p_ip_hash text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
	expected text;
	recent int;
BEGIN
	SELECT decrypted_secret INTO expected FROM vault.decrypted_secrets WHERE name = 'landing_rpc_secret';
	IF expected IS NULL OR p_secret IS DISTINCT FROM expected THEN
		RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
	END IF;

	SELECT count(*) INTO recent
	FROM landing_events
	WHERE ip_hash = p_ip_hash AND created_at > now() - interval '1 hour';
	IF recent >= 120 THEN
		RETURN 'rate_limited';
	END IF;

	INSERT INTO landing_events (event, path, ip_hash)
	VALUES (p_event, left(p_path, 200), p_ip_hash);
	RETURN 'ok';
END
$$;

-- Functions in public are executable by PUBLIC by default. Only the role behind
-- the publishable key may call these, and only with the secret.
REVOKE ALL ON FUNCTION public.landing_submit(text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.landing_track(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.landing_submit(text, text, text, text, text, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.landing_track(text, text, text, text) TO anon;
