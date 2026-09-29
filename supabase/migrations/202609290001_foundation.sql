-- Foundation only: atomic budget, capacity and award functions follow later.
create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table public.memberships (
 organization_id uuid not null references public.organizations(id), user_id uuid not null references auth.users(id),
 role text not null check (role in ('owner', 'builder', 'provider_manager')), primary key (organization_id, user_id)
);
create function public.is_org_member(org_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists (select 1 from public.memberships m where m.organization_id = org_id and m.user_id = auth.uid());
$$;
revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
create table public.applications (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 owner_user_id uuid not null references auth.users(id), name text not null, retain_payloads boolean not null default false,
 created_at timestamptz not null default now()
);
create function public.can_read_app(app_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists (select 1 from public.applications a join public.memberships m on m.organization_id = a.organization_id
 where a.id = app_id and m.user_id = auth.uid() and (a.owner_user_id = auth.uid() or m.role = 'owner'));
$$;
revoke all on function public.can_read_app(uuid) from public;
grant execute on function public.can_read_app(uuid) to authenticated, service_role;
create table public.policy_versions (
 application_id uuid not null references public.applications(id), policy_id text not null, version integer not null check (version > 0),
 policy jsonb not null, created_at timestamptz not null default now(), primary key (application_id, policy_id, version)
);
create table public.api_keys (
 id uuid primary key default gen_random_uuid(), application_id uuid not null references public.applications(id),
 key_hash text not null unique, prefix text not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
create table public.catalog_snapshots (
 id uuid primary key default gen_random_uuid(), source_hash text not null unique, contract_version text not null,
 snapshot jsonb not null, created_at timestamptz not null default now()
);
create table public.providers (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 manager_user_id uuid not null references auth.users(id), name text not null,
 transport text not null check (transport in ('openrouter', 'direct')),
 status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
 secret_reference text, created_at timestamptz not null default now()
);
create table public.inference_requests (
 id uuid primary key default gen_random_uuid(), application_id uuid not null references public.applications(id),
 idempotency_key text not null, policy_id text not null, policy_version integer not null,
 catalog_snapshot_id uuid references public.catalog_snapshots(id),
 status text not null default 'created' check (status in ('created', 'classifying', 'bidding', 'awarded', 'executing', 'completed', 'no_bid', 'failed', 'cancelled')),
 created_at timestamptz not null default now(),
 foreign key (application_id, policy_id, policy_version) references public.policy_versions(application_id, policy_id, version),
 unique (application_id, idempotency_key), unique (application_id, id)
);
create table public.trace_events (
 application_id uuid not null, request_id uuid not null, sequence integer not null check (sequence >= 0), event jsonb not null,
 created_at timestamptz not null default now(),
 foreign key (application_id, request_id) references public.inference_requests(application_id, id), primary key (request_id, sequence)
);
create table public.request_payloads (
 application_id uuid not null, request_id uuid primary key, payload jsonb not null, expires_at timestamptz not null,
 foreign key (application_id, request_id) references public.inference_requests(application_id, id)
);
create table public.spend_reservations (
 id uuid primary key default gen_random_uuid(), application_id uuid not null, request_id uuid not null,
 amount_micros bigint not null check (amount_micros >= 0), actual_cost_micros bigint check (actual_cost_micros >= 0),
 status text not null default 'reserved' check (status in ('reserved', 'settled', 'uncertain', 'released')),
 created_at timestamptz not null default now(),
 foreign key (application_id, request_id) references public.inference_requests(application_id, id),
 check (status <> 'settled' or actual_cost_micros is not null)
);
create table public.ingestion_runs (
 id uuid primary key default gen_random_uuid(), source_id text not null,
 status text not null check (status in ('pending', 'running', 'completed', 'failed')),
 cursor jsonb, lease_until timestamptz, summary jsonb, created_at timestamptz not null default now()
);
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.applications enable row level security;
alter table public.policy_versions enable row level security;
alter table public.api_keys enable row level security;
alter table public.catalog_snapshots enable row level security;
alter table public.providers enable row level security;
alter table public.inference_requests enable row level security;
alter table public.trace_events enable row level security;
alter table public.request_payloads enable row level security;
alter table public.spend_reservations enable row level security;
alter table public.ingestion_runs enable row level security;
create policy organization_read on public.organizations for select to authenticated using (public.is_org_member(id));
create policy membership_read on public.memberships for select to authenticated using (user_id = auth.uid());
create policy app_read on public.applications for select to authenticated using (public.can_read_app(id));
create policy policy_read on public.policy_versions for select to authenticated using (public.can_read_app(application_id));
create policy request_read on public.inference_requests for select to authenticated using (public.can_read_app(application_id));
create policy event_read on public.trace_events for select to authenticated using (public.can_read_app(application_id));
create policy payload_read on public.request_payloads for select to authenticated using (public.can_read_app(application_id));
create policy spend_read on public.spend_reservations for select to authenticated using (public.can_read_app(application_id));
create policy catalog_read on public.catalog_snapshots for select to authenticated using (exists (select 1 from public.memberships where user_id = auth.uid()));
-- Mutations and secret-bearing tables have no browser grants or policies.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.organizations, public.memberships, public.applications, public.policy_versions, public.catalog_snapshots,
 public.inference_requests, public.trace_events, public.request_payloads, public.spend_reservations to authenticated;
grant all on all tables in schema public to service_role;
