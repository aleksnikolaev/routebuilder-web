// Smoke test against a running preview (default http://localhost:8787).
//
// Runs without database secrets on purpose: it proves the page renders with the
// published head and markup, the form is there, and the routes reject bad input
// before they would ever reach the database. Set SMOKE_BASE_URL to point elsewhere.

import { readFileSync } from "node:fs";

// meta.ts is generated as `export const landingMeta = {JSON} as const;`
const metaSource = readFileSync(new URL("../lib/landing/meta.ts", import.meta.url), "utf8");
const landingMeta = JSON.parse(metaSource.slice(metaSource.indexOf("{"), metaSource.lastIndexOf("}") + 1));

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:8787";
const failures = [];

function check(ok, label) {
	console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
	if (!ok) failures.push(label);
}

async function waitForServer() {
	for (let i = 0; i < 60; i++) {
		try {
			const res = await fetch(BASE + "/");
			if (res.ok) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error(`${BASE} did not answer within 60 s`);
}

await waitForServer();

const page = await fetch(BASE + "/");
const html = await page.text();
check(page.status === 200, "GET / answers 200");
check(html.includes(`<title>${landingMeta.title.replace(/&/g, "&amp;")}</title>`), "title matches the published page");
check(html.includes(`<link rel="canonical" href="${landingMeta.canonical}"`), "canonical matches the published page");
// Count script tags, not the substring: the React payload repeats the type string.
check((html.match(/<script type="application\/ld\+json">/g) ?? []).length === 4, "all four JSON-LD blocks present");
check(html.includes('id="contact"') && html.includes('class="footer"'), "published sections present");
check(html.includes("data-lead-form"), "lead form rendered");

const post = (path, body, headers = {}) =>
	fetch(BASE + path, { method: "POST", body, headers: { "Content-Type": "application/json", ...headers } });

check((await post("/api/lead", "{not json")).status === 400, "lead: broken JSON rejected");
check((await post("/api/lead", JSON.stringify({ name: "", email: "x" }))).status === 400, "lead: invalid fields rejected");
check(
	(await post("/api/lead", JSON.stringify({ name: "a", email: "a@b.co" }), { Origin: "https://example.com" })).status === 403,
	"lead: foreign origin rejected",
);
check((await post("/api/event", JSON.stringify({ event: "hack" }))).status === 400, "event: unknown event rejected");

if (failures.length > 0) {
	console.error(`\n${failures.length} smoke check(s) failed`);
	process.exit(1);
}
console.log("\nSmoke test passed");
