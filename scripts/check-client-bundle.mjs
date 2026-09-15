// Fails when anything secret reaches files that browsers can download.
//
// Scans .open-next/assets after `opennextjs-cloudflare build`. Two kinds of
// checks: known secret shapes, and the literal secret values when they are
// present in the environment (CI passes them in for exactly this step).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".open-next/assets";

const SHAPES = [
	["Supabase secret key", /sb_secret_[A-Za-z0-9_-]{10,}/],
	["Cloudflare API token", /cfat_[A-Za-z0-9]{20,}/],
	// base64 of "role":"service_role" inside a legacy JWT payload
	["Supabase service_role JWT", /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*InNlcnZpY2Vfcm9sZS[A-Za-z0-9_-]*\./],
	["Resend API key", /re_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}/],
	["server env name", /LANDING_RPC_SECRET|LANDING_IP_SALT|RESEND_API_KEY|LEAD_NOTIFY_TO/],
];

const VALUES = ["LANDING_RPC_SECRET", "LANDING_IP_SALT", "RESEND_API_KEY"]
	.map((name) => [name, process.env[name]])
	.filter(([, value]) => value && value.length >= 16);

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

let all;
try {
	all = files(ROOT);
} catch {
	console.error(`${ROOT} not found: run the Cloudflare build first`);
	process.exit(1);
}
if (!all.some((path) => path.includes("_next/static"))) {
	console.error(`${ROOT} has no _next/static: the build output looks incomplete`);
	process.exit(1);
}

const hits = [];
for (const path of all) {
	const text = readFileSync(path, "latin1");
	for (const [label, pattern] of SHAPES) {
		if (pattern.test(text)) hits.push(`${path}: ${label}`);
	}
	for (const [name, value] of VALUES) {
		if (text.includes(value)) hits.push(`${path}: value of ${name}`);
	}
}

if (hits.length > 0) {
	console.error("Secrets found in browser-facing files:\n" + hits.join("\n"));
	process.exit(1);
}
console.log(`OK: ${all.length} browser-facing files, no secrets (value checks: ${VALUES.length})`);
