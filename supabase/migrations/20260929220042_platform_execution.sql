-- Service-only execution boundary. Browser reads continue to use foundation RLS.
alter table public.applications add column default_policy_id text not null default 'balanced';
alter table public.inference_requests add column cancel_requested boolean not null default false;
alter table public.inference_requests add column dispatched_at timestamptz;
alter table public.inference_requests add column generation_id text;
alter table public.inference_requests add column transport text;
alter table public.inference_requests add column serving_identity text;
alter table public.inference_requests add column selected_deployment jsonb;
alter table public.inference_requests add column usage jsonb;
create table public.execution_offerings (
 application_id uuid not null, policy_id text not null, policy_version integer not null,
 deployment jsonb not null, base_url text not null, secret_reference text not null,
 -- Operator-certified upper rates include reasoning/cache and all extra charges.
 input_micros_per_million bigint not null check (input_micros_per_million >= 0),
 output_micros_per_million bigint not null check (output_micros_per_million >= 0),
 bounded boolean not null default false,
 primary key(application_id, policy_id, policy_version),
 foreign key(application_id, policy_id, policy_version) references public.policy_versions(application_id, policy_id, version)
);
alter table public.execution_offerings enable row level security;
revoke all on public.execution_offerings from public, anon, authenticated;
grant all on public.execution_offerings to service_role;
create function public.begin_execution(p_app uuid, p_key text, p_policy text, p_version integer, p_amount bigint, p_request_limit bigint, p_daily_limit bigint)
returns uuid language plpgsql set search_path = '' as $$
declare result uuid; total bigint;
begin
 -- A single demo ledger serializes reservations across every application/device.
 perform pg_advisory_xact_lock(78293412);
 if p_amount < 0 or p_amount > least(p_request_limit, 250000) then raise exception 'BUDGET_EXCEEDED'; end if;
 select coalesce(sum(case when status = 'settled' then actual_cost_micros when status in ('reserved','uncertain') then amount_micros else 0 end),0)
 into total from public.spend_reservations
 where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
 -- Outstanding charges from previous days also remain encumbered.
 or status in ('reserved','uncertain');
 if total + p_amount > least(p_daily_limit, 10000000) then raise exception 'BUDGET_EXCEEDED'; end if;
 insert into public.inference_requests(application_id,idempotency_key,policy_id,policy_version)
 values(p_app,p_key,p_policy,p_version) returning id into result;
 insert into public.spend_reservations(application_id,request_id,amount_micros) values(p_app,result,p_amount);
 return result;
end $$;
create function public.mark_dispatched(p_app uuid,p_request uuid) returns boolean language plpgsql set search_path = '' as $$
begin
 update public.inference_requests set dispatched_at = now(), status = 'executing'
 where id = p_request and application_id = p_app and status in ('created','awarded') and dispatched_at is null and not cancel_requested
 and exists(select 1 from public.spend_reservations where request_id=p_request and application_id=p_app and status='reserved');
 return found;
end $$;
create function public.finish_execution(p_app uuid,p_request uuid,p_status text,p_usage jsonb default null)
returns void language plpgsql set search_path = '' as $$
declare dispatched timestamptz; cost bigint;
begin
 select dispatched_at into dispatched from public.inference_requests where id = p_request and application_id = p_app for update;
 if not found then raise exception 'UNKNOWN_REQUEST'; end if;
 if p_status not in ('completed','failed','cancelled') then raise exception 'INVALID_STATUS'; end if;
 cost := (p_usage->>'actualCostMicros')::bigint;
 update public.spend_reservations set actual_cost_micros = cost,
 status = case when cost is not null then 'settled' when dispatched is null then 'released' else 'uncertain' end
 where request_id = p_request and application_id = p_app and status in ('reserved','uncertain');
 update public.inference_requests set status=p_status,usage=coalesce(p_usage,usage),generation_id=coalesce(p_usage->>'generationId',generation_id),serving_identity=coalesce(p_usage->>'servingProvider',serving_identity)
 where id=p_request and application_id=p_app;
