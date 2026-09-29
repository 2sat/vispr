import { AssessmentSchema, InferenceRequestSchema, type Assessment, type InferenceRequest } from '@vispr/contracts';
import { abortable, digest, throwIfAborted, type ClassificationContext, type DetailedClassifier, type AttemptReport } from './classification';

export interface AssessmentCacheEntry { assessment: Assessment; expiresAt: number }
export interface AssessmentCache {
  get(key: string): Promise<AssessmentCacheEntry | null>;
  set(key: string, entry: AssessmentCacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
}
export class MemoryAssessmentCache implements AssessmentCache {
  private readonly entries = new Map<string, AssessmentCacheEntry>();
  constructor(private readonly capacity = 256, private readonly now = Date.now) { if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Cache capacity must be positive'); }
  async get(key: string): Promise<AssessmentCacheEntry | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) { this.entries.delete(key); return null; }
    this.entries.delete(key); this.entries.set(key, entry);
    return structuredClone(entry);
  }
  async set(key: string, entry: AssessmentCacheEntry): Promise<void> {
    const assessment = AssessmentSchema.parse(entry.assessment);
    if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= this.now()) return;
    for (const [storedKey, stored] of this.entries) if (stored.expiresAt <= this.now()) this.entries.delete(storedKey);
    this.entries.delete(key);
    this.entries.set(key, { assessment: structuredClone(assessment), expiresAt: entry.expiresAt });
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
  async delete(key: string) { this.entries.delete(key); }
}
export function assessmentCacheKey(applicationId: string, request: InferenceRequest, context: ClassificationContext, classifier: Pick<DetailedClassifier, 'model' | 'revision'>): string {
  if (!applicationId.trim() || !context.capabilityContextDigest?.trim()) throw new Error('Authenticated application and capability context are required for caching');
  const valid = InferenceRequestSchema.parse(request);
  return digest({ applicationId, source: valid.source ?? null, model: classifier.model, revision: classifier.revision, context, messages: valid.messages, tools: valid.tools ?? [], outputSchema: valid.outputSchema ?? null, maxOutputTokens: valid.maxOutputTokens, sessionId: valid.sessionId ?? null });
}
export interface AssessmentResult {
  assessment: Assessment;
  source: 'live' | 'exact_cache';
  cache: 'hit' | 'miss' | 'disabled' | 'unavailable';
  timings: { keyMs: number; lookupMs: number; classificationMs: number; totalMs: number };
  attempts: AttemptReport[];
}
export class AssessmentService {
  constructor(private readonly classifier: DetailedClassifier, private readonly cache: AssessmentCache, private readonly options: { ttlMs?: number; now?: () => number } = {}) {
    if (!Number.isSafeInteger(options.ttlMs ?? 300000) || (options.ttlMs ?? 300000) < 1) throw new Error('Invalid cache TTL');
  }
  async assess(input: { applicationId: string; request: InferenceRequest; context: ClassificationContext; cacheEnabled: boolean; signal: AbortSignal }): Promise<AssessmentResult> {
    throwIfAborted(input.signal);
    const request = structuredClone(InferenceRequestSchema.parse(input.request));
    const context = structuredClone(input.context);
    const started = performance.now(), now = this.options.now ?? Date.now;
    const timings = { keyMs: 0, lookupMs: 0, classificationMs: 0, totalMs: 0 };
    let key: string | undefined, status: AssessmentResult['cache'] = 'disabled';
    if (input.cacheEnabled) {
      key = assessmentCacheKey(input.applicationId, request, context, this.classifier); timings.keyMs = performance.now() - started;
      const lookupStart = performance.now(); status = 'miss';
      try {
        const entry = await abortable(this.cache.get(key), input.signal);
        throwIfAborted(input.signal);
        const parsed = AssessmentSchema.safeParse(entry?.assessment);
        if (entry && parsed.success && Number.isFinite(entry.expiresAt) && entry.expiresAt > now() && parsed.data.modelVersion === this.classifier.model && parsed.data.questionVersion === this.classifier.revision) {
          timings.lookupMs = performance.now() - lookupStart; timings.totalMs = performance.now() - started;
          return { assessment: parsed.data, source: 'exact_cache', cache: 'hit', timings, attempts: [] };
        }
        if (entry) await abortable(this.cache.delete(key), input.signal);
      } catch { throwIfAborted(input.signal); status = 'unavailable'; }
      timings.lookupMs = performance.now() - lookupStart;
    }
    throwIfAborted(input.signal);
    const classifyStart = performance.now();
    const result = await this.classifier.assessDetailed(request, context, input.signal);
    throwIfAborted(input.signal);
    const assessment = AssessmentSchema.parse(result.assessment);
    timings.classificationMs = performance.now() - classifyStart;
    if (assessment.modelVersion !== this.classifier.model || assessment.questionVersion !== this.classifier.revision) throw new Error('Classifier returned a different revision');
    if (key) {
      try { await abortable(this.cache.set(key, { assessment, expiresAt: now() + (this.options.ttlMs ?? 300000) }), input.signal); }
      catch { status = 'unavailable'; }
    }
    throwIfAborted(input.signal);
    timings.totalMs = performance.now() - started;
    return { assessment, source: 'live', cache: status, timings, attempts: result.attempts };
  }
}
