import { MissingEnvError, serverEnv } from "@/lib/server/env";
import { notifyLead } from "@/lib/server/notify";
import { callRpc, clientIp, hashIp } from "@/lib/server/rpc";

const LIMITS = { name: 120, email: 200, company: 160, message: 4000 } as const;
type Field = keyof typeof LIMITS;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(request: Request) {
	// The form posts from this site only.
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(request.url).origin) {
		return Response.json({ error: "forbidden" }, { status: 403 });
	}

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "invalid_json" }, { status: 400 });
	}

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

	try {
		const env = serverEnv();
		const result = await callRpc("landing_submit", {
			p_name: value("name"),
			p_email: value("email"),
			p_company: value("company"),
			p_message: value("message"),
			p_ip_hash: await hashIp(clientIp(request), env.LANDING_IP_SALT),
			p_user_agent: (request.headers.get("user-agent") ?? "").slice(0, 400),
		});
		if (result === "rate_limited") {
			return Response.json({ error: "rate_limited" }, { status: 429 });
		}

		// The request is stored; a failed notice is logged, not reported to the visitor,
		// who would otherwise send the same request again.
		const notice = await notifyLead({
			name: value("name"),
			email: value("email"),
			company: value("company"),
			message: value("message"),
		});
		if (!notice.sent) {
			console.error("lead stored, notification not sent:", notice.reason);
		}
		return Response.json({ status: "ok" });
	} catch (err) {
		console.error("lead submit failed:", err instanceof MissingEnvError ? err.message : err);
		return Response.json({ error: "unavailable" }, { status: 503 });
	}
}