end $$;
revoke all on function public.begin_execution(uuid,text,text,integer,bigint,bigint,bigint), public.mark_dispatched(uuid,uuid), public.finish_execution(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.begin_execution(uuid,text,text,integer,bigint,bigint,bigint), public.mark_dispatched(uuid,uuid), public.finish_execution(uuid,uuid,text,jsonb) to service_role;
create function public.create_application(p_org uuid,p_owner uuid,p_name text,p_policy jsonb) returns uuid language plpgsql set search_path = '' as $$
declare app uuid;
begin
 if not exists(select 1 from public.memberships where organization_id=p_org and user_id=p_owner and role in ('owner','builder')) then raise exception 'UNAUTHORIZED'; end if;
 insert into public.applications(organization_id,owner_user_id,name,default_policy_id,retain_payloads)
 values(p_org,p_owner,p_name,p_policy->>'id',coalesce((p_policy->>'retainPayloads')::boolean,false)) returning id into app;
 insert into public.policy_versions(application_id,policy_id,version,policy) values(app,p_policy->>'id',(p_policy->>'version')::integer,p_policy);
 return app;
end $$;
revoke all on function public.create_application(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_application(uuid,uuid,text,jsonb) to service_role;
create table public.provider_deployments (
 id text primary key, provider_id uuid not null references public.providers(id), deployment jsonb not null,
 base_url text not null, secret_reference text not null, capacity integer not null check(capacity>0),
 verified_at timestamptz, created_at timestamptz not null default now()
);
create table public.auctions (
 id uuid primary key default gen_random_uuid(), application_id uuid not null, request_id uuid not null unique,
 deadline timestamptz not null, status text not null default 'bidding' check(status in ('bidding','awarded','no_bid','cancelled')),
 foreign key(application_id,request_id) references public.inference_requests(application_id,id)
);
create table public.capacity_reservations (
 token uuid primary key default gen_random_uuid(), deployment_id text not null references public.provider_deployments(id),
 auction_id uuid not null references public.auctions(id), expires_at timestamptz not null,
 status text not null default 'reserved' check(status in ('reserved','executing','released')),
 unique(deployment_id,auction_id)
);
create table public.bids (
 id text primary key, auction_id uuid not null references public.auctions(id), deployment_id text not null references public.provider_deployments(id),
 reservation_token uuid not null unique references public.capacity_reservations(token), bid jsonb not null,
 valid_until timestamptz not null, received_at timestamptz not null default now()
);
create table public.awards (
 auction_id uuid primary key references public.auctions(id), bid_id text not null unique references public.bids(id),
 created_at timestamptz not null default now()
);
alter table public.provider_deployments enable row level security;
alter table public.auctions enable row level security;
alter table public.capacity_reservations enable row level security;
alter table public.bids enable row level security;
alter table public.awards enable row level security;
revoke all on public.provider_deployments,public.auctions,public.capacity_reservations,public.bids,public.awards from public,anon,authenticated;
grant all on public.provider_deployments,public.auctions,public.capacity_reservations,public.bids,public.awards to service_role;
create function public.acquire_capacity(p_deployment text,p_auction uuid,p_expires timestamptz) returns uuid language plpgsql set search_path='' as $$
declare slots integer; used integer; result uuid;
begin
 select capacity into slots from public.provider_deployments where id=p_deployment and verified_at is not null and deployment->>'status'='active' for update;
 if not found then raise exception 'DEPLOYMENT_UNAVAILABLE'; end if;
 if p_expires<=clock_timestamp() then raise exception 'INVALID_EXPIRY'; end if;
 if not exists(select 1 from public.auctions where id=p_auction and status='bidding' and deadline>clock_timestamp()) then raise exception 'AUCTION_CLOSED'; end if;
 select count(*) into used from public.capacity_reservations where deployment_id=p_deployment and (status='executing' or(status='reserved' and expires_at>clock_timestamp()));
 if used>=slots then raise exception 'CAPACITY_EXCEEDED'; end if;
 insert into public.capacity_reservations(deployment_id,auction_id,expires_at)values(p_deployment,p_auction,p_expires)returning token into result;
 return result;
end $$;
create function public.submit_bid(p_id text,p_auction uuid,p_deployment text,p_token uuid,p_bid jsonb,p_valid_until timestamptz) returns void language plpgsql set search_path='' as $$
declare closes timestamptz;
begin
 select deadline into closes from public.auctions where id=p_auction and status='bidding' for update;
 if not found or closes<=clock_timestamp() then raise exception 'AUCTION_CLOSED'; end if;
 if p_valid_until<=clock_timestamp() then raise exception 'BID_EXPIRED'; end if;
 if not exists(select 1 from public.capacity_reservations where token=p_token and auction_id=p_auction and deployment_id=p_deployment and status='reserved' and expires_at>clock_timestamp()) then raise exception 'INVALID_CAPACITY'; end if;
 insert into public.bids(id,auction_id,deployment_id,reservation_token,bid,valid_until)values(p_id,p_auction,p_deployment,p_token,p_bid,p_valid_until);
end $$;
create function public.award_auction(p_auction uuid,p_bid text) returns boolean language plpgsql set search_path='' as $$
declare chosen public.bids; request uuid;
begin
 select request_id into request from public.auctions where id=p_auction and status='bidding' and deadline<=clock_timestamp() for update;
 if not found then return false; end if;
 select * into chosen from public.bids where id=p_bid and auction_id=p_auction and valid_until>clock_timestamp();
 if not found then raise exception 'BID_EXPIRED'; end if;
 -- Serialize acquisition and award for this deployment. Executing capacity never expires automatically.
 perform 1 from public.provider_deployments where id=chosen.deployment_id for update;
 if chosen.valid_until<=clock_timestamp() then raise exception 'BID_EXPIRED'; end if;
 if not exists(select 1 from public.spend_reservations where request_id=request and status='reserved') then raise exception 'BUDGET_REQUIRED'; end if;
 update public.capacity_reservations set status='executing' where token=chosen.reservation_token and status='reserved' and expires_at>clock_timestamp();
 if not found then raise exception 'INVALID_CAPACITY'; end if;
 update public.inference_requests set status='awarded' where id=request and status in ('created','bidding') and not cancel_requested;
 if not found then raise exception 'REQUEST_UNAVAILABLE'; end if;
 insert into public.awards(auction_id,bid_id)values(p_auction,p_bid);
 update public.auctions set status='awarded' where id=p_auction;
 update public.capacity_reservations set status='released' where auction_id=p_auction and token<>chosen.reservation_token and status='reserved';
 return true;
end $$;
create function public.release_capacity(p_token uuid) returns void language sql set search_path='' as $$
 update public.capacity_reservations set status='released' where token=p_token;
$$;
revoke all on function public.acquire_capacity(text,uuid,timestamptz),public.submit_bid(text,uuid,text,uuid,jsonb,timestamptz),public.award_auction(uuid,text),public.release_capacity(uuid) from public,anon,authenticated;
grant execute on function public.acquire_capacity(text,uuid,timestamptz),public.submit_bid(text,uuid,text,uuid,jsonb,timestamptz),public.award_auction(uuid,text),public.release_capacity(uuid) to service_role;
create function public.release_undispatched() returns integer language plpgsql set search_path='' as $$
declare released integer;
begin
 with stale as (
 update public.inference_requests set status='cancelled',cancel_requested=true
 where status='created' and dispatched_at is null and created_at<now()-interval '1 hour'
 returning id
 ) update public.spend_reservations set status='released' where request_id in(select id from stale) and status='reserved';
 get diagnostics released = row_count;
 return released;
end $$;
revoke all on function public.release_undispatched() from public,anon,authenticated;
grant execute on function public.release_undispatched() to service_role;
-- Runtime loss does not release spend or capacity. Recover known generations for lookup.
create function public.mark_stale_executions() returns integer language plpgsql set search_path='' as $$
declare marked integer;
begin
 with stale as (
 update public.inference_requests set status='failed',usage=coalesce(usage,'{"inputTokens":0,"outputTokens":0,"actualCostMicros":null,"reconciliation":"pending"}'::jsonb)
 where status='executing' and dispatched_at<now()-interval '1 hour' returning id
 ) update public.spend_reservations set status='uncertain' where request_id in(select id from stale) and status='reserved';
 get diagnostics marked = row_count;
 return marked;
end $$;
revoke all on function public.mark_stale_executions() from public,anon,authenticated;
grant execute on function public.mark_stale_executions() to service_role;
