-- agylshyn — cloud progress sync, and the paid shelf (Supabase)
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Re-running it is safe: every statement is create-if-not-exists or replace.
-- It creates the table the app syncs to, plus the row-level security that makes
-- the public anon key safe to ship in client JS: every policy is scoped to
-- auth.uid(), so a signed-in reader can only ever touch their own rows. The
-- second part adds the admin list (public.admins + admin_list_users), which is
-- what lets the account panel show who has signed up — to an admin only. The
-- third part is the paywall: public.subscriptions, and public.book_content,
-- whose select policy is the only thing standing between a paid book and a
-- reader. That policy is the paywall — the lock drawn in the app is a courtesy,
-- and the JSON of a paid book is not on the static host at all.
--
-- Layout note: progress is stored ONE ROW PER BOOK, not one blob per user.
-- A learner who finishes everything accumulates ~20 000 answer records (each
-- carries the text they typed), which is megabytes; pushing that whole blob after
-- every answer would be wasteful. Per-book rows keep a push to the book actually
-- being practised. The pseudo-book id '__meta' holds the cross-book bits
-- (daily counts, last-opened, placement result).

create table if not exists public.progress (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  book_id    text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

alter table public.progress enable row level security;

-- Four explicit policies rather than one "for all": clearer to audit, and an
-- accidental drop of one leaves the others still restricting.
drop policy if exists progress_select_own on public.progress;
create policy progress_select_own on public.progress
  for select using (auth.uid() = user_id);

drop policy if exists progress_insert_own on public.progress;
create policy progress_insert_own on public.progress
  for insert with check (auth.uid() = user_id);

drop policy if exists progress_update_own on public.progress;
create policy progress_update_own on public.progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists progress_delete_own on public.progress;
create policy progress_delete_own on public.progress
  for delete using (auth.uid() = user_id);

-- The client sends updated_at on upsert, but a trigger means the column is still
-- honest if a row is ever touched from elsewhere (SQL editor, another client).
create or replace function public.progress_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists progress_touch on public.progress;
create trigger progress_touch
  before insert or update on public.progress
  for each row execute function public.progress_touch();

-- "Delete my account" — the anon key cannot touch auth.users, and GoTrue has no
-- self-serve delete, so the account panel calls this instead. SECURITY DEFINER
-- lets it reach auth.users while auth.uid() pins it to the caller's own row: a
-- signed-in reader can delete themselves and nobody else. The progress rows go
-- with them through the on delete cascade on the foreign key.
--
-- Leaving this function out is a safe choice; the panel reports the 404 rather
-- than claiming an account was removed when it was not.
create or replace function public.delete_me()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;

-- ===================== the paid shelf =====================
--
-- Two tables and one function. A subscription is to the app, not to a list of
-- books: one row per account, one of two plans, and the only question the rest
-- of this section asks is whether that row is live right now.
--
--   monthly   expires_at is a date. Granting again extends it.
--   lifetime  expires_at is null and never comes round.
--
-- Nothing here is writable by a client. Payment is a Kaspi transfer and the
-- grant is a button in the admin panel, which runs admin_grant() below — so a
-- subscription can only ever come from an account already in public.admins.

create table if not exists public.subscriptions (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  plan       text        not null check (plan in ('monthly', 'lifetime')),
  -- null means "never expires", which is what lifetime is. A monthly row always
  -- carries a date, and the check keeps the two from being confused.
  expires_at timestamptz,
  granted_at timestamptz not null default now(),
  granted_by uuid        references auth.users (id) on delete set null,
  note       text        not null default '',
  constraint subscriptions_plan_expiry check (
    (plan = 'lifetime' and expires_at is null) or
    (plan = 'monthly'  and expires_at is not null)
  )
);

alter table public.subscriptions enable row level security;

-- Read-your-own and nothing else. There is deliberately NO insert or update
-- policy: a reader who edits the page in devtools can ask what they have, and
-- cannot give themselves anything.
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select using (auth.uid() = user_id);

revoke all on table public.subscriptions from anon, authenticated;
grant select on table public.subscriptions to authenticated;

-- The whole paywall, in one predicate. SECURITY DEFINER so it can read the
-- table past RLS, and so the *server's* clock decides whether a monthly
-- subscription has run out — a browser with its date set forward gets nothing.
create or replace function public.has_access()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.subscriptions s
     where s.user_id = auth.uid()
       and (s.plan = 'lifetime' or s.expires_at > now())
  );
