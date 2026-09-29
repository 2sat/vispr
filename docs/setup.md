# Development setup

Repository: `/Users/jack/Documents/Repos/vispr` (outside Work and Codex).

## Local

Use Node 22 (`nvm use` if nvm is installed). Run `npm ci`, open Docker Desktop, then `npm run db:start`.
Run `npm run db:env` to write local credentials to the ignored `apps/web/.env.local`. This uses `npx supabase status`; rerun it after recreating the stack. Never put the server secret in a NEXT_PUBLIC variable.
Run `npm run dev`; open http://localhost:3000. Supabase Studio: http://127.0.0.1:54323.
`npm run db:reset` destroys local database data and reapplies migrations. It does not reset hosted data.

## Hosted

Vercel project: https://vercel.com/jack-7078/vispr
App: https://vispr-three.vercel.app
Supabase: https://supabase.com/dashboard/project/xcqpiusinmfuicwmizqz
Region: us-west-1.

Vercel builds the root npm workspace and serves apps/web/.next. Run `vercel deploy` for a preview and `vercel deploy --prod` for production. The initial deployment is protected by Vercel authentication.
GitHub automatic deployments require write/admin access to 2sat/vispr in Vercel's GitHub integration; initial connection failed. Reconnect with `vercel git connect` once access is granted.

Apply reviewed hosted migrations with `npx supabase db push`. The hosted project is linked locally. Generated credentials are in ignored files with restricted permissions; do not commit them.

## Checks and scope

Run `npm run build` and `npm run typecheck`. `/api/health` verifies the foundation marker through the server database client, returns 503 if unconfigured or unreachable, and never exposes database errors or credentials.

This scaffold implements infrastructure only. The SDK, routing, catalog, and providers packages are placeholders. Jev, real inference, ingestion, authentication journeys, and auction behavior follow demo-spec.md and are not implemented here.
