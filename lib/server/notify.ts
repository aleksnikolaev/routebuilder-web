// Email notice about a new request, sent through Resend.
//
// Runs after the request is stored, so it must never turn a stored request into
// an error: every failure, including a timeout or a broken response body, comes
// back as { sent: false } with the reason, and nothing is thrown. Without a
// verified sending domain Resend delivers only to the address of the account
// owner, which is exactly who this notice is for.

export type Lead = { name: string; email: string; company: string; message: string };

export type NotifyResult = { sent: true; id: string } | { sent: false; reason: string };

export type NotifyOptions = {
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	env?: { RESEND_API_KEY?: string; LEAD_NOTIFY_TO?: string };
};

// Fixed on purpose, not configurable: the Resend account also holds a verified
// domain that belongs to another project and must never send for this site.
// Changing the sender means a code change and a review, not an env var.
const FROM = "RouteBuilder landing <onboarding@resend.dev>";

// The visitor waits for the form answer while the notice goes out. Past this the
// notice is given up and logged; the request itself is already stored.
export const NOTIFY_TIMEOUT_MS = 5000;

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 120);

export async function notifyLead(lead: Lead, options: NotifyOptions = {}): Promise<NotifyResult> {
	const env = options.env ?? {
		RESEND_API_KEY: process.env.RESEND_API_KEY,
		LEAD_NOTIFY_TO: process.env.LEAD_NOTIFY_TO,
	};
	const key = env.RESEND_API_KEY;
	const to = env.LEAD_NOTIFY_TO;
	if (!key || !to) {
		return { sent: false, reason: `missing ${key ? "LEAD_NOTIFY_TO" : "RESEND_API_KEY"}` };
	}
	const timeoutMs = options.timeoutMs ?? NOTIFY_TIMEOUT_MS;
	const doFetch = options.fetchImpl ?? fetch;

	const text = [
		`Name: ${lead.name}`,
		`Email: ${lead.email}`,
		`Company: ${lead.company || "-"}`,
		"",
		lead.message || "(no message)",
	].join("\n");

	try {
		const res = await doFetch("https://api.resend.com/emails", {
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				from: FROM,
				to: [to],
				reply_to: lead.email,
				subject: `RouteBuilder: request from ${oneLine(lead.name)}`,
				text,
			}),
			// One deadline for the whole exchange, reading the body included.
			signal: AbortSignal.timeout(timeoutMs),
		});
		const body = await res.text();
		if (!res.ok) {
			return { sent: false, reason: `HTTP ${res.status} ${body.slice(0, 200)}` };
		}
		// Accepted means an id came back. A 2xx without one is not treated as sent.
		let id = "";
		try {
			id = (JSON.parse(body) as { id?: string }).id ?? "";
		} catch {}
		return id ? { sent: true, id } : { sent: false, reason: `no message id: ${body.slice(0, 200)}` };
	} catch (err) {
		const name = err instanceof Error ? err.name : "";
		if (name === "TimeoutError" || name === "AbortError") {
			return { sent: false, reason: `timed out after ${timeoutMs} ms` };
		}
		return { sent: false, reason: `failed: ${err instanceof Error ? err.message : String(err)}` };
	}
}
