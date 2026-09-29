create table public.schema_versions (version text primary key, applied_at timestamptz not null default now());
alter table public.schema_versions enable row level security;
revoke all on public.schema_versions from anon, authenticated;
grant select on public.schema_versions to service_role;
insert into public.schema_versions (version) values ('foundation-v1');