$$;

revoke all on function public.has_access() from public, anon;
grant execute on function public.has_access() to authenticated;

-- What the account panel shows. A single row read would nearly do, but the
-- "is it still live" answer has to come from the server's clock, and a client
-- that has to compute it from expires_at is a client that can be wrong about
-- it in both directions.
create or replace function public.my_access()
returns table (plan text, expires_at timestamptz, active boolean)
language sql
stable
security definer
set search_path = public, auth
as $$
  select s.plan, s.expires_at,
         (s.plan = 'lifetime' or s.expires_at > now())
    from public.subscriptions s
   where s.user_id = auth.uid();
$$;

revoke all on function public.my_access() from public, anon;
grant execute on function public.my_access() to authenticated;

-- The paid books themselves. site/tools/split_content.py keeps these files out
-- of the published site and out of the repository; upload_content.py puts them
-- here with the service_role key, which bypasses RLS and must never reach a
-- browser. The largest book is ~650 KB of JSON and all of them together are
-- under 4 MB, which is why this is a jsonb column and not a storage bucket:
-- PostgREST already answers it under RLS, with no signed urls to expire.
create table if not exists public.book_content (
  book_id    text        primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

alter table public.book_content enable row level security;

-- The one policy that costs money if it is wrong. No insert, update or delete
-- policy exists at all: the only writer is the upload tool, and service_role
-- does not consult policies.
drop policy if exists book_content_select_subscribed on public.book_content;
create policy book_content_select_subscribed on public.book_content
  for select using (public.has_access());

revoke all on table public.book_content from anon, authenticated;
grant select on table public.book_content to authenticated;

-- ===================== admins and the user list =====================
--
-- The account panel shows "who else has signed up" to an admin and to nobody
-- else. Two things have to be true for that to be safe with a public anon key:
-- the list must not be reachable by a reader who edits the page in devtools,
-- and "who is an admin" must not be something a client can write. Hence a
-- table with no write policy at all (admin is granted here, in the SQL editor)
-- and a SECURITY DEFINER function that re-checks the caller itself.

create table if not exists public.admins (
  user_id uuid        primary key references auth.users (id) on delete cascade,
  since   timestamptz not null default now()
);

alter table public.admins enable row level security;

-- The only question a client may ask this table is "am I one?" — which is what
-- draws the badge. There is deliberately NO insert/update/delete policy, so
-- even a stolen session cannot promote anybody.
drop policy if exists admins_select_own on public.admins;
create policy admins_select_own on public.admins
  for select using (auth.uid() = user_id);

-- Spelled out rather than left to Supabase's default privileges: reading is all
-- a client may do here, and anon (a signed-out visitor) has no business asking
-- at all. RLS above still decides which row comes back.
revoke all on table public.admins from anon, authenticated;
grant select on table public.admins to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- The list itself. auth.users is out of reach of the anon key by design, so
-- this is the only way in — and it opens for admins alone. The per-user
-- counters are computed here rather than in the browser: the alternative is
-- shipping every learner's answers to the panel just to count them.
-- Dropped first, not replaced: this function has gained columns twice (the
-- subscription ones came with the paid shelf), and Postgres refuses to change a
-- function's return type in place. Without the drop, re-running this file on a
-- project that has the older version fails with "cannot change return type".
drop function if exists public.admin_list_users();

create or replace function public.admin_list_users()
returns table (
  id              uuid,
  email           text,
  name            text,
  created_at      timestamptz,
  last_sign_in_at timestamptz,
  confirmed       boolean,
  admin           boolean,
  books           int,
  answers         int,
  last_active     timestamptz,
  plan            text,
  expires_at      timestamptz,
  subscribed      boolean
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  return query
    select u.id,
           u.email::text,
           coalesce(u.raw_user_meta_data ->> 'name', '')::text,
           u.created_at,
           u.last_sign_in_at,
           (u.email_confirmed_at is not null),
           exists (select 1 from public.admins a where a.user_id = u.id),
           coalesce(s.books, 0),
           coalesce(s.answers, 0),
           s.last_active,
           b.plan,
           b.expires_at,
           -- The same test has_access() applies, spelled out here so the panel
           -- can grey out a lapsed row rather than hide the fact it existed.
           (b.user_id is not null
            and (b.plan = 'lifetime' or b.expires_at > now()))
      from auth.users u
      left join public.subscriptions b on b.user_id = u.id
      left join lateral (
        select (count(*) filter (where p.book_id <> '__meta'))::int as books,
               coalesce(sum(
                 case when p.book_id <> '__meta'
                      then (select count(*)
                              from jsonb_object_keys(
                                     coalesce(p.data -> 'items', '{}'::jsonb)))
                      else 0 end), 0)::int as answers,
               max(p.updated_at) as last_active
          from public.progress p
         where p.user_id = u.id
      ) s on true
     order by u.created_at;
end;
$$;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- ===================== granting =====================
--
-- Money arrives as a Kaspi transfer, so unlocking is a person pressing a button
-- once they have seen it. These two are that button. Both re-derive "am I an
-- admin" inside Postgres from the verified token, so the panel's buttons are a
-- convenience and not the control: calling this from a console as anybody else
-- gets 42501.
--
-- Granting monthly twice EXTENDS rather than replaces — somebody who pays for
-- their second month before the first has run out keeps the days they paid for,
-- which is the behaviour that avoids an argument.
create or replace function public.admin_grant(
  target uuid,
  p_plan text,
  p_days int default 30,
  p_note text default ''
)
returns public.subscriptions
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_from timestamptz;
  v_row  public.subscriptions;
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  if p_plan not in ('monthly', 'lifetime') then
    raise exception 'plan must be monthly or lifetime';
  end if;

  if p_plan = 'lifetime' then
    insert into public.subscriptions (user_id, plan, expires_at, granted_at, granted_by, note)
    values (target, 'lifetime', null, now(), auth.uid(), coalesce(p_note, ''))
    on conflict (user_id) do update
      set plan = 'lifetime', expires_at = null, granted_at = now(),
          granted_by = auth.uid(), note = coalesce(p_note, '')
    returning * into v_row;
    return v_row;
  end if;

  if p_days is null or p_days <= 0 then
    raise exception 'days must be a positive number';
  end if;

  -- Extend from whichever is later: today, or the day the current month ends.
  -- A lapsed subscription therefore starts again from today rather than from
  -- the date it died, and a live one is pushed further out.
  select greatest(now(), coalesce(s.expires_at, now()))
    into v_from
    from public.subscriptions s
   where s.user_id = target;
  v_from := coalesce(v_from, now());

  insert into public.subscriptions (user_id, plan, expires_at, granted_at, granted_by, note)
  values (target, 'monthly', v_from + make_interval(days => p_days), now(), auth.uid(),
          coalesce(p_note, ''))
  on conflict (user_id) do update
    set plan = 'monthly',
        -- excluded.* is the row we just tried to insert, so this is the same
        -- extended date; a lifetime row being switched to monthly loses its
        -- null expiry, which is what makes the downgrade land.
        expires_at = excluded.expires_at,
        granted_at = now(), granted_by = auth.uid(), note = coalesce(p_note, '')
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.admin_grant(uuid, text, int, text) from public, anon;
grant execute on function public.admin_grant(uuid, text, int, text) to authenticated;

create or replace function public.admin_revoke(target uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'not an admin' using errcode = '42501';
  end if;
  delete from public.subscriptions where user_id = target;
end;
$$;

revoke all on function public.admin_revoke(uuid) from public, anon;
grant execute on function public.admin_revoke(uuid) to authenticated;

-- The first admin. CHANGE THE ADDRESS to yours before running this. It has to
-- be an account that already exists, so if you are setting the project up from
-- scratch: run the file, sign up in the app, then run this block again.
-- A project with nobody in public.admins simply has no user list anywhere,
-- which is the safe default for a fork.
do $$
declare
  v_email text := 'bopebaqytkeldy@gmail.com';
  v_id    uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    raise notice 'No account for % yet — sign up in the app, then re-run this block.', v_email;
  else
    insert into public.admins (user_id) values (v_id) on conflict (user_id) do nothing;
    raise notice 'Admin: %', v_email;
  end if;
end
$$;

-- ===================== classes =====================
--
-- A teacher with a group of students is the one reader who cannot use this site
-- as it stands: they can see their own progress and nobody else's, and the only
-- other view that exists (admin_list_users) is the whole database, which is not
-- a thing to hand to a tutor.
--
-- So: a class is a row somebody owns, students join it with a six-character
-- code, and the owner can see the counters of the people who joined — and
-- nothing else. Two rules make that safe to expose over the anon key:
--
--   1. No client ever touches these tables directly. Both are RLS-enabled with
--      a read-your-own policy and no write policy at all; everything below is a
--      SECURITY DEFINER function that re-derives who is asking from the token.
--   2. A teacher sees COUNTERS, never answers. class_progress returns how much
--      has been done and how much of it was right. What a student typed is
--      theirs, and no function here returns it.
--
-- Anybody may create a class. That is deliberate: a tutor should not have to
-- ask the site's owner for permission to teach, and a class with nobody in it
-- costs one row.

create table if not exists public.classes (
  id         uuid        primary key default gen_random_uuid(),
  owner      uuid        not null references auth.users (id) on delete cascade,
  name       text        not null,
  -- The join code. Unique, short enough to read out in a lesson, and drawn
  -- from an alphabet with no 0/O or 1/I in it for the same reason.
  code       text        not null unique,
  created_at timestamptz not null default now()
);

create index if not exists classes_owner_idx on public.classes (owner);

create table if not exists public.class_members (
  class_id  uuid        not null references public.classes (id) on delete cascade,
  user_id   uuid        not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);

create index if not exists class_members_user_idx on public.class_members (user_id);

alter table public.classes enable row level security;
alter table public.class_members enable row level security;

-- Read-your-own only, and no write policy anywhere: a class is created, joined
-- and left through the functions below, which is what keeps "who owns this
-- class" out of a client's reach.
drop policy if exists classes_select_own on public.classes;
create policy classes_select_own on public.classes
  for select using (
    auth.uid() = owner
    or exists (select 1 from public.class_members m
                where m.class_id = id and m.user_id = auth.uid())
  );

drop policy if exists class_members_select_own on public.class_members;
create policy class_members_select_own on public.class_members
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.classes c
                where c.id = class_id and c.owner = auth.uid())
  );

revoke all on table public.classes from anon, authenticated;
revoke all on table public.class_members from anon, authenticated;
grant select on table public.classes to authenticated;
grant select on table public.class_members to authenticated;

-- A code somebody has to read out loud and somebody else has to type on a
-- phone: no 0/O, no 1/I/L, no vowels (which is also how it avoids spelling
-- anything). Collisions are retried rather than trusted away.
create or replace function public.class_new_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet text := '23456789BCDFGHJKMNPQRSTVWXYZ';
  v_code     text;
  v_try      int := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.classes c where c.code = v_code);
    v_try := v_try + 1;
    if v_try > 50 then
      raise exception 'could not find a free class code';
    end if;
  end loop;
  return v_code;
