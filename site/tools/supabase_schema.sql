-- agylshyn — cloud progress sync (Supabase)
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It creates the single table the app syncs to, plus the row-level security that
-- makes the public anon key safe to ship in client JS: every policy is scoped to
-- auth.uid(), so a signed-in reader can only ever touch their own rows.
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


-- ===========================================================================
-- Entitlements — who may read which paid content
-- ===========================================================================
--
-- One table serves both business models, which is the point: the choice between
-- a monthly subscription and a one-off purchase is a value in `expires_at`, not
-- a schema. NULL means "forever" (bought outright); a timestamp means "until
-- then" (a subscription period). Switching models later, or running both side by
-- side, needs no migration and no code change beyond what sells the row.
--
-- `sku` is what was bought, not which book it unlocks. tiers.json maps books to
-- skus, so moving a book between tiers is a build-time edit rather than a
-- rewrite of everyone's rows. The wildcard sku 'all' unlocks everything.

create table if not exists public.entitlements (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  sku        text        not null,
  expires_at timestamptz,                     -- NULL = never expires
  source     text        not null default 'manual',   -- 'manual' | 'kaspi' | …
  note       text,                            -- receipt id, who granted it, why
  created_at timestamptz not null default now(),
  primary key (user_id, sku)
);

alter table public.entitlements enable row level security;

-- Read-only to the owner, and nothing else. There is deliberately no insert,
-- update or delete policy: a client holding the anon key must never be able to
-- grant itself access. Rows are written by the API with the service_role key,
-- which bypasses RLS entirely.
--
-- The client reads its own rows only to draw the UI (badges, lock icons, an
-- expiry date in the account panel). It is never the authority — api/main.py
-- checks the same rows again before it hands over a single byte of content.
drop policy if exists entitlements_select_own on public.entitlements;
create policy entitlements_select_own on public.entitlements
  for select using (auth.uid() = user_id);

-- Expiry is a read-time question, so an expired row is left in the table. That
-- is on purpose: it keeps the purchase history intact, and renewing is an upsert
-- of `expires_at` rather than a delete plus insert.
--
-- No index beyond the primary key: (user_id, sku) already has user_id as its
-- leading column, which is the only lookup either side makes. A partial index on
-- "still valid" is not possible anyway — now() is STABLE, not IMMUTABLE, so
-- Postgres rejects it in an index predicate.
