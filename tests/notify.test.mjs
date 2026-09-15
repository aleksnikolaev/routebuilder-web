import assert from "node:assert/strict";
import { test } from "node:test";
import { notifyLead } from "../lib/server/notify.ts";

const lead = { name: "Ann\nInjected: header", email: "ann@example.com", company: "", message: "" };
const env = { RESEND_API_KEY: "test-key", LEAD_NOTIFY_TO: "owner@example.com" };

// A stand-in for fetch that never settles until the request is aborted.
function untilAborted(init) {
	return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
}

// Node does not keep the process alive for AbortSignal.timeout, so a test that
// waits only on that timer ends before it fires. Workers have no such issue.
async function keepingProcessAlive(fn) {
	const alive = setInterval(() => {}, 1000);
	try {
		return await fn();
	} finally {
		clearInterval(alive);
	}
}

test("missing settings: not sent, nothing requested", async () => {
	let called = false;
	const result = await notifyLead(lead, { env: {}, fetchImpl: async () => ((called = true), new Response("{}")) });
	assert.deepEqual(result, { sent: false, reason: "missing RESEND_API_KEY" });
	assert.equal(called, false);
});

test("a body that fails while being read is a failed notice, not an exception", async () => {
	const fetchImpl = async () => ({
		ok: true,
		status: 200,
		text: async () => {
			throw new TypeError("terminated: connection reset");
		},
	});
	const result = await notifyLead(lead, { env, fetchImpl });
	assert.equal(result.sent, false);
	assert.match(result.reason, /connection reset/);
});

test("a network error is a failed notice", async () => {
	const result = await notifyLead(lead, {
		env,
		fetchImpl: async () => {
			throw new TypeError("fetch failed");
		},
	});
	assert.deepEqual(result, { sent: false, reason: "failed: fetch failed" });
});

test("a response that never comes is given up after the timeout", async () => {
	const started = Date.now();
	const result = await keepingProcessAlive(() =>
		notifyLead(lead, { env, timeoutMs: 50, fetchImpl: async (_url, init) => untilAborted(init) }),
	);
	assert.deepEqual(result, { sent: false, reason: "timed out after 50 ms" });
	assert.ok(Date.now() - started < 2000);
});

test("a body that never finishes is given up after the timeout", async () => {
	const fetchImpl = async (_url, init) => ({ ok: true, status: 200, text: () => untilAborted(init) });
	const result = await keepingProcessAlive(() => notifyLead(lead, { env, timeoutMs: 50, fetchImpl }));
	assert.deepEqual(result, { sent: false, reason: "timed out after 50 ms" });
});

test("a rejected request and a 2xx without an id are not sent", async () => {
	const rejected = await notifyLead(lead, { env, fetchImpl: async () => new Response('{"message":"invalid"}', { status: 422 }) });
	assert.equal(rejected.sent, false);
	assert.match(rejected.reason, /^HTTP 422/);
	const noId = await notifyLead(lead, { env, fetchImpl: async () => new Response("{}", { status: 200 }) });
	assert.equal(noId.sent, false);
});

test("accepted notice: fixed sender, visitor as reply-to, one-line subject", async () => {
	let sent;
	const fetchImpl = async (url, init) => {
		sent = { url, body: JSON.parse(init.body) };
		return new Response('{"id":"msg_1"}', { status: 200 });
	};
	const result = await notifyLead(lead, { env, fetchImpl });
	assert.deepEqual(result, { sent: true, id: "msg_1" });
	assert.equal(sent.url, "https://api.resend.com/emails");
	assert.equal(sent.body.from, "RouteBuilder landing <onboarding@resend.dev>");
	assert.deepEqual(sent.body.to, ["owner@example.com"]);
	assert.equal(sent.body.reply_to, "ann@example.com");
	assert.equal(sent.body.subject.includes("\n"), false);
});
