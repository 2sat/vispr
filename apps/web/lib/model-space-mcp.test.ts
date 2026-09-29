import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { hashApiKey } from '@vispr/db';
import { demoPolicy } from '@vispr/contracts/fixtures';
import { POST, GET, DELETE } from '../app/mcp/route';
import { snapshotId } from './model-manifold';
const paths: string[] = [];
let policy = demoPolicy;
beforeEach(() => {
  paths.length = 0;
  policy = demoPolicy;
  vi.stubEnv('SUPABASE_URL', 'https://database.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret');
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    expect(init?.method ?? 'GET').toBe('GET'); // Proposal tools must never write.
    const url = new URL(input); paths.push(url.pathname + url.search);
    if (url.pathname.endsWith('/api_keys')) return Response.json(url.searchParams.get('key_hash') === `eq.${hashApiKey('vispr_valid')}` ? [{ application_id: 'app-a' }] : []);
    if (url.pathname.endsWith('/applications')) return Response.json([{ id: 'app-a', owner_user_id: 'owner-a', organization_id: 'org-a', default_policy_id: demoPolicy.id }]);
    if (url.pathname.endsWith('/memberships')) return Response.json([{ role: 'builder' }]);
    if (url.pathname.endsWith('/policy_versions')) {
      expect(url.searchParams.get('application_id')).toBe('eq.app-a');
      return Response.json(url.searchParams.get('policy_id') === `eq.${policy.id}` ? [{ policy, version: policy.version }] : []);
    }
    throw new Error('Unexpected database read');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function client() {
  const c = new Client({ name: 'integration-test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL('https://vispr.test/mcp'), {
    requestInit: { headers: { Authorization: 'Bearer vispr_valid' } },
    fetch: async (input, init) => {
      const req = new Request(input, init);
      return req.method === 'GET' ? GET() : req.method === 'DELETE' ? DELETE() : POST(req);
    },
  });
  // SDK 1.x exposes sessionId as string | undefined while its Transport interface
  // declares an exact optional string. The SDK transport is used unchanged at runtime.
  await c.connect(transport as Parameters<Client['connect']>[0]);
  return c;
}
it('negotiates MCP, lists tools and returns a tenant-scoped proposal through the actual route', async () => {
  const c = await client();
  try {
    expect((await c.listTools()).tools.map(t => t.name)).toEqual(['get_model_space', 'propose_static_manifold']);
    const space = await c.callTool({ name: 'get_model_space', arguments: {} });
    expect(space.isError).not.toBe(true);
    expect(space.structuredContent).toMatchObject({ applicationId: 'app-a', snapshotId });
    const proposal = await c.callTool({ name: 'propose_static_manifold', arguments: {
      policyId: demoPolicy.id, policyVersion: demoPolicy.version, snapshotId,
      source: 'invoice.extract', workload: { inputTokens: 1000, maxOutputTokens: 100 },
      criteria: { latencyMs: { max: 100 }, estimatedCostMicros: { max: 100 } }, rationale: 'Low-cost extraction',
    } });
    expect(proposal.isError).not.toBe(true);
    expect(proposal.structuredContent).toMatchObject({ applicationId: 'app-a', active: false, persisted: false, source: 'invoice.extract' });
    expect((await c.callTool({ name: 'get_model_space', arguments: { policyId: 'foreign-policy' } })).isError).toBe(true);
  } finally { await c.close(); }
});
it('re-reads policy and rejects a stale proposal after an update', async () => {
  const c = await client();
  try {
    await c.callTool({ name: 'get_model_space', arguments: {} });
    policy = { ...demoPolicy, version: demoPolicy.version + 1 };
    const result = await c.callTool({ name: 'propose_static_manifold', arguments: {
      policyId: demoPolicy.id, policyVersion: demoPolicy.version, snapshotId, source: 'test',
      workload: { inputTokens: 1, maxOutputTokens: 1 }, criteria: { latencyMs: { max: 1 }, estimatedCostMicros: { max: 1 } }, rationale: 'test',
    } });
    expect(result.isError).toBe(true);
  } finally { await c.close(); }
});
it('rejects missing/revoked keys and cross-origin requests before returning model data', async () => {
  for (const Authorization of ['', 'Bearer vispr_revoked']) {
    const response = await POST(new Request('https://vispr.test/mcp', { method: 'POST', headers: { Authorization } }));
    expect(response.status).toBe(401);
  }
  paths.length = 0;
  const response = await POST(new Request('https://vispr.test/mcp', { method: 'POST', headers: { Authorization: 'Bearer vispr_valid', Origin: 'https://other.test' } }));
  expect(response.status).toBe(403); expect(paths).toEqual([]);
});
it('enforces bounded request bodies and returns 405 for unsupported transports', async () => {
  const response = await POST(new Request('https://vispr.test/mcp', { method: 'POST', headers: { Authorization: 'Bearer vispr_valid', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: 'x'.repeat(65537) }));
  expect(response.status).toBe(413);
  expect(GET().status).toBe(405); expect(DELETE().status).toBe(405);
});
