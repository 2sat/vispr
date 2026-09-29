import { CatalogSnapshotSchema, PolicySchema } from '@vispr/contracts';
import { authenticate, database, PlatformError } from '../../lib/platform';
import { createModelSpaceHandler } from '../../lib/model-space-mcp';

import { RoutingConfigSchema } from '../../lib/marketplace';

export const runtime = 'nodejs';
export const POST = createModelSpaceHandler(async request => {
  const db = database();
  const app = await authenticate(request, db);
  return {
    applicationId: app.id,
    async loadReviewed(policy) {
      const rows = await db.call<{ catalog_snapshot_id: string; config: unknown }[]>(
        `routing_configs?application_id=eq.${encodeURIComponent(app.id)}&policy_id=eq.${encodeURIComponent(policy.id)}&policy_version=eq.${policy.version}&active=eq.true&select=catalog_snapshot_id,config`,
      );
      if (!rows[0]) return undefined;
      if (rows.length !== 1) throw new PlatformError('NOT_CONFIGURED', 'Multiple active routing configurations', 503);
      const config = RoutingConfigSchema.parse(rows[0].config);
      const snapshots = await db.call<{ snapshot: unknown }[]>(`catalog_snapshots?id=eq.${encodeURIComponent(rows[0].catalog_snapshot_id)}&select=snapshot`);
      const catalog = CatalogSnapshotSchema.parse(snapshots[0]?.snapshot);
      if (catalog.id !== rows[0].catalog_snapshot_id) throw new PlatformError('NOT_CONFIGURED', 'Snapshot identity mismatch', 503);
      return { catalog, config };
    },
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
