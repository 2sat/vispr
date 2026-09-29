import { PolicySchema } from '@vispr/contracts';
import { authenticate, database, PlatformError } from '../../lib/platform';
import { createModelSpaceHandler } from '../../lib/model-space-mcp';

export const runtime = 'nodejs';
export const POST = createModelSpaceHandler(async request => {
  const db = database();
  const app = await authenticate(request, db);
  return {
    applicationId: app.id,
    async loadPolicy(id = app.default_policy_id) {
      const rows = await db.call<{ policy: unknown; version: number }[]>(
        `policy_versions?application_id=eq.${encodeURIComponent(app.id)}&policy_id=eq.${encodeURIComponent(id)}&order=version.desc&limit=1&select=policy,version`,
      );
      if (!rows[0]) throw new PlatformError('INVALID_REQUEST', 'Policy unavailable');
      const policy = PolicySchema.parse(rows[0].policy);
      if (policy.id !== id || policy.version !== rows[0].version) throw new PlatformError('NOT_CONFIGURED', 'Invalid policy configuration', 503);
      return policy;
    },
  };
});
// Stateless JSON transport does not expose server-initiated SSE or sessions.
export function GET() { return new Response(null, { status: 405, headers: { Allow: 'POST' } }); }
export function DELETE() { return new Response(null, { status: 405, headers: { Allow: 'POST' } }); }
