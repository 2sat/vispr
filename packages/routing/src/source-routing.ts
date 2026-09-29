import { InvocationSourceSchema, SourceRoutingSchema, type CatalogSnapshot, type SourceRouting, type PoolCriteria } from '@vispr/contracts';

export class SourceRoutingError extends Error {
  readonly code = 'INVALID_REQUEST';
  constructor(message: string) { super(message); this.name = 'SourceRoutingError'; }
}

/** Configuration must be loaded for the authenticated application by the server. */
export function resolveSourcePool(source: string | undefined, config: SourceRouting | undefined, catalog: CatalogSnapshot): { catalog: CatalogSnapshot; sourcePool: { source: string; poolId: string } | null; criteria?: PoolCriteria } {
  const valid = config === undefined ? undefined : SourceRoutingSchema.parse(config);
  if (source === undefined) return { catalog, sourcePool: null };
  InvocationSourceSchema.parse(source);
  const binding = valid?.bindings.find(binding => binding.source === source);
  if (!binding) throw new SourceRoutingError(`Unmapped invocation source: ${source}`);
  const pool = valid!.pools.find(pool => pool.id === binding.poolId)!;
  const allowed = pool.deploymentIds ? new Set(pool.deploymentIds) : null;
  return { catalog: { ...catalog, deployments: catalog.deployments.filter(deployment => !allowed || allowed.has(deployment.id)) }, sourcePool: { source, poolId: pool.id }, ...(pool.criteria ? { criteria: pool.criteria } : {}) };
}
