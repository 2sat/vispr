-- Raise the demo hard per-request ceiling to $5; preserve stricter policies and the shared $10/day ceiling.
-- CREATE OR REPLACE preserves the existing service-role-only grants.
create or replace function public.begin_execution(p_app uuid, p_key text, p_policy text, p_version integer, p_amount bigint, p_request_limit bigint, p_daily_limit bigint)
returns uuid language plpgsql set search_path = '' as $$
declare result uuid; total bigint;
begin
 -- A single demo ledger serializes reservations across every application/device.
 perform pg_advisory_xact_lock(78293412);
 if p_amount < 0 or p_amount > least(p_request_limit, 5000000) then raise exception 'BUDGET_EXCEEDED'; end if;
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
