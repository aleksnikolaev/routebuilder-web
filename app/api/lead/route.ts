import { serverEnv } from "@/lib/server/env";
import { handleLead } from "@/lib/server/handlers";
import { notifyLead } from "@/lib/server/notify";
import { callRpc, clientIp, hashIp } from "@/lib/server/rpc";

export async function POST(request: Request) {
	return handleLead(request, {
		submit: (args) => callRpc("landing_submit", args),
		notify: (lead) => notifyLead(lead),
		ipHash: async (req) => hashIp(clientIp(req), serverEnv().LANDING_IP_SALT),
	});
}
