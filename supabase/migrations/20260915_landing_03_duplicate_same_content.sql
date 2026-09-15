-- Corrective migration for landing_submit. 2026-09-15.
--
-- Second review of PR #1: a repeat was recognised by submission id alone. When
-- the first attempt was stored but its answer was lost, and the visitor then
-- fixed the email and sent again with the same id, the call answered
-- 'duplicate', the form reported success, and the correction was lost.
--
-- Now a known id is a repeat only when the content matches what is stored,
-- compared after the same normalisation the insert applies. Different content
-- under a known id returns 'conflict' and stores nothing; the route answers 409
-- and the form sends the request again as a new submission. The form also starts
-- a new id by itself whenever the content changes, so this is the second line.
--
-- Same arguments as before: grants and the production build are unaffected.

CREATE OR REPLACE FUNCTION public.landing_submit(
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
	same_content boolean;
BEGIN
	SELECT decrypted_secret INTO expected FROM vault.decrypted_secrets WHERE name = 'landing_rpc_secret';
	-- Fail closed: a missing secret in Vault rejects every call.
	IF expected IS NULL OR p_secret IS DISTINCT FROM expected THEN
		RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
	END IF;

	-- Held until the transaction ends: count and insert are one step per address.
	PERFORM pg_advisory_xact_lock(hashtext('landing_submit'), hashtext(p_ip_hash));

	IF p_submission_id IS NOT NULL THEN
		SELECT r.name = btrim(p_name)
			AND r.email = lower(btrim(p_email))
			AND r.company IS NOT DISTINCT FROM nullif(btrim(p_company), '')
			AND r.message IS NOT DISTINCT FROM nullif(btrim(p_message), '')
		INTO same_content
		FROM landing_requests r
		WHERE r.submission_id = p_submission_id;
		IF FOUND THEN
			RETURN CASE WHEN same_content THEN 'duplicate' ELSE 'conflict' END;
		END IF;
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
	-- index keeps a single row; the losing call is judged below like any repeat.
	ON CONFLICT (submission_id) DO NOTHING;
	GET DIAGNOSTICS inserted = ROW_COUNT;
	IF inserted = 1 THEN
		RETURN 'ok';
	END IF;

	-- Under READ COMMITTED this statement sees the row the other call committed.
	SELECT r.name = btrim(p_name)
		AND r.email = lower(btrim(p_email))
		AND r.company IS NOT DISTINCT FROM nullif(btrim(p_company), '')
		AND r.message IS NOT DISTINCT FROM nullif(btrim(p_message), '')
	INTO same_content
	FROM landing_requests r
	WHERE r.submission_id = p_submission_id;
	RETURN CASE WHEN same_content THEN 'duplicate' ELSE 'conflict' END;
END
$$;

NOTIFY pgrst, 'reload schema';
