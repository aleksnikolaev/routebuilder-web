// Client side of the repeat protection for the request form.
//
// An attempt whose answer was lost may still have been stored. Sending the same
// content again under the same id lets the server recognise the repeat and store
// it once. Changed content is a new submission and gets a new id: reusing the old
// one would let the server keep the stored earlier version and drop the fix.
//
// No value imports on purpose, so the unit tests can load this file directly.

export type Pending = { id: string; content: string } | null;
export type Outcome = "sent" | "rate_limited" | "invalid" | "failed";

export type SubmitDeps = {
	send: (body: Record<string, string>) => Promise<{ ok: boolean; status: number }>;
	newId: () => string;
};

const CONTENT_FIELDS = ["name", "email", "company", "message"] as const;

// Mirrors the server's normalisation, so surrounding spaces or the letter case
// of the email alone do not make a new submission.
export function contentKey(fields: Record<string, string>): string {
	return JSON.stringify(
		CONTENT_FIELDS.map((key) => {
			const value = (fields[key] ?? "").trim();
			return key === "email" ? value.toLowerCase() : value;
		}),
	);
}

export async function submitLead(
	fields: Record<string, string>,
	pending: Pending,
	deps: SubmitDeps,
): Promise<{ outcome: Outcome; pending: Pending }> {
	const content = contentKey(fields);
	let current = pending && pending.content === content ? pending : { id: deps.newId(), content };
	try {
		let res = await deps.send({ ...fields, submission_id: current.id });
		if (res.status === 409) {
			// The server holds different content under this id. Start a new
			// submission once; a second conflict is reported, not retried.
			current = { id: deps.newId(), content };
			res = await deps.send({ ...fields, submission_id: current.id });
		}
		if (res.ok) {
			return { outcome: "sent", pending: null };
		}
		const outcome: Outcome = res.status === 429 ? "rate_limited" : res.status === 400 ? "invalid" : "failed";
		return { outcome, pending: current };
	} catch {
		// The request may have been stored before the connection broke. Keep the id,
		// so sending the same content again is recognised as a repeat.
		return { outcome: "failed", pending: current };
	}
}
