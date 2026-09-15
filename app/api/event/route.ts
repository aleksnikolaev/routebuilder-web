import { serverEnv } from "@/lib/server/env";
import { handleEvent } from "@/lib/server/handlers";
import { callRpc, clientIp, hashIp } from "@/lib/server/rpc";

export async function POST(request: Request) {
	return handleEvent(request, {
		track: (args) => callRpc("landing_track", args),
		ipHash: async (req) => hashIp(clientIp(req), serverEnv().LANDING_IP_SALT),
	});
}
