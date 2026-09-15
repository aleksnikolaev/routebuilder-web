-- Corrective migration for the landing functions. 2026-09-15.
--
-- Review of PR #1 showed that the limits in 20260915_landing.sql do not hold
-- under concurrency. Each call counted rows and then inserted, with nothing in
-- between, so parallel calls from one address all saw a count under the limit.
-- Reproduced on plain PostgreSQL (6 requests stored with a limit of 5, 121
-- events with a limit of 120) and on the project itself (121 events).
--
-- Fix: a transaction-scoped advisory lock per function and address hash, taken
-- before counting. Calls from one address run one at a time, and under READ
-- COMMITTED the count after the lock is a new snapshot that sees the row the
-- previous holder committed.
--
-- Also: a retried submission stored the same request twice. The form now sends
-- one id per submission; a repeat returns 'duplicate', does not count against
-- the limit, and the route sends no second notice.
--
-- landing_submit keeps its previous arguments and the new one has a default, so
-- the Worker build already in production keeps working until the new one ships.

ALTER TABLE public.landing_requests ADD COLUMN IF NOT EXISTS submission_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS landing_requests_submission_id
	ON public.landing_requests (submission_id);

DROP FUNCTION IF EXISTS public.landing_submit(text, text, text, text, text, text, text);

CREATE FUNCTION public.landing_submit(
	p_secret text,
	p_name text,
	p_email text,
	p_company text,
	p_message text,
	p_ip_hash text,
	p_user_agent text,
	p_submission_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
	expected text;
	recent int;
	inserted int;
BEGIN
	SELECT decrypted_secret INTO expected FROM vault.decrypted_secrets WHERE name = 'landing_rpc_secret';
	-- Fail closed: a missing secret in Vault rejects every call.
	IF expected IS NULL OR p_secret IS DISTINCT FROM expected THEN
		RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
	END IF;

	-- Held until the transaction ends: count and insert are one step per address.
	PERFORM pg_advisory_xact_lock(hashtext('landing_submit'), hashtext(p_ip_hash));

	IF p_submission_id IS NOT NULL
		AND EXISTS (SELECT 1 FROM landing_requests WHERE submission_id = p_submission_id) THEN
		RETURN 'duplicate';
	END IF;

	SELECT count(*) INTO recent
	FROM landing_requests
	WHERE ip_hash = p_ip_hash AND created_at > now() - interval '1 hour';
	IF recent >= 5 THEN
		RETURN 'rate_limited';
	END IF;

	INSERT INTO landing_requests (name, email, company, message, ip_hash, user_agent, submission_id)
	VALUES (
		btrim(p_name),
		lower(btrim(p_email)),
		nullif(btrim(p_company), ''),
		nullif(btrim(p_message), ''),
		p_ip_hash,
		left(p_user_agent, 400),
		p_submission_id
	)
	-- The same id arriving from another address takes a different lock. The unique
	-- index still keeps a single row, and that call reports a duplicate, not an error.
	ON CONFLICT (submission_id) DO NOTHING;
	GET DIAGNOSTICS inserted = ROW_COUNT;
	RETURN CASE WHEN inserted = 1 THEN 'ok' ELSE 'duplicate' END;
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

	PERFORM pg_advisory_xact_lock(hashtext('landing_track'), hashtext(p_ip_hash));

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

-- The dropped function took its grants with it. Same rule as before: only the
-- role behind the publishable key may call it, and only with the secret.
REVOKE ALL ON FUNCTION public.landing_submit(text, text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.landing_submit(text, text, text, text, text, text, text, uuid) TO anon;

-- The Data API caches function signatures.
NOTIFY pgrst, 'reload schema';
