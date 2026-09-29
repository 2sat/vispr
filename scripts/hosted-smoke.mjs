import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { Vispr } from '../packages/sdk/src/index.ts';
import OpenAI from 'openai';

// Preflight is read-only. --run dispatches exactly one paid request, without retries.
const run = process.argv.includes('--run');
const clientKind = process.env.VISPR_SMOKE_CLIENT ?? 'sdk';
const report = { checkedAt: new Date().toISOString(), client: clientKind, paidDispatch: false, checks: [] };
const output = process.env.VISPR_SMOKE_REPORT ?? `/tmp/vispr-hosted-smoke-${Date.now()}.json`;
function check(name, ok, detail) {
  report.checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  if (!ok) throw new Error(name);
}
async function json(url, headers, init = {}) {
  const response = await fetch(url, { ...init, headers: { ...headers, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
try {
  const required = ['VISPR_BASE_URL', 'VISPR_API_KEY', 'VISPR_POLICY_ID', 'SUPABASE_SECRET_KEY', 'OPENROUTER_API_KEY', 'VISPR_EXPECTED_PROVIDER'];
  const missing = required.filter(name => !process.env[name] || process.env[name] === '[SENSITIVE]');
  if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push('SUPABASE_URL');
  check('required environment configured', !missing.length, { missing });
  check('known smoke client', ['sdk', 'api'].includes(clientKind));
  const base = new URL(process.env.VISPR_BASE_URL);
  const database = new URL(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL);
  check('hosted HTTPS endpoints', [base, database].every(url => url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash));
  const apiKey = process.env.VISPR_API_KEY;
  const secret = process.env.SUPABASE_SECRET_KEY;
  const dbHeaders = { apikey: secret, ...(secret.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${secret}` }) };
  const db = path => json(`${database.origin}/rest/v1/${path}`, dbHeaders);
  const keys = await db(`api_keys?key_hash=eq.${createHash('sha256').update(apiKey).digest('hex')}&revoked_at=is.null&select=application_id`);
  check('application key exists', keys.length === 1);
  const app = keys[0].application_id;
  const policyId = process.env.VISPR_POLICY_ID;
  const policies = await db(`policy_versions?application_id=eq.${app}&policy_id=eq.${encodeURIComponent(policyId)}&order=version.desc&limit=1&select=policy,version`);
  check('policy exists', policies.length === 1);
  const offerings = await db(`execution_offerings?application_id=eq.${app}&policy_id=eq.${encodeURIComponent(policyId)}&policy_version=eq.${policies[0].version}`);
  check('bounded hosted offering exists', offerings.length === 1 && offerings[0].bounded && offerings[0].deployment.transport === 'openrouter' && offerings[0].deployment.status === 'active');
  const offering = offerings[0];
  report.selected = { deploymentId: offering.deployment.id, model: offering.deployment.inferenceModelId, providerSlug: offering.deployment.providerSlug, policyId, policyVersion: policies[0].version };
  check('offering has one pinned provider', typeof report.selected.providerSlug === 'string' && report.selected.providerSlug.length > 0);
  const models = await json(`${base.href.replace(/\/$/, '')}/v1/models`, { Authorization: `Bearer ${apiKey}` });
  check('deployed API authenticates and exposes policy', models.data.some(model => model.id === `vispr/policy/${policyId}`));
  // These projections also detect missing execution migration columns/Data API exposure.
  await db('inference_requests?select=id,dispatched_at,usage,serving_identity&limit=0');
  await db('spend_reservations?select=request_id,amount_micros,actual_cost_micros,status&limit=0');
  check('execution schema reachable', true);
  if (run) {
    const client = new Vispr({ apiKey, baseURL: base.href });
    const idempotencyKey = `hosted-smoke:${randomUUID()}`;
    report.idempotencyKey = idempotencyKey;
    report.paidDispatch = true; // Includes ambiguous transport failures; never auto-retry.
    let requestId;
    if (clientKind === 'sdk') {
      let textReceived = false;
      let terminal;
      for await (const event of client.stream({ policyId, idempotencyKey, messages: [{ role: 'user', content: 'Reply with the word ready.' }], maxOutputTokens: 32 }, { signal: AbortSignal.timeout(60000) })) {
        requestId = event.requestId;
        report.requestId = requestId;
        if (event.type === 'text_delta' && event.text.trim()) textReceived = true;
        if (event.type === 'error' || event.type === 'completed') terminal = event.type;
      }
      check('SDK returned output and completion', textReceived && terminal === 'completed');
    } else {
      const compatible = new OpenAI({ apiKey, baseURL: `${base.href.replace(/\/$/, '')}/v1`, maxRetries: 0, timeout: 60000 });
      const { data, response } = await compatible.chat.completions.create({ model: `vispr/policy/${policyId}`, messages: [{ role: 'user', content: 'Reply with the word ready.' }], max_tokens: 32 }, { headers: { 'Idempotency-Key': idempotencyKey } }).withResponse();
      requestId = response.headers.get('X-Vispr-Request-Id');
      check('compatible client returned output', Boolean(data.choices[0]?.message.content?.trim()));
    }
    check('request ID returned', Boolean(requestId));
    report.requestId = requestId;
    const trace = await client.trace(requestId);
    check('persisted trace completed', trace.at(-1)?.type === 'completed');
    const usage = trace.filter(event => event.type === 'usage').at(-1)?.usage;
    check('generation ID persisted', Boolean(usage?.generationId));
    check('expected serving provider returned', usage.servingProvider === process.env.VISPR_EXPECTED_PROVIDER, { actual: usage.servingProvider ?? null, expected: process.env.VISPR_EXPECTED_PROVIDER });
    const billing = await json(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(usage.generationId)}`, { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` });
    check('vendor billing available', typeof billing.data?.total_cost === 'number' && Number.isFinite(billing.data.total_cost) && billing.data.total_cost >= 0);
    const ledger = await db(`spend_reservations?application_id=eq.${app}&request_id=eq.${requestId}&select=amount_micros,actual_cost_micros,status`);
    report.billing = { usage, vendorCostUsd: billing.data.total_cost, ledger };
    check('ledger settled to returned usage', ledger.length === 1 && ledger[0].status === 'settled' && Number(ledger[0].actual_cost_micros) === usage.actualCostMicros);
    check('vendor charge agrees within one micro-dollar', Math.abs(billing.data.total_cost * 1e6 - usage.actualCostMicros) <= 1);
    check('charge within reserved bound', usage.actualCostMicros <= Number(ledger[0].amount_micros));
  }
  report.status = run ? 'verified' : 'preflight_passed';
} catch {
  report.status = 'blocked_or_failed';
  // Do not serialize provider errors, request payloads, URLs with credentials, or keys.
  report.failure = report.checks.at(-1)?.ok === false ? report.checks.at(-1).name : 'operation failed; inspect service trace using recorded request/idempotency ID';
  process.exitCode = 1;
} finally {
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, report: output, paidDispatch: report.paidDispatch }));
}
