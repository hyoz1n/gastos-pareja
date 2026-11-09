-- Gastos en pareja: cada hogar admite dos personas.
-- Los gastos comunes los ven ambas; los personales, solo quien los registró.

create schema if not exists private;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text unique,
  created_at timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid not null default auth.uid(),
  paid_by uuid not null,
  scope text not null check (scope in ('comun', 'personal')),
  amount bigint not null check (amount > 0 and amount <= 1000000000),
  description text not null check (char_length(description) between 1 and 100),
  category text not null check (category in ('Alimentación', 'Hogar', 'Servicios', 'Transporte', 'Salud', 'Entretención', 'Compras', 'Mascotas', 'Otros')),
  spent_on date not null default ((now() at time zone 'America/Santiago')::date),
  payer_share smallint not null default 50 check (payer_share between 0 and 100),
  created_at timestamptz not null default now(),
  foreign key (household_id, paid_by) references public.members(household_id, user_id) on delete cascade,
  foreign key (household_id, created_by) references public.members(household_id, user_id) on delete cascade,
  check (scope = 'comun' or (paid_by = created_by and payer_share = 100))
);
create index expenses_household_date_idx on public.expenses(household_id, spent_on desc);
create index expenses_paid_by_idx on public.expenses(household_id, paid_by);
create index expenses_created_by_idx on public.expenses(household_id, created_by);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  from_user uuid not null,
  to_user uuid not null,
  amount bigint not null check (amount > 0 and amount <= 1000000000),
  paid_on date not null default ((now() at time zone 'America/Santiago')::date),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (household_id, from_user) references public.members(household_id, user_id) on delete cascade,
  foreign key (household_id, to_user) references public.members(household_id, user_id) on delete cascade,
  check (from_user <> to_user)
);
create index settlements_household_idx on public.settlements(household_id, paid_on desc);
create index settlements_from_idx on public.settlements(household_id, from_user);
create index settlements_to_idx on public.settlements(household_id, to_user);

-- Función definer para que las políticas no se llamen a sí mismas sobre members.
create function private.is_member(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = p_household and m.user_id = (select auth.uid())
  );
$$;
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on function private.is_member(uuid) from public;
grant execute on function private.is_member(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.expenses enable row level security;
alter table public.settlements enable row level security;

revoke all on public.households, public.members, public.expenses, public.settlements from anon, authenticated;
grant select on public.households, public.members to authenticated;
grant update (display_name) on public.members to authenticated;
grant select, insert, delete on public.expenses to authenticated;
-- created_by y household_id quedan fuera: un gasto no puede cambiar de dueño.
grant update (paid_by, scope, amount, description, category, spent_on, payer_share) on public.expenses to authenticated;
grant select, insert, delete on public.settlements to authenticated;

create policy households_select on public.households
  for select to authenticated using (private.is_member(id));

create policy members_select on public.members
  for select to authenticated using (private.is_member(household_id));
create policy members_update_self on public.members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy expenses_select on public.expenses
  for select to authenticated
  using (private.is_member(household_id) and (scope = 'comun' or created_by = (select auth.uid())));
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (private.is_member(household_id) and created_by = (select auth.uid()));
create policy expenses_update on public.expenses
  for update to authenticated
  using (private.is_member(household_id) and (scope = 'comun' or created_by = (select auth.uid())))
  with check (private.is_member(household_id) and (scope = 'comun' or created_by = (select auth.uid())));
create policy expenses_delete on public.expenses
  for delete to authenticated
  using (private.is_member(household_id) and (scope = 'comun' or created_by = (select auth.uid())));

create policy settlements_select on public.settlements
  for select to authenticated using (private.is_member(household_id));
create policy settlements_insert on public.settlements
  for insert to authenticated
  with check (private.is_member(household_id) and created_by = (select auth.uid()));
create policy settlements_delete on public.settlements
  for delete to authenticated using (private.is_member(household_id));

create function public.create_household(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Debe iniciar sesión.';
  end if;
  if exists (select 1 from public.members where user_id = v_user) then
    raise exception 'Su cuenta ya pertenece a un hogar.';
  end if;
  insert into public.households (name, invite_code)
  values (trim(p_name), upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)))
  returning id into v_id;
  insert into public.members (household_id, user_id, display_name)
  values (v_id, v_user, trim(p_display_name));
  return v_id;
end;
$$;

create function public.join_household(p_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Debe iniciar sesión.';
  end if;
  if exists (select 1 from public.members where user_id = v_user) then
    raise exception 'Su cuenta ya pertenece a un hogar.';
  end if;
  select id into v_id from public.households
  where invite_code = upper(trim(p_code))
  for update;
  if v_id is null then
    raise exception 'El código de invitación no es válido.';
  end if;
  insert into public.members (household_id, user_id, display_name)
  values (v_id, v_user, trim(p_display_name));
  -- El hogar queda completo: el código deja de servir.
  update public.households set invite_code = null where id = v_id;
  return v_id;
end;
$$;

-- Positivo: la otra persona le debe a quien consulta. Respeta las políticas de cada tabla.
create function public.get_balance(p_household uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select (
    coalesce((
      select sum(
        (case when e.paid_by = (select auth.uid()) then 1 else -1 end)
        * round(e.amount * (100 - e.payer_share) / 100.0)
      )
      from public.expenses e
      where e.household_id = p_household and e.scope = 'comun'
    ), 0)
    + coalesce((
      select sum(case when s.from_user = (select auth.uid()) then s.amount else -s.amount end)
      from public.settlements s
      where s.household_id = p_household
    ), 0)
  )::bigint;
$$;

revoke all on function public.create_household(text, text) from public, anon;
revoke all on function public.join_household(text, text) from public, anon;
revoke all on function public.get_balance(uuid) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.get_balance(uuid) to authenticated;
