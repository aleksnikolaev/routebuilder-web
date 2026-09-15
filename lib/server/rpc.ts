import { serverEnv } from "./env";

export type RpcResult = "ok" | "rate_limited";

type RpcName = "landing_submit" | "landing_track";

// The visitor address never leaves the Worker in clear form. The salt lives only
// in the Worker's secrets, so the stored hash cannot be reversed from the table.
export async function hashIp(ip: string, salt: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientIp(request: Request): string {
	return (
		request.headers.get("cf-connecting-ip") ??
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		"unknown"
	);
}

export async function callRpc(fn: RpcName, args: Record<string, string>): Promise<RpcResult> {
	const env = serverEnv();
	const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
		method: "POST",
		headers: {
			apikey: env.SUPABASE_PUBLISHABLE_KEY,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ p_secret: env.LANDING_RPC_SECRET, ...args }),
	});
	if (!res.ok) {
		const detail = (await res.text()).slice(0, 200);
		throw new Error(`${fn} failed: HTTP ${res.status} ${detail}`);
	}
	const value: unknown = await res.json();
	if (value !== "ok" && value !== "rate_limited") {
		throw new Error(`${fn} returned an unexpected value: ${JSON.stringify(value)}`);
	}
	return value;
}
