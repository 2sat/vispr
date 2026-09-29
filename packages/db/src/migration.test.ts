import { readFile } from 'node:fs/promises';
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
  const migration = await readFile(new URL('../../../supabase/migrations/202609290001_foundation.sql', import.meta.url), 'utf8');
  await db.exec(migration);
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