end;
$$;

revoke all on function public.class_new_code() from public, anon, authenticated;

create or replace function public.class_create(p_name text)
returns public.classes
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.classes;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a class needs a name';
  end if;
  -- A cap, so a stolen token cannot fill the table.
  if (select count(*) from public.classes c where c.owner = auth.uid()) >= 20 then
    raise exception 'too many classes';
  end if;
  insert into public.classes (owner, name, code)
  values (auth.uid(), left(btrim(p_name), 60), public.class_new_code())
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.class_create(text) from public, anon;
grant execute on function public.class_create(text) to authenticated;

create or replace function public.class_join(p_code text)
returns public.classes
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.classes;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v_row from public.classes c
   where upper(c.code) = upper(btrim(p_code));
  if v_row.id is null then
    raise exception 'no class with that code' using errcode = 'P0002';
  end if;
  if v_row.owner = auth.uid() then
    raise exception 'this is your own class';
  end if;
  insert into public.class_members (class_id, user_id)
  values (v_row.id, auth.uid())
  on conflict (class_id, user_id) do nothing;
  return v_row;
end;
$$;

revoke all on function public.class_join(text) from public, anon;
grant execute on function public.class_join(text) to authenticated;

-- Leaving is a student's own decision and needs no permission from the owner;
-- removing somebody else is the owner's, and is the same statement with the
-- other half of the check.
create or replace function public.class_leave(p_class uuid, p_user uuid default null)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_target uuid := coalesce(p_user, auth.uid());
begin
  if v_target <> auth.uid()
     and not exists (select 1 from public.classes c
                      where c.id = p_class and c.owner = auth.uid()) then
    raise exception 'not your class' using errcode = '42501';
  end if;
  delete from public.class_members m
   where m.class_id = p_class and m.user_id = v_target;
