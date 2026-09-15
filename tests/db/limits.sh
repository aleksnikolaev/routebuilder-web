#!/usr/bin/env bash
# Applies the landing migrations to an empty PostgreSQL database and checks that
# the limits and the repeat protection hold when calls arrive at the same time.
#
#   PGURL=postgres://postgres:postgres@localhost:5432/postgres tests/db/limits.sh
#
# Point it only at a throwaway database: it creates roles and truncates tables.
set -euo pipefail
: "${PGURL:?set PGURL to an empty throwaway database}"
cd "$(dirname "$0")/../.."

q() { psql "$PGURL" -v ON_ERROR_STOP=1 -Atq -c "$1"; }
fail=0
expect() {
	if [ "$2" = "$3" ]; then echo "OK   $1"; else echo "FAIL $1: expected $3, got $2"; fail=1; fi
}
hash64() { printf "%.0s$1" $(seq 64); }

psql "$PGURL" -v ON_ERROR_STOP=1 -q -f tests/db/supabase_stubs.sql
for migration in supabase/migrations/*.sql; do
	psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$migration"
done

REQ=$(hash64 a); EV=$(hash64 e); DUP=$(hash64 d); OLD=$(hash64 o); CROSS1=$(hash64 x); CROSS2=$(hash64 y)

# Four requests and 118 events already in the window, then 16 concurrent calls
# each: exactly one request and two events may get through. Several rounds,
# because a race does not show on every run.
for round in 1 2 3 4 5; do
	q "TRUNCATE landing_requests, landing_events"
	q "INSERT INTO landing_requests (name, email, ip_hash) SELECT 'Race', 'race@example.com', '$REQ' FROM generate_series(1, 4)"
	q "INSERT INTO landing_events (event, path, ip_hash) SELECT 'page_view', '/', '$EV' FROM generate_series(1, 118)"
	out=$(mktemp -d)
	for i in $(seq 16); do
		q "SELECT landing_submit('test-secret', 'Race', 'race@example.com', '', '', '$REQ', 'test')" > "$out/r$i" &
		q "SELECT landing_track('test-secret', 'page_view', '/', '$EV')" > "$out/e$i" &
	done
	wait
	expect "round $round: requests stored" "$(q "SELECT count(*) FROM landing_requests WHERE ip_hash = '$REQ'")" 5
	expect "round $round: requests accepted" "$(cat "$out"/r* | grep -c '^ok$' || true)" 1
	expect "round $round: events stored" "$(q "SELECT count(*) FROM landing_events WHERE ip_hash = '$EV'")" 120
	expect "round $round: events accepted" "$(cat "$out"/e* | grep -c '^ok$' || true)" 2
	rm -rf "$out"
done

q "TRUNCATE landing_requests"
ID=11111111-2222-4333-8444-555555555555
expect "first submission" "$(q "SELECT landing_submit('test-secret', 'Dup', 'dup@example.com', '', '', '$DUP', 'test', '$ID')")" ok
expect "repeated submission" "$(q "SELECT landing_submit('test-secret', 'Dup', 'dup@example.com', '', '', '$DUP', 'test', '$ID')")" duplicate
expect "repeated submission stored once" "$(q "SELECT count(*) FROM landing_requests WHERE submission_id = '$ID'")" 1

# The same id from two addresses at once: different locks, still one row, no error.
ID2=22222222-3333-4444-8555-666666666666
out=$(mktemp -d)
for i in $(seq 8); do
	h=$CROSS1; [ $((i % 2)) -eq 0 ] && h=$CROSS2
	q "SELECT landing_submit('test-secret', 'Cross', 'cross@example.com', '', '', '$h', 'test', '$ID2')" > "$out/c$i" 2>&1 &
done
wait
expect "same id from two addresses stored once" "$(q "SELECT count(*) FROM landing_requests WHERE submission_id = '$ID2'")" 1
expect "same id from two addresses: one ok, the rest duplicate" "$(sort "$out"/c* | uniq -c | awk '{print $2"="$1}' | sort | tr '\n' ' ')" "duplicate=7 ok=1 "
rm -rf "$out"

# The build already in production calls without a submission id.
expect "call without submission id" "$(q "SELECT landing_submit('test-secret', 'Old', 'old@example.com', '', '', '$OLD', 'test')")" ok

if q "SELECT landing_submit('wrong', 'x', 'x@example.com', '', '', '$DUP', 'test')" > /dev/null 2>&1; then
	echo "FAIL wrong secret accepted"; fail=1
else
	echo "OK   wrong secret rejected"
fi

exit $fail
