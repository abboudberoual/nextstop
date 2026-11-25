-- Finals study app: shared question bank + per-user progress.
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
create or replace function public.touch() returns trigger language plpgsql as $$
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
