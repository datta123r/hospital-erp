-- AarogyaOne authentication and authorization schema.
-- Run in the Supabase SQL editor as the postgres role.

create table if not exists public.user_access (
  email text primary key check (email = lower(email)),
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null default '',
  role text not null check (role in (
    'super','owner','hospitalAdmin','branchAdmin','receptionist','doctor','nurse',
    'pharmacist','labTech','pathologist','billing','accountant','inventory','patient','auditor'
  )),
  branch text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.login_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null,
  logged_in_at timestamptz not null default now(),
  user_agent text
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.user_access enable row level security;
alter table public.login_events enable row level security;
alter table public.audit_events enable row level security;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_access
  where email = lower(coalesce(auth.jwt()->>'email','')) and active = true
  limit 1
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('super','owner','hospitalAdmin'), false)
$$;

revoke all on function public.current_user_role() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "read own access" on public.user_access;
create policy "read own access" on public.user_access for select to authenticated
using (email = lower(coalesce(auth.jwt()->>'email','')) or public.is_admin());

drop policy if exists "admins add access" on public.user_access;
create policy "admins add access" on public.user_access for insert to authenticated
with check (public.is_admin());

drop policy if exists "admins update access" on public.user_access;
create policy "admins update access" on public.user_access for update to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete access" on public.user_access;
create policy "admins delete access" on public.user_access for delete to authenticated
using (public.is_admin());

drop policy if exists "record own login" on public.login_events;
create policy "record own login" on public.login_events for insert to authenticated
with check (user_id = auth.uid() and email = lower(coalesce(auth.jwt()->>'email','')));

drop policy if exists "admins read logins" on public.login_events;
create policy "admins read logins" on public.login_events for select to authenticated
using (public.is_admin());

drop policy if exists "admins read audit" on public.audit_events;
create policy "admins read audit" on public.audit_events for select to authenticated
using (public.is_admin());

drop policy if exists "admins write audit" on public.audit_events;
create policy "admins write audit" on public.audit_events for insert to authenticated
with check (public.is_admin() and actor_id = auth.uid());

create or replace function public.attach_access_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_access
     set user_id = new.id,
         full_name = case when full_name = '' then coalesce(new.raw_user_meta_data->>'full_name','') else full_name end,
         updated_at = now()
   where email = lower(new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_attach_access on auth.users;
create trigger on_auth_user_created_attach_access
after insert on auth.users
for each row execute function public.attach_access_on_signup();

insert into public.user_access (email, full_name, role, branch, active)
values ('dattaram923@gmail.com', 'Dattaram', 'hospitalAdmin', null, true)
on conflict (email) do update
set role = excluded.role, active = true, updated_at = now();

grant select, insert, update, delete on public.user_access to authenticated;
grant select, insert on public.login_events to authenticated;
grant select, insert on public.audit_events to authenticated;
grant usage, select on all sequences in schema public to authenticated;
