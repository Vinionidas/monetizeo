-- Monetizeo na nuvem (Supabase).
-- Cole este arquivo inteiro em SQL Editor > New query e clique em Run.
-- Pode rodar de novo sem medo: ele não apaga dados.
--
-- Modelo: cada "casa" guarda o estado do app em uma linha. Só quem é membro
-- da casa lê ou grava. Entra-se em uma casa criando-a ou com o código de convite.

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Casa',
  state jsonb,
  rev bigint not null default 1,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Uma cópia por dia do estado anterior, guardada por 60 dias.
create table if not exists public.household_backups (
  household_id uuid not null references public.households (id) on delete cascade,
  day date not null,
  state jsonb,
  primary key (household_id, day)
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_backups enable row level security;

-- Quem não está logado não acessa nada; quem está logado só o que as regras abaixo permitem.
revoke all on public.households, public.household_members, public.household_backups from anon, authenticated;
grant select, update (state, rev, name) on public.households to authenticated;
grant select on public.household_members, public.household_backups to authenticated;

create or replace function public.is_household_member(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = (select auth.uid())
  );
$$;

drop policy if exists "membros leem a casa" on public.households;
create policy "membros leem a casa" on public.households
  for select to authenticated using (public.is_household_member(id));

drop policy if exists "membros gravam a casa" on public.households;
create policy "membros gravam a casa" on public.households
  for update to authenticated using (public.is_household_member(id)) with check (public.is_household_member(id));

drop policy if exists "membros veem os membros" on public.household_members;
create policy "membros veem os membros" on public.household_members
  for select to authenticated using (public.is_household_member(household_id));

drop policy if exists "membros leem os backups" on public.household_backups;
create policy "membros leem os backups" on public.household_backups
  for select to authenticated using (public.is_household_member(household_id));

-- Cria a casa de quem está logado (uma por pessoa) e devolve o id.
create or replace function public.create_household(p_name text default 'Casa', p_state jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'nao_autenticado';
  end if;
  select household_id into v_id from public.household_members where user_id = v_user limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.households (name, state) values (coalesce(nullif(trim(p_name), ''), 'Casa'), p_state) returning id into v_id;
  insert into public.household_members (household_id, user_id) values (v_id, v_user);
  return v_id;
end;
$$;

-- Entra na casa de outra pessoa usando o código de convite dela.
create or replace function public.join_household(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'nao_autenticado';
  end if;
  select id into v_id from public.households where invite_code = lower(trim(p_code));
  if v_id is null then
    raise exception 'codigo_invalido';
  end if;
  insert into public.household_members (household_id, user_id) values (v_id, v_user) on conflict do nothing;
  return v_id;
end;
$$;

revoke all on function public.create_household(text, jsonb) from public, anon;
revoke all on function public.join_household(text) from public, anon;
revoke all on function public.is_household_member(uuid) from public, anon;
grant execute on function public.create_household(text, jsonb) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;

-- A cada gravação: guarda a versão anterior (uma por dia) e limpa as antigas.
create or replace function public.household_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state is distinct from old.state then
    if old.state is not null then
      insert into public.household_backups (household_id, day, state)
      values (old.id, current_date, old.state)
      on conflict do nothing;
      delete from public.household_backups where household_id = old.id and day < current_date - 60;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists household_before_update on public.households;
create trigger household_before_update
  before update on public.households
  for each row execute function public.household_before_update();
