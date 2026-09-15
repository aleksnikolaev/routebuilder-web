import assert from "node:assert/strict";
import { test } from "node:test";
import { handleEvent, handleLead } from "../lib/server/handlers.ts";

const ORIGIN = "https://site.test";
const valid = { name: "Ann", email: "ann@example.com", company: "Co", message: "Hello" };

function post(path, body, headers = {}) {
	return new Request(ORIGIN + path, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

function leadDeps({ submit = async () => "ok", notify = async () => ({ sent: true, id: "m1" }) } = {}) {
	const calls = { submit: [], notify: [], logs: [] };
	return {
		calls,
		deps: {
			submit: async (args) => {
				calls.submit.push(args);
				return submit(args);
			},
			notify: async (lead) => {
				calls.notify.push(lead);
				return notify(lead);
			},
			ipHash: async () => "h".repeat(64),
			log: (message, detail) => calls.logs.push([message, detail]),
		},
	};
}

test("stored request answers 200 and sends one notice", async () => {
	const { calls, deps } = leadDeps();
	const res = await handleLead(post("/api/lead", valid), deps);
	assert.equal(res.status, 200);
	assert.equal(calls.submit.length, 1);
	assert.equal(calls.notify.length, 1);
});

test("a notice that throws does not turn a stored request into an error", async () => {
	const { calls, deps } = leadDeps({
		notify: async () => {
			throw new Error("connection reset while reading the body");
		},
	});
	const res = await handleLead(post("/api/lead", valid), deps);
	assert.equal(res.status, 200);
	assert.equal(calls.submit.length, 1);
	assert.match(calls.logs[0][0], /notification threw/);
});

test("a notice that reports failure is logged and the visitor still gets 200", async () => {
	const { calls, deps } = leadDeps({ notify: async () => ({ sent: false, reason: "timed out after 5000 ms" }) });
	const res = await handleLead(post("/api/lead", valid), deps);
	assert.equal(res.status, 200);
	assert.deepEqual(calls.logs[0], ["lead stored, notification not sent:", "timed out after 5000 ms"]);
});

test("a repeated submission answers 200 without a second notice", async () => {
	const { calls, deps } = leadDeps({ submit: async () => "duplicate" });
	const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
	const res = await handleLead(post("/api/lead", { ...valid, submission_id: id }), deps);
	assert.equal(res.status, 200);
	assert.equal(calls.submit[0].p_submission_id, id);
	assert.equal(calls.notify.length, 0);
});

test("a request without a submission id does not pass one to storage", async () => {
	const { calls, deps } = leadDeps();
	await handleLead(post("/api/lead", valid), deps);
	assert.equal("p_submission_id" in calls.submit[0], false);
});

test("a malformed submission id is rejected before storage", async () => {
	const { calls, deps } = leadDeps();
	for (const submission_id of ["not-a-uuid", 42, null]) {
		const res = await handleLead(post("/api/lead", { ...valid, submission_id }), deps);
		assert.equal(res.status, 400, JSON.stringify(submission_id));
	}
	assert.equal(calls.submit.length, 0);
});

test("rate limited answers 429 without a notice", async () => {
	const { calls, deps } = leadDeps({ submit: async () => "rate_limited" });
	const res = await handleLead(post("/api/lead", valid), deps);
	assert.equal(res.status, 429);
	assert.equal(calls.notify.length, 0);
});

test("storage failure answers 503 without a notice", async () => {
	const { calls, deps } = leadDeps({
		submit: async () => {
			throw new Error("HTTP 500");
		},
	});
	const res = await handleLead(post("/api/lead", valid), deps);
	assert.equal(res.status, 503);
	assert.equal(calls.notify.length, 0);
});

test("JSON null, arrays and bare values are rejected with 400", async () => {
	const { calls, deps } = leadDeps();
	for (const body of ["null", "[]", "42", '"text"', "{not json"]) {
		const res = await handleLead(post("/api/lead", body), deps);
		assert.equal(res.status, 400, body);
	}
	assert.equal(calls.submit.length, 0);
});

test("invalid fields, foreign origin and the honeypot never reach storage", async () => {
	const { calls, deps } = leadDeps();
	assert.equal((await handleLead(post("/api/lead", { ...valid, email: "nope" }), deps)).status, 400);
	assert.equal((await handleLead(post("/api/lead", valid, { Origin: "https://evil.test" }), deps)).status, 403);
	assert.equal((await handleLead(post("/api/lead", { ...valid, website: "http://spam" }), deps)).status, 200);
	assert.equal(calls.submit.length, 0);
});

function eventDeps(track = async () => "ok") {
	const calls = { track: [] };
	return {
		calls,
		deps: {
			track: async (args) => {
				calls.track.push(args);
				return track(args);
			},
			ipHash: async () => "h".repeat(64),
			log: () => {},
		},
	};
}

test("event: JSON null, arrays and unknown events are rejected with 400", async () => {
	const { calls, deps } = eventDeps();
	for (const body of ["null", "[]", '{"event":"hack"}', "{not json"]) {
		const res = await handleEvent(post("/api/event", body), deps);
		assert.equal(res.status, 400, body);
	}
	assert.equal(calls.track.length, 0);
});

test("event: known event is stored, limits and failures map to 429 and 503", async () => {
	assert.equal((await handleEvent(post("/api/event", { event: "click_email", path: "/" }), eventDeps().deps)).status, 204);
	assert.equal((await handleEvent(post("/api/event", { event: "page_view" }), eventDeps(async () => "rate_limited").deps)).status, 429);
	const failing = eventDeps(async () => {
		throw new Error("down");
	});
	assert.equal((await handleEvent(post("/api/event", { event: "page_view" }), failing.deps)).status, 503);
});
