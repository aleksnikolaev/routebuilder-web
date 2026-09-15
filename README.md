# RouteBuilder landing

The public RouteBuilder page, served by Next.js on Cloudflare Workers. Requests from the contact form and contact clicks are stored in Supabase.

## How it fits together

- `lib/landing/` holds the published page head, JSON-LD and markup, carried over from the static site without changes.
- `app/api/lead` and `app/api/event` are same-origin routes. They validate input, hash the visitor address with a salt, and call two database functions. The browser never talks to Supabase.
- `supabase/migrations/` creates the tables and functions. Tables are closed to the publishable key; the functions require a shared secret.

## Environment

See `.env.example`. `SUPABASE_URL` is a plain variable in `wrangler.jsonc`; the rest are Worker secrets:

```
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put LANDING_RPC_SECRET
npx wrangler secret put LANDING_IP_SALT
```

Routes fail closed with 503 when any of them is missing.

The email notice about a new request needs two more secrets, `RESEND_API_KEY` and `LEAD_NOTIFY_TO`. Without them the request is still stored and the route logs that no notice went out. Until a sending domain is verified in Resend, notices go from `onboarding@resend.dev` and only to the Resend account owner.

## Checks and deploy

`.github/workflows/deploy.yml` runs lint, type check, the Cloudflare build, a scan of browser-facing files for secrets, and a smoke test against a local preview. Only a push to `main` that passes all of them deploys, and it deploys the build that was checked.

Locally:

```
npm run preview        # build and serve in the Workers runtime on :8787
npm run check:bundle   # after a build
npm run check:smoke    # against a running preview
```
