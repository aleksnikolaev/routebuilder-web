// Server-only configuration. OpenNext copies Worker vars and secrets into
// process.env per request, so the same names work in `next dev`, in the local
// preview and in production.

const REQUIRED = [
	"SUPABASE_URL",
	"SUPABASE_PUBLISHABLE_KEY",
	"LANDING_RPC_SECRET",
	"LANDING_IP_SALT",
] as const;

export type ServerEnv = Record<(typeof REQUIRED)[number], string>;

export class MissingEnvError extends Error {}

export function serverEnv(): ServerEnv {
	const missing = REQUIRED.filter((key) => !process.env[key]);
	if (missing.length > 0) {
		throw new MissingEnvError(`missing server env: ${missing.join(", ")}`);
	}
	return Object.fromEntries(REQUIRED.map((key) => [key, process.env[key] as string])) as ServerEnv;
}
