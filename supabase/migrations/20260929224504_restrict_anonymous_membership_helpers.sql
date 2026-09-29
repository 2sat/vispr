-- Supabase may grant EXECUTE directly to anon through default privileges.
-- These RLS helpers are for authenticated membership checks only.
revoke execute on function public.is_org_member(uuid), public.can_read_app(uuid) from anon;
