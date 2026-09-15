import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// A single static page and two uncached API routes: no incremental cache needed.
export default defineCloudflareConfig({});
