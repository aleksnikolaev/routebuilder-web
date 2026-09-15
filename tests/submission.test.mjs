import assert from "node:assert/strict";
import { test } from "node:test";
import { contentKey, submitLead } from "../lib/client/submission.ts";

// Behaves like the API and the database together: a known id with the same
// content is a repeat (200), with other content a conflict (409). It can store a
// request and then lose the answer, which is the case the review found.
function fakeServer() {
	const rows = new Map();
	let loseAnswer = false;
	const server = {
		rows,
		sends: 0,
		loseNextAnswer() {
			loseAnswer = true;
		},
		async send(body) {
			server.sends++;
			const content = contentKey(body);
			if (rows.has(body.submission_id)) {
				return rows.get(body.submission_id).content === content ? { ok: true, status: 200 } : { ok: false, status: 409 };
			}
			rows.set(body.submission_id, { content, email: body.email.trim().toLowerCase() });
			if (loseAnswer) {
				loseAnswer = false;
				throw new TypeError("connection lost after the request was stored");
			}
			return { ok: true, status: 200 };
		},
	};
	return server;
}

function ids() {
	let n = 0;
	return () => `id-${++n}`;
}

const form = { name: "Ann", email: "ann@example.com", company: "", message: "Hello", website: "" };

test("review case: a corrected email after a lost answer is stored, not swallowed as a repeat", async () => {
	const server = fakeServer();
	const deps = { send: server.send, newId: ids() };
	server.loseNextAnswer();
	const first = await submitLead(form, null, deps);
	assert.equal(first.outcome, "failed");

	const second = await submitLead({ ...form, email: "ann@fixed.example" }, first.pending, deps);
	assert.equal(second.outcome, "sent");
	assert.notEqual(second.pending, first.pending);
	assert.deepEqual([...server.rows.values()].map((r) => r.email).sort(), ["ann@example.com", "ann@fixed.example"]);
});

test("the same content after a lost answer reuses the id and is stored once", async () => {
	const server = fakeServer();
	const deps = { send: server.send, newId: ids() };
	server.loseNextAnswer();
	const first = await submitLead(form, null, deps);
	const second = await submitLead({ ...form }, first.pending, deps);
	assert.equal(second.outcome, "sent");
	assert.equal(server.rows.size, 1);
});

test("surrounding spaces and email letter case alone keep the id", () => {
	assert.equal(contentKey(form), contentKey({ ...form, name: " Ann ", email: " ANN@example.com " }));
	assert.notEqual(contentKey(form), contentKey({ ...form, message: "Hello again" }));
	assert.notEqual(contentKey(form), contentKey({ ...form, company: "Acme" }));
});

test("a 409 starts a new submission once and then succeeds", async () => {
	const server = fakeServer();
	server.rows.set("id-stale", { content: contentKey({ ...form, email: "old@example.com" }), email: "old@example.com" });
	const result = await submitLead(form, { id: "id-stale", content: contentKey(form) }, { send: server.send, newId: ids() });
	assert.equal(result.outcome, "sent");
	assert.equal(server.sends, 2);
	assert.equal(server.rows.size, 2);
});

test("a second 409 is reported as failed, not retried again", async () => {
	let sends = 0;
	const deps = { send: async () => (sends++, { ok: false, status: 409 }), newId: ids() };
	const result = await submitLead(form, null, deps);
	assert.equal(result.outcome, "failed");
	assert.equal(sends, 2);
});

test("success clears the pending attempt; limits and invalid input keep it", async () => {
	const ok = await submitLead(form, null, { send: async () => ({ ok: true, status: 200 }), newId: ids() });
	assert.deepEqual(ok, { outcome: "sent", pending: null });
	const limited = await submitLead(form, null, { send: async () => ({ ok: false, status: 429 }), newId: ids() });
	assert.equal(limited.outcome, "rate_limited");
	assert.equal(limited.pending.id, "id-1");
	const invalid = await submitLead(form, null, { send: async () => ({ ok: false, status: 400 }), newId: ids() });
	assert.equal(invalid.outcome, "invalid");
});

test("every send carries the submission id", async () => {
	const bodies = [];
	await submitLead(form, null, { send: async (body) => (bodies.push(body), { ok: true, status: 200 }), newId: ids() });
	assert.equal(bodies[0].submission_id, "id-1");
	assert.equal(bodies[0].email, form.email);
});
