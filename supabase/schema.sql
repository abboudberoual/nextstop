-- Next Stop: shared question bank + per-user progress. Applied to project koezutepgxjcmcbicahu (ca-central-1) on 2026-11-25.
create table if not exists public.questions (
  id          text primary key,
  course      text not null,
  topic       text not null,
  type        text not null check (type in ('mcq','tf','short')),
  data        jsonb not null,          -- question, choices, answer, explanation, source, keywords
  retired     boolean not null default false,
  updated_at  timestamptz not null default now()
);
create index if not exists questions_updated on public.questions (updated_at);

create table if not exists public.progress (
  user_id     uuid not null references auth.users (id) on delete cascade,
  qid         text not null,
  state       jsonb not null,          -- box, due, reps, lapses, seen, correct, last, updated (ms)
  updated_at  timestamptz not null default now(),
  primary key (user_id, qid)
);
create index if not exists progress_user_updated on public.progress (user_id, updated_at);

create table if not exists public.daily (
  user_id   uuid not null references auth.users (id) on delete cascade,
  device    text not null,
  day       date not null,
  answered  int not null default 0,
  correct   int not null default 0,
  primary key (user_id, device, day)
);

-- Server-side timestamp so pulls never miss a write from a device with a wrong clock.
create table if not exists public.bank_meta (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.bank_meta enable row level security;
drop policy if exists "read bank meta" on public.bank_meta;
create policy "read bank meta" on public.bank_meta for select to authenticated using (true);

create or replace function public.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists progress_touch on public.progress;
create trigger progress_touch before insert or update on public.progress for each row execute function public.touch();
drop trigger if exists questions_touch on public.questions;
create trigger questions_touch before insert or update on public.questions for each row execute function public.touch();

alter table public.questions enable row level security;
alter table public.progress  enable row level security;
alter table public.daily     enable row level security;

drop policy if exists "read bank" on public.questions;
create policy "read bank" on public.questions for select to authenticated using (true);

drop policy if exists "own progress" on public.progress;
create policy "own progress" on public.progress for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own daily" on public.daily;
create policy "own daily" on public.daily for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists bank_meta_touch on public.bank_meta;
create trigger bank_meta_touch before insert or update on public.bank_meta for each row execute function public.touch();

-- Bank import: pulls public/bank.json from the repo. Run `select public.import_bank();` after pushing new questions.
create extension if not exists http with schema extensions;
create or replace function public.import_bank(src text default 'https://raw.githubusercontent.com/abboudberoual/nextstop/main/public/bank.json')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b jsonb; n int; r int;
begin
  select content::jsonb into b from extensions.http_get(src);
  insert into public.questions (id, course, topic, type, data, retired)
  select q->>'id', q->>'course', q->>'topic', q->>'type', q - 'id' - 'course' - 'topic' - 'type', coalesce((q->>'retired')::boolean, false)
  from jsonb_array_elements(b->'questions') q
  on conflict (id) do update set course = excluded.course, topic = excluded.topic, type = excluded.type, data = excluded.data, retired = excluded.retired
  where public.questions.data is distinct from excluded.data or public.questions.retired is distinct from excluded.retired
     or public.questions.topic is distinct from excluded.topic;
  get diagnostics n = row_count;
  update public.questions set retired = true where not retired and id not in (select q->>'id' from jsonb_array_elements(b->'questions') q);
  get diagnostics r = row_count;
  insert into public.bank_meta (key, value) values ('courses', b->'courses'), ('figures', coalesce(b->'figures', '{}'::jsonb)), ('version', to_jsonb(b->'version'))
  on conflict (key) do update set value = excluded.value where public.bank_meta.value is distinct from excluded.value;
  return jsonb_build_object('upserted', n, 'retired', r, 'version', b->'version');
end $$;
revoke all on function public.import_bank(text) from public, anon, authenticated;
