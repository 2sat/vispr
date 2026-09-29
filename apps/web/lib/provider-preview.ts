import 'server-only';
import { DeploymentSchema } from '@vispr/contracts';
import { database } from './platform';

export async function providerPreview() {
  const id = process.env.VISPR_DEMO_PROVIDER_ID;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = database();
  const [providers, offerings] = await Promise.all([
    db.call<{ name: string; status: string; created_at: string }[]>(`providers?id=eq.${id}&select=name,status,created_at`),
    db.call<{ deployment: unknown; capacity: number; verified_at: string | null }[]>(`provider_deployments?provider_id=eq.${id}&select=deployment,capacity,verified_at`),
  ]);
  const provider = providers[0];
  const row = offerings[0];
  if (!provider || !row) return null;
  const deployment = DeploymentSchema.parse(row.deployment);
  const base = process.env.SELF_HOSTED_BASE_URL;
  const key = process.env.VISPR_PROVIDER_MAC_OLLAMA;
  let connected = false;
  let latencyMs: number | null = null;
  if (base && key) {
    try {
      const url = new URL(`${base.replace(/\/$/, '')}/models`);
      if (url.protocol !== 'https:' || !(process.env.VISPR_DIRECT_ALLOWED_ORIGINS ?? '').split(',').includes(url.origin)) throw new Error('Endpoint unavailable');
      const start = performance.now();
      const res = await fetch(url, { headers: { authorization: `Bearer ${key}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const result = await res.json();
        connected = Array.isArray(result.data) && result.data.some((model: { id: string }) => model.id === deployment.inferenceModelId);
        if (connected) latencyMs = Math.round(performance.now() - start);
      }
    } catch { /* Offline is a real provider state. */ }
  }
  // This public preview is an explicit projection of one operator-selected provider.
  // Never include account IDs, email, endpoints, or credential references.
  return { name: provider.name, registeredAt: provider.created_at, deployment, capacity: row.capacity, verifiedAt: row.verified_at, connected, latencyMs, checkedAt: new Date().toISOString() };
}
