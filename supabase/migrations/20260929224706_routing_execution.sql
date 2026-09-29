-- Reviewed, application-owned routing inputs. Publication never enables a pool by itself.
create table public.routing_configs (
 application_id uuid not null, policy_id text not null, policy_version integer not null,
 catalog_snapshot_id uuid not null references public.catalog_snapshots(id),
 config jsonb not null, reviewed_by uuid not null references auth.users(id),
 reviewed_at timestamptz not null default now(), active boolean not null default false,
 primary key(application_id,policy_id,policy_version),
 foreign key(application_id,policy_id,policy_version) references public.policy_versions(application_id,policy_id,version)
);
alter table public.routing_configs enable row level security;
revoke all on public.routing_configs from public,anon,authenticated;
grant all on public.routing_configs to service_role;
alter table public.inference_requests add column classification_bound_micros bigint not null default 0 check(classification_bound_micros>=0);
alter table public.inference_requests add column classification_dispatched boolean not null default false;
alter table public.inference_requests add column classification_cost_micros bigint default 0 check(classification_cost_micros>=0);
alter table public.inference_requests add column routing_metadata jsonb;
create function public.authorize_classification(p_app uuid,p_request uuid,p_bound bigint) returns boolean language plpgsql set search_path='' as $$
begin
 if p_bound<=0 then raise exception 'INVALID_BOUND'; end if;
 update public.inference_requests set classification_dispatched=true,classification_cost_micros=null,classification_bound_micros=p_bound,status='classifying'
 where id=p_request and application_id=p_app and status='created' and not cancel_requested and not classification_dispatched
 and exists(select 1 from public.spend_reservations where request_id=p_request and application_id=p_app and status='reserved' and amount_micros>=p_bound);
 return found;
end $$;
revoke all on function public.authorize_classification(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.authorize_classification(uuid,uuid,bigint) to service_role;

-- Execution usage remains provider-only. The shared ledger also includes Jev.
create or replace function public.finish_execution(p_app uuid,p_request uuid,p_status text,p_usage jsonb default null)
returns void language plpgsql set search_path='' as $$
declare row public.inference_requests; execution_cost bigint; total bigint;
begin
 select * into row from public.inference_requests where id=p_request and application_id=p_app for update;
 if not found then raise exception 'UNKNOWN_REQUEST'; end if;
 if p_status not in ('completed','failed','cancelled') then raise exception 'INVALID_STATUS'; end if;
 execution_cost:=case when row.dispatched_at is null then 0 else (p_usage->>'actualCostMicros')::bigint end;
 total:=execution_cost+coalesce(case when row.classification_dispatched then row.classification_cost_micros else 0 end, null);
 update public.spend_reservations set actual_cost_micros=total,
 amount_micros=case when row.dispatched_at is null and row.classification_dispatched and total is null then row.classification_bound_micros else amount_micros end,
 status=case when total is not null then case when row.dispatched_at is null and not row.classification_dispatched then 'released' else 'settled' end else 'uncertain' end
 where request_id=p_request and application_id=p_app and status in ('reserved','uncertain','settled');
 update public.inference_requests set status=p_status,usage=coalesce(p_usage,usage),generation_id=coalesce(p_usage->>'generationId',generation_id),serving_identity=coalesce(p_usage->>'servingProvider',serving_identity)
 where id=p_request and application_id=p_app;
end $$;

-- A runtime loss before execution cannot turn a dispatched classifier into a refund.
create or replace function public.release_undispatched() returns integer language plpgsql set search_path='' as $$
declare row record; released integer:=0;
begin
 for row in select id,application_id from public.inference_requests
 where status in ('created','classifying','bidding','awarded') and dispatched_at is null and created_at<now()-interval '1 hour' for update
 loop
  update public.inference_requests set cancel_requested=true where id=row.id;
  perform public.finish_execution(row.application_id,row.id,'cancelled',null);
  update public.auctions set status='cancelled' where request_id=row.id;
  update public.capacity_reservations set status='released' where auction_id in(select id from public.auctions where request_id=row.id);
  released:=released+1;
 end loop;
 return released;
end $$;
create index inference_requests_application_created on public.inference_requests(application_id,created_at desc);
create index capacity_reservations_deployment_status on public.capacity_reservations(deployment_id,status,expires_at);
create index spend_reservations_outstanding on public.spend_reservations(status,created_at) where status in ('reserved','uncertain','settled');

create function public.publish_routing(p_app uuid,p_policy text,p_version integer,p_reviewer uuid,p_hash text,p_catalog jsonb,p_config jsonb,p_active boolean)
returns uuid language plpgsql set search_path='' as $$
declare snapshot_id uuid:=gen_random_uuid();
begin
 if not exists(select 1 from public.applications a join public.memberships m on m.organization_id=a.organization_id
 where a.id=p_app and m.user_id=p_reviewer and m.role='owner') then raise exception 'UNAUTHORIZED'; end if;
 insert into public.catalog_snapshots(id,source_hash,contract_version,snapshot)
 values(snapshot_id,p_hash,'0.1.0',jsonb_set(p_catalog,'{id}',to_jsonb(snapshot_id::text))) on conflict(source_hash) do nothing;
 select id into snapshot_id from public.catalog_snapshots where source_hash=p_hash;
 insert into public.routing_configs(application_id,policy_id,policy_version,catalog_snapshot_id,config,reviewed_by,active)
 values(p_app,p_policy,p_version,snapshot_id,p_config,p_reviewer,p_active)
 on conflict(application_id,policy_id,policy_version) do update set catalog_snapshot_id=excluded.catalog_snapshot_id,config=excluded.config,reviewed_by=excluded.reviewed_by,reviewed_at=now(),active=excluded.active;
 return snapshot_id;
end $$;
revoke all on function public.publish_routing(uuid,text,integer,uuid,text,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.publish_routing(uuid,text,integer,uuid,text,jsonb,jsonb,boolean) to service_role;

create function public.release_request_capacity(p_app uuid,p_request uuid) returns void language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.inference_requests where id=p_request and application_id=p_app and status in ('completed','failed','cancelled') and (dispatched_at is null or usage->>'actualCostMicros' is not null)) then
  update public.capacity_reservations set status='released' where auction_id in(select id from public.auctions where request_id=p_request and application_id=p_app);
 end if;
end $$;
revoke all on function public.release_request_capacity(uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_request_capacity(uuid,uuid) to service_role;
