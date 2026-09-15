// Server logic of the two API routes, with dependencies passed in so every
// failure path can be tested without a database or a mail provider. The route
// files only wire in the real dependencies.
//
// This module has no value imports on purpose: the unit tests load it directly
// with Node's type stripping, which does not resolve extensionless paths.

import type { Lead, NotifyResult } from "./notify";

export type SubmitResult = "ok" | "rate_limited" | "duplicate";
export type TrackResult = "ok" | "rate_limited" | "duplicate";

type Log = (message: string, detail?: unknown) => void;

export type LeadDeps = {
	submit: (args: Record<string, string>) => Promise<SubmitResult>;
	notify: (lead: Lead) => Promise<NotifyResult>;
	ipHash: (request: Request) => Promise<string>;
	log?: Log;
};

export type EventDeps = {
	track: (args: Record<string, string>) => Promise<TrackResult>;
	ipHash: (request: Request) => Promise<string>;
	log?: Log;
};

const LIMITS = { name: 120, email: 200, company: 160, message: 4000 } as const;
type Field = keyof typeof LIMITS;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENTS = new Set(["page_view", "click_email", "click_whatsapp", "click_linkedin"]);

const defaultLog: Log = (message, detail) => console.error(message, detail);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The site posts to itself only.
function sameOrigin(request: Request): boolean {
	const origin = request.headers.get("origin");
	return !origin || origin === new URL(request.url).origin;
}

export async function handleLead(request: Request, deps: LeadDeps): Promise<Response> {
	const log = deps.log ?? defaultLog;
	if (!sameOrigin(request)) {
		return Response.json({ error: "forbidden" }, { status: 403 });
	}

	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return Response.json({ error: "invalid_json" }, { status: 400 });
	}
	// null, arrays and bare values are valid JSON but carry no fields.
	if (!isPlainObject(parsed)) {
		return Response.json({ error: "invalid_json" }, { status: 400 });
	}
	const body = parsed;

	// Honeypot: the field is hidden from people, so anything in it is a bot.
	// Answer as if it worked, so the bot learns nothing.
	if (typeof body.website === "string" && body.website !== "") {
		return Response.json({ status: "ok" });
	}

	const value = (key: Field) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");
	const fields = Object.keys(LIMITS) as Field[];
	if (!value("name") || !EMAIL.test(value("email")) || fields.some((key) => value(key).length > LIMITS[key])) {
		return Response.json({ error: "invalid_fields" }, { status: 400 });
	}

	// One id per submission, kept by the form across retries, so a retry after a
	// lost answer is not stored twice. Pages loaded before this change send none.
	const submissionId = body.submission_id;
	if (submissionId !== undefined && (typeof submissionId !== "string" || !UUID.test(submissionId))) {
		return Response.json({ error: "invalid_fields" }, { status: 400 });
	}

	const lead: Lead = {
		name: value("name"),
		email: value("email"),
		company: value("company"),
		message: value("message"),
	};

	let result: SubmitResult;
	try {
		const args: Record<string, string> = {
			p_name: lead.name,
			p_email: lead.email,
			p_company: lead.company,
			p_message: lead.message,
			p_ip_hash: await deps.ipHash(request),
			p_user_agent: (request.headers.get("user-agent") ?? "").slice(0, 400),
		};
		if (typeof submissionId === "string") {
			args.p_submission_id = submissionId;
		}
		result = await deps.submit(args);
	} catch (err) {
		log("lead submit failed:", err);
		return Response.json({ error: "unavailable" }, { status: 503 });
	}

	if (result === "rate_limited") {
		return Response.json({ error: "rate_limited" }, { status: 429 });
	}
	if (result === "duplicate") {
		// Already stored and already notified on the first attempt.
		return Response.json({ status: "ok" });
	}

	// Stored. Nothing after this line may turn into an error for the visitor, who
	// would then send the same request again.
	try {
		const notice = await deps.notify(lead);
		if (!notice.sent) {
			log("lead stored, notification not sent:", notice.reason);
		}
	} catch (err) {
		log("lead stored, notification threw:", err);
	}
	return Response.json({ status: "ok" });
}

export async function handleEvent(request: Request, deps: EventDeps): Promise<Response> {
	const log = deps.log ?? defaultLog;
	if (!sameOrigin(request)) {
		return new Response(null, { status: 403 });
	}

	// sendBeacon posts text/plain, so the body is parsed by hand.
	let parsed: unknown;
	try {
		parsed = JSON.parse(await request.text());
	} catch {
		return new Response(null, { status: 400 });
	}
	if (!isPlainObject(parsed)) {
		return new Response(null, { status: 400 });
	}
	const event = parsed.event;
	if (typeof event !== "string" || !EVENTS.has(event)) {
		return new Response(null, { status: 400 });
	}
	const path = typeof parsed.path === "string" ? parsed.path.slice(0, 200) : "/";

	try {
		const result = await deps.track({
			p_event: event,
			p_path: path,
			p_ip_hash: await deps.ipHash(request),
		});
		return new Response(null, { status: result === "rate_limited" ? 429 : 204 });
	} catch (err) {
		log("event track failed:", err);
		return new Response(null, { status: 503 });
	}
}