end;
$$;

revoke all on function public.class_leave(uuid, uuid) from public, anon;
grant execute on function public.class_leave(uuid, uuid) to authenticated;

create or replace function public.class_delete(p_class uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (select 1 from public.classes c
                  where c.id = p_class and c.owner = auth.uid()) then
    raise exception 'not your class' using errcode = '42501';
  end if;
  delete from public.classes where id = p_class;
end;
$$;

revoke all on function public.class_delete(uuid) from public, anon;
grant execute on function public.class_delete(uuid) to authenticated;

-- Every class this account has anything to do with, teaching and studying
-- alike, in one call: the page shows both and a second round trip to draw one
-- list under the other would be waste.
drop function if exists public.my_classes();

create or replace function public.my_classes()
returns table (
  id       uuid,
  name     text,
  code     text,
  mine     boolean,
  students int,
  owner_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select c.id,
         c.name,
         -- The code is the way in, so it is the owner's to hand out and not a
         -- student's to pass on.
         case when c.owner = auth.uid() then c.code else null end,
         (c.owner = auth.uid()),
         (select count(*)::int from public.class_members m where m.class_id = c.id),
         coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email::text, '@', 1))::text,
         c.created_at
    from public.classes c
    join auth.users u on u.id = c.owner
   where c.owner = auth.uid()
      or exists (select 1 from public.class_members m
                  where m.class_id = c.id and m.user_id = auth.uid())
   order by (c.owner = auth.uid()) desc, c.created_at;
