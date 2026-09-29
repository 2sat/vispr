import { describe, expect, it, vi } from 'vitest';
import type { Assessment } from '@vispr/contracts';
import { sampleRequest } from '@vispr/contracts/fixtures';
import { AssessmentService, MemoryAssessmentCache, assessmentCacheKey, type AssessmentCache } from './cache';
import type { DetailedClassifier } from './classification';
const assessment: Assessment = { task: 'coding', complexity: 'high', confidence: .8, continuity: 'fresh', continuityConfidence: .9, modelVersion: 'jev-test', questionVersion: 'q1' };
const context = { currentDeploymentId: 'd1', unresolvedToolCallIds: ['t1'], capabilityContextDigest: 'capabilities-1' };
function classifier(): DetailedClassifier {
  return { model: 'jev-test', revision: 'q1', assess: vi.fn().mockResolvedValue(assessment), assessDetailed: vi.fn().mockResolvedValue({ assessment, attempts: [{ attempt: 1, dispatched: true, status: 'success', httpStatus: 200, usage: { inputTokens: 10, outputTokens: 10 }, networkMs: 1, parseMs: 1 }] }) };
}
const input = () => ({ applicationId: 'app-a', request: structuredClone(sampleRequest), context: structuredClone(context), cacheEnabled: true, signal: new AbortController().signal });
describe('exact assessment cache', () => {
  it('hits identical context despite a new idempotency key without copying paid attempts', async () => {
    const model = classifier(), service = new AssessmentService(model, new MemoryAssessmentCache());
    expect((await service.assess(input())).source).toBe('live');
    const changed = input(); changed.request.idempotencyKey = 'new-request';
    const hit = await service.assess(changed);
    expect(hit.source).toBe('exact_cache'); expect(hit.attempts).toEqual([]); expect(model.assessDetailed).toHaveBeenCalledTimes(1);
    expect(hit.timings.classificationMs).toBe(0);
  });
  it('isolates applications, exact text, message order, tools, revisions and capability state', () => {
    const model = classifier(), base = input();
    const key = assessmentCacheKey(base.applicationId, base.request, base.context, model);
    expect(key).toMatch(/^[a-f0-9]{64}$/); expect(key).not.toContain('app-a');
    const variants = [
      assessmentCacheKey('app-b', base.request, context, model),
      assessmentCacheKey('app-a', { ...base.request, messages: [{ role: 'user', content: 'different' }] }, context, model),
      assessmentCacheKey('app-a', base.request, { ...context, unresolvedToolCallIds: ['t2'] }, model),
      assessmentCacheKey('app-a', base.request, { ...context, capabilityContextDigest: 'capabilities-2' }, model),
      assessmentCacheKey('app-a', base.request, context, { ...model, revision: 'q2' }),
      assessmentCacheKey('app-a', { ...base.request, tools: [{ name: 'lookup', description: 'lookup', parameters: {} }] }, context, model),
    ];
    expect(variants.every(other => other !== key)).toBe(true);
    const messages = [{ role: 'user' as const, content: 'one' }, { role: 'user' as const, content: 'two' }];
    expect(assessmentCacheKey('app-a', { ...base.request, messages }, context, model)).not.toBe(assessmentCacheKey('app-a', { ...base.request, messages: [...messages].reverse() }, context, model));
  });
  it('canonicalizes object key order but preserves exact text', () => {
    const model = classifier(), base = input();
    const a = { ...base.request, outputSchema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } } };
    const b = { ...base.request, outputSchema: { properties: { b: { type: 'number' }, a: { type: 'string' } }, type: 'object' } };
    expect(assessmentCacheKey('app-a', a, context, model)).toBe(assessmentCacheKey('app-a', b, context, model));
    expect(() => assessmentCacheKey('app-a', base.request, { unresolvedToolCallIds: [] }, model)).toThrow('capability');
  });
  it('does not extend TTL on access and evicts the least recently read entry', async () => {
    let time = 0; const cache = new MemoryAssessmentCache(2, () => time);
    await cache.set('a', { assessment, expiresAt: 10 }); await cache.set('b', { assessment, expiresAt: 10 });
    time = 5; await cache.get('a'); await cache.set('c', { assessment, expiresAt: 20 });
    expect(await cache.get('b')).toBeNull(); time = 10; expect(await cache.get('a')).toBeNull(); expect(await cache.get('c')).not.toBeNull();
  });
  it('never returns mutable shared cache entries', async () => {
    const cache = new MemoryAssessmentCache(); await cache.set('a', { assessment, expiresAt: Date.now() + 1000 });
    const first = (await cache.get('a'))!; first.assessment.task = 'other';
    expect((await cache.get('a'))!.assessment.task).toBe('coding');
  });
  it('handles disabled caching and expired entries', async () => {
    let time = 0; const model = classifier(); const service = new AssessmentService(model, new MemoryAssessmentCache(2, () => time), { ttlMs: 10, now: () => time });
    await service.assess(input()); time = 10; expect((await service.assess(input())).source).toBe('live');
    expect((await service.assess({ ...input(), cacheEnabled: false })).cache).toBe('disabled'); expect(model.assessDetailed).toHaveBeenCalledTimes(3);
  });
  it('does not cache failures or malformed results, and falls through a corrupt store entry', async () => {
    const model = classifier(); vi.mocked(model.assessDetailed).mockRejectedValueOnce(new Error('unavailable'));
    const service = new AssessmentService(model, new MemoryAssessmentCache());
    await expect(service.assess(input())).rejects.toThrow('unavailable'); expect((await service.assess(input())).source).toBe('live');
    const cache: AssessmentCache = { get: vi.fn().mockResolvedValue({ assessment: {}, expiresAt: Date.now() + 1000 }), set: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
    expect((await new AssessmentService(classifier(), cache).assess(input())).source).toBe('live'); expect(cache.delete).toHaveBeenCalled();
    const invalid = classifier(); vi.mocked(invalid.assessDetailed).mockResolvedValue({ assessment: { ...assessment, confidence: NaN }, attempts: [] });
    await expect(new AssessmentService(invalid, cache).assess(input())).rejects.toThrow();
  });
  it('propagates cancellation and does not cache an aborted classification', async () => {
    const controller = new AbortController(), model = classifier();
    vi.mocked(model.assessDetailed).mockImplementation(async () => { controller.abort(new Error('cancel')); return { assessment, attempts: [] }; });
    const cache = new MemoryAssessmentCache(); const setter = vi.spyOn(cache, 'set');
    await expect(new AssessmentService(model, cache).assess({ ...input(), signal: controller.signal })).rejects.toThrow('cancel'); expect(setter).not.toHaveBeenCalled();
  });
});
