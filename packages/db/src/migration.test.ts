import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const alice = '00000000-0000-0000-0000-000000000001';
const bob = '00000000-0000-0000-0000-000000000002';
const org = '00000000-0000-0000-0000-000000000003';
const app = '00000000-0000-0000-0000-000000000004';
const request = '00000000-0000-0000-0000-000000000005';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  // Minimal Supabase identity harness: test real Postgres constraints/RLS,
  // not hosted Auth behavior. Hosted invite/login acceptance remains pending.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
  `);
  const directory = new URL('../../../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name, directory), 'utf8'));
  await db.exec(`insert into auth.users values ('${alice}'), ('${bob}');
    insert into public.organizations(id, name) values ('${org}', 'test');
    insert into public.memberships values ('${org}', '${alice}', 'builder'), ('${org}', '${bob}', 'builder');
    insert into public.applications(id, organization_id, owner_user_id, name) values ('${app}', '${org}', '${alice}', 'test');
    insert into public.policy_versions values ('${app}', 'balanced', 1, '{}', now());
    insert into public.inference_requests(id, application_id, idempotency_key, policy_id, policy_version) values ('${request}', '${app}', 'first', 'balanced', 1);`);
});
afterAll(async () => { await db?.close(); });
async function asUser(user: string, sql: string) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await db.query(sql); } finally { await db.exec('reset role'); }
}
describe('foundation migration', () => {
  it('allows the owning member to read and blocks another builder in the same organization', async () => {
    expect((await asUser(alice, 'select * from public.inference_requests')).rows).toHaveLength(1);
    expect((await asUser(bob, 'select * from public.inference_requests')).rows).toHaveLength(0);
  });
  it('does not grant secrets or membership changes to browser roles', async () => {
    await expect(asUser(alice, 'select * from public.api_keys')).rejects.toThrow(/permission denied/);
    await expect(asUser(alice, `update public.memberships set role = 'owner'`)).rejects.toThrow(/permission denied/);
    await db.exec('set role anon');
    try { await expect(db.query('select * from public.applications')).rejects.toThrow(/permission denied/); }
    finally { await db.exec('reset role'); }
  });
  it('enforces request idempotency and policy ownership', async () => {
    await expect(db.exec(`insert into public.inference_requests(application_id, idempotency_key, policy_id, policy_version) values ('${app}', 'first', 'balanced', 1)`)).rejects.toThrow(/unique constraint/);
    await expect(db.exec(`insert into public.inference_requests(application_id, idempotency_key, policy_id, policy_version) values ('${app}', 'second', 'not-owned', 1)`)).rejects.toThrow(/foreign key/);
  });
  it('requires known cost to settle and rejects negative reservations', async () => {
    await expect(db.exec(`insert into public.spend_reservations(application_id, request_id, amount_micros, status) values ('${app}', '${request}', 10, 'settled')`)).rejects.toThrow(/check constraint/);
    await expect(db.exec(`insert into public.spend_reservations(application_id, request_id, amount_micros) values ('${app}', '${request}', -1)`)).rejects.toThrow(/check constraint/);
  });
  it('has RLS on every foundation table', async () => {
    const result = await db.query("select tablename from pg_tables where schemaname = 'public' and not rowsecurity");
    expect(result.rows).toHaveLength(0);
  });
});

describe('platform ledger', () => {
 it('reserves a shared budget, preserves uncertain charges, and prevents duplicate dispatch', async () => {
  const run = await db.query<{id:string}>(`select public.begin_execution('${app}','budget-first','balanced',1,200000,250000,250000) as id`);
  const id = run.rows[0]!.id;
  await expect(db.query(`select public.begin_execution('${app}','budget-over','balanced',1,100000,250000,250000)`)).rejects.toThrow(/BUDGET_EXCEEDED/);
  expect((await db.query<{ok:boolean}>(`select public.mark_dispatched('${app}','${id}') as ok`)).rows[0]!.ok).toBe(true);
  expect((await db.query<{ok:boolean}>(`select public.mark_dispatched('${app}','${id}') as ok`)).rows[0]!.ok).toBe(false);
  await db.exec(`select public.finish_execution('${app}','${id}','failed',null)`);
  expect((await db.query<{status:string}>(`select status from public.spend_reservations where request_id='${id}'`)).rows[0]!.status).toBe('uncertain');
  await expect(db.query(`select public.begin_execution('${app}','budget-still-over','balanced',1,100000,250000,250000)`)).rejects.toThrow(/BUDGET_EXCEEDED/);
  await db.exec(`select public.finish_execution('${app}','${id}','failed','{"actualCostMicros":50000,"reconciliation":"settled"}'::jsonb)`);
  await db.query(`select public.begin_execution('${app}','budget-next','balanced',1,100000,250000,250000)`);
 });
 it('prevents browser roles calling spend mutations or reading credentials', async () => {
  await expect(asUser(alice, `select public.begin_execution('${app}','malicious','balanced',1,1,250000,10000000)`)).rejects.toThrow(/permission denied/);
  await expect(asUser(alice, 'select * from public.execution_offerings')).rejects.toThrow(/permission denied/);
 });
 it('rejects charges above the per-request ceiling', async () => {
  await expect(db.query(`select public.begin_execution('${app}','request-over','balanced',1,250001,9999999,10000000)`)).rejects.toThrow(/BUDGET_EXCEEDED/);
 });
});

describe('auction and capacity transactions',()=>{
 it('accepts only timely bids, awards once, and holds executing capacity',async()=>{
  const provider='00000000-0000-0000-0000-000000000006';
  const auction='00000000-0000-0000-0000-000000000007';
  await db.exec(`insert into public.providers(id,organization_id,manager_user_id,name,transport)values('${provider}','${org}','${alice}','fixture','direct');
   insert into public.provider_deployments(id,provider_id,deployment,base_url,secret_reference,capacity,verified_at)values('fixture','${provider}','{"status":"active"}','https://fixture.invalid','FIXTURE',1,now());
   insert into public.auctions(id,application_id,request_id,deadline)values('${auction}','${app}','${request}',now()+interval '1 minute');`);
  const token=(await db.query<{token:string}>(`select public.acquire_capacity('fixture','${auction}',now()+interval '5 minutes') as token`)).rows[0]!.token;
  await expect(db.query(`select public.acquire_capacity('fixture','${auction}',now()+interval '5 minutes')`)).rejects.toThrow(/CAPACITY_EXCEEDED/);
  await db.exec(`select public.submit_bid('bid-fixture','${auction}','fixture','${token}','{}',now()+interval '5 minutes')`);
  expect((await db.query<{awarded:boolean}>(`select public.award_auction('${auction}','bid-fixture') as awarded`)).rows[0]!.awarded).toBe(false);
  await db.exec(`update public.auctions set deadline=now()-interval '1 second' where id='${auction}'`);
  await expect(db.query(`select public.submit_bid('late','${auction}','fixture','${token}','{}',now()+interval '5 minutes')`)).rejects.toThrow(/AUCTION_CLOSED/);
  const attempts=await Promise.all([db.query<{awarded:boolean}>(`select public.award_auction('${auction}','bid-fixture') as awarded`),db.query<{awarded:boolean}>(`select public.award_auction('${auction}','bid-fixture') as awarded`)]);
  expect(attempts.map(a=>a.rows[0]!.awarded).sort()).toEqual([false,true]);
  await db.exec(`update public.capacity_reservations set expires_at=now()-interval '1 second' where token='${token}'`);
  expect((await db.query<{status:string}>(`select status from public.capacity_reservations where token='${token}'`)).rows[0]!.status).toBe('executing');
  await db.exec(`select public.release_capacity('${token}')`);
  expect((await db.query<{status:string}>(`select status from public.capacity_reservations where token='${token}'`)).rows[0]!.status).toBe('released');
 });
});