$$;

revoke all on function public.my_classes() from public, anon;
grant execute on function public.my_classes() to authenticated;

-- What the teacher actually looks at. Counters only — how much has been
-- answered, how much of it was right, when they were last here. No function in
-- this file returns a student's answers, and none should: a class is a
-- progress board, not a surveillance tool.
--
-- `correct` is counted inside Postgres for the same reason admin_list_users
-- counts there: the alternative is shipping every student's whole progress to
-- a browser in order to count it.
drop function if exists public.class_progress(uuid);

create or replace function public.class_progress(p_class uuid)
returns table (
  user_id     uuid,
  email       text,
  name        text,
  joined_at   timestamptz,
  books       int,
  answers     int,
  correct     int,
  last_active timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not exists (select 1 from public.classes c
                  where c.id = p_class and c.owner = auth.uid()) then
    raise exception 'not your class' using errcode = '42501';
  end if;
  return query
    select u.id,
           u.email::text,
           coalesce(u.raw_user_meta_data ->> 'name', '')::text,
           m.joined_at,
           coalesce(s.books, 0),
           coalesce(s.answers, 0),
           coalesce(s.correct, 0),
           s.last_active
      from public.class_members m
      join auth.users u on u.id = m.user_id
      left join lateral (
        select (count(*) filter (where p.book_id <> '__meta'))::int as books,
               coalesce(sum(
                 case when p.book_id <> '__meta'
                      then (select count(*) from jsonb_object_keys(
                              coalesce(p.data -> 'items', '{}'::jsonb)))
                      else 0 end), 0)::int as answers,
               coalesce(sum(
                 case when p.book_id <> '__meta'
                      then (select count(*)
                              from jsonb_each(coalesce(p.data -> 'items', '{}'::jsonb)) kv
                             where kv.value ->> 'last' = 'correct')
                      else 0 end), 0)::int as correct,
               max(p.updated_at) as last_active
          from public.progress p
         where p.user_id = m.user_id
      ) s on true
     where m.class_id = p_class
     order by s.last_active desc nulls last;
end;
$$;

revoke all on function public.class_progress(uuid) from public, anon;
grant execute on function public.class_progress(uuid) to authenticated;
