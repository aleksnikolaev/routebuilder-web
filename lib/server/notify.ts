// Email notice about a new request, sent through Resend.
//
// Runs after the request is stored, so a failed notice never loses the lead: the
// caller logs the reason and still answers the visitor with success. Without a
// verified sending domain Resend delivers only to the address of the account
// owner, which is exactly who this notice is for.

type Lead = { name: string; email: string; company: string; message: string };

export type NotifyResult = { sent: true; id: string } | { sent: false; reason: string };

// Fixed on purpose, not configurable: the Resend account also holds a verified
// domain that belongs to another project and must never send for this site.
// Changing the sender means a code change and a review, not an env var.
const FROM = "RouteBuilder landing <onboarding@resend.dev>";

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 120);

export async function notifyLead(lead: Lead): Promise<NotifyResult> {
	const key = process.env.RESEND_API_KEY;
	const to = process.env.LEAD_NOTIFY_TO;
	if (!key || !to) {
		return { sent: false, reason: `missing ${key ? "LEAD_NOTIFY_TO" : "RESEND_API_KEY"}` };
	}

	const text = [
		`Name: ${lead.name}`,
		`Email: ${lead.email}`,
		`Company: ${lead.company || "-"}`,
		"",
		lead.message || "(no message)",
	].join("\n");

	let res: Response;
	try {
		res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				from: FROM,
				to: [to],
				reply_to: lead.email,
				subject: `RouteBuilder: request from ${oneLine(lead.name)}`,
				text,
			}),
		});
	} catch (err) {
		return { sent: false, reason: `network error: ${err instanceof Error ? err.message : String(err)}` };
	}

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
}
