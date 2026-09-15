import { MissingEnvError, serverEnv } from "@/lib/server/env";
import { callRpc, clientIp, hashIp } from "@/lib/server/rpc";

const EVENTS = new Set(["page_view", "click_email", "click_whatsapp", "click_linkedin"]);

export async function POST(request: Request) {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(request.url).origin) {
		return new Response(null, { status: 403 });
	}

	// sendBeacon posts text/plain, so the body is parsed by hand.
	let body: { event?: unknown; path?: unknown };
	try {
		body = JSON.parse(await request.text());
	} catch {
		return new Response(null, { status: 400 });
	}
	if (typeof body.event !== "string" || !EVENTS.has(body.event)) {
		return new Response(null, { status: 400 });
	}
	const path = typeof body.path === "string" ? body.path.slice(0, 200) : "/";

	try {
		const env = serverEnv();
		const result = await callRpc("landing_track", {
			p_event: body.event,
			p_path: path,
			p_ip_hash: await hashIp(clientIp(request), env.LANDING_IP_SALT),
		});
		return new Response(null, { status: result === "rate_limited" ? 429 : 204 });
	} catch (err) {
		console.error("event track failed:", err instanceof MissingEnvError ? err.message : err);
		return new Response(null, { status: 503 });
	}
}
