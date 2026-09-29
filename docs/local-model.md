# Mac model connection

The Mac runs Ollama on `127.0.0.1:11434` with `qwen3.5:9b`. Run
`node scripts/local-model-gateway.mjs` to serve its authenticated gateway on
`127.0.0.1:11435`, then `cloudflared tunnel --url http://127.0.0.1:11435 --no-autoupdate`.
The gateway reads a random bearer key from the ignored `.local-model/key` file.
Generate that file with a cryptographically random secret and permissions `0600`
before starting on another machine. Never tunnel Ollama directly.

The gateway allows only `GET /v1/models` and `POST /v1/chat/completions`.
It restricts inference to the installed model, one request at a time, a 64 KiB
request body, 2,048 output tokens, and a 90 second timeout. Thinking is disabled
by default with `reasoning_effort: "none"`; callers can explicitly request it.
Streaming is rejected because Cloudflare Quick Tunnels do not support SSE.

Production server configuration:

- `SELF_HOSTED_BASE_URL`: tunnel URL plus `/v1`.
- `SELF_HOSTED_API_KEY`: gateway bearer key.
- `SELF_HOSTED_MODEL_ID`: `qwen3.5:9b`.
- `VISPR_DIRECT_ALLOWED_ORIGINS`: tunnel origin (preserve other approved origins).
- `VISPR_PROVIDER_MAC_OLLAMA`: gateway bearer key for provider registration.

`POST /api/providers/local/probe` on the hosted app requires the same bearer key.
It executes a fixed, short model prompt from the hosted server and returns actual
model output and usage. Credentials must stay server-side. This probe is separate
from the auction/inference path; it does not automatically activate a provider.

The Quick Tunnel URL changes when its process restarts. Update the hosted URL and
allowlist and redeploy after restarting it. The Mac must remain awake with Ollama,
the gateway, and cloudflared running. Replace the Quick Tunnel with a named tunnel
for a stable URL and SSE before activating the provider in the streaming router.
Do not declare tools, vision, or structured output supported until tested.

## Provider workspace

The deployed `/providers` page is a read-only workspace preview of the registered
MacBook provider. It loads the real provider and deployment records from Supabase
and checks authenticated model inventory on each refresh. Account details,
endpoint addresses, and credentials remain server-side. The captured setup
inference result is labeled separately from the live reachability check.
The provider has a provider-manager membership; its offering stays pending
until streaming and pricing are configured. Account creation does not send
an invitation or confirm ownership of the email, and this page is not a login flow.
