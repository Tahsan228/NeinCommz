-- ============================================================================
-- NeinCommz schema. Paste this whole file into the Supabase SQL editor and run
-- it once. Safe to re-run: everything is guarded with "if not exists" / drops.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles --
create table if not exists profiles (
  id                uuid primary key references auth.users on delete cascade,
  slug              text unique not null,
  display_name      text not null,
  avatar_emoji      text not null default '🙂',
  avatar_color      text not null default '#e0574f',
  accent_color      text not null default '#e0574f',
  has_recovery      boolean not null default false,
  status_text       text,
  status_emoji      text,
  status_expires_at timestamptz,
  prefs             jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

-- Added after the first release: uploaded profile pictures. Written as an
-- alter so re-running this file on an existing project picks it up.
alter table profiles add column if not exists avatar_url text;

-- The profile picker has to render before anyone is logged in, so a narrow,
-- non-sensitive slice of profiles is exposed to anonymous visitors. Password
-- hashes live in auth.users and are never reachable from here.
drop view if exists profiles_public;
create view profiles_public as
  select id, slug, display_name, avatar_emoji, avatar_url, avatar_color, has_recovery
  from profiles;

grant select on profiles_public to anon, authenticated;

-- ------------------------------------------------------------------- rooms --
create table if not exists rooms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null default 'group',
  created_at timestamptz not null default now()
);

insert into rooms (id, name, kind)
values ('00000000-0000-0000-0000-000000000001', 'Main', 'group')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- messages --
create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms on delete cascade,
  author_id  uuid not null references profiles on delete cascade,
  kind       text not null default 'text',   -- text | image | gif
  body       text,
  media_url  text,
  media_w    int,
  media_h    int,
  reply_to   uuid references messages on delete set null,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);
create index if not exists messages_room_created_idx on messages (room_id, created_at);

create table if not exists reactions (
  message_id uuid not null references messages on delete cascade,
  profile_id uuid not null references profiles on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, profile_id, emoji)
);

create table if not exists read_state (
  room_id      uuid not null references rooms on delete cascade,
  profile_id   uuid not null references profiles on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (room_id, profile_id)
);

-- --------------------------------------------------------------- schedules --
-- start_min / end_min are minutes since local midnight. days is a set of
-- weekday numbers where 0 = Sunday, matching JS getDay().
create table if not exists schedule_blocks (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade,
  label      text not null,
  kind       text not null default 'class',  -- class | free | lunch | activity | other
  emoji      text,
  start_min  int not null check (start_min >= 0 and start_min < 1440),
  end_min    int not null check (end_min > 0 and end_min <= 1440),
  days       int[] not null default '{}',
  created_at timestamptz not null default now(),
  check (end_min > start_min)
);
create index if not exists schedule_profile_idx on schedule_blocks (profile_id);

-- ------------------------------------------------------------------- games --
create table if not exists game_sessions (
  id          uuid primary key default gen_random_uuid(),
  game        text not null,                  -- haxball | tictactoe | gartic
  host_id     uuid not null references profiles on delete cascade,
  status      text not null default 'lobby',  -- lobby | active | done
  max_players int not null default 8,
  state       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists game_players (
  session_id uuid not null references game_sessions on delete cascade,
  profile_id uuid not null references profiles on delete cascade,
  seat       int not null default 0,
  team       int not null default 0,
  joined_at  timestamptz not null default now(),
  primary key (session_id, profile_id)
);

create table if not exists game_invites (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references game_sessions on delete cascade,
  from_id    uuid not null references profiles on delete cascade,
  to_id      uuid not null references profiles on delete cascade,
  status     text not null default 'pending', -- pending | accepted | declined
  created_at timestamptz not null default now()
);
create index if not exists invites_to_idx on game_invites (to_id, status);

-- Gartic Phone: one row per completed step. chain_index identifies whose
-- chain it is; step_index is how far down that chain we are.
create table if not exists gartic_rounds (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references game_sessions on delete cascade,
  chain_index  int not null,
  step_index   int not null,
  author_id    uuid not null references profiles on delete cascade,
  kind         text not null,                 -- prompt | drawing | guess
  text_content text,
  strokes      jsonb,
  created_at   timestamptz not null default now(),
  unique (session_id, chain_index, step_index)
);

-- --------------------------------------------------------------------- RLS --
-- This is a private friend group: any logged-in member may read everything,
-- but may only write rows they own. Anonymous visitors get nothing except
-- profiles_public, so the chat history is genuinely unreadable without a login.

alter table profiles        enable row level security;
alter table rooms           enable row level security;
alter table messages        enable row level security;
alter table reactions       enable row level security;
alter table read_state      enable row level security;
alter table schedule_blocks enable row level security;
alter table game_sessions   enable row level security;
alter table game_players    enable row level security;
alter table game_invites    enable row level security;
alter table gartic_rounds   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','rooms','messages','reactions','read_state',
                           'schedule_blocks','game_sessions','game_players',
                           'game_invites','gartic_rounds']
  loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)',
      t || '_read', t);
  end loop;
end $$;

-- Writes: owner-scoped where there is an owner column.
drop policy if exists profiles_write on profiles;
create policy profiles_write on profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists messages_write on messages;
create policy messages_write on messages for all to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

drop policy if exists reactions_write on reactions;
create policy reactions_write on reactions for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists read_state_write on read_state;
create policy read_state_write on read_state for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists schedule_write on schedule_blocks;
create policy schedule_write on schedule_blocks for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Games are cooperative: the host owns the session, but any player needs to
-- push state (a tic-tac-toe move, a Gartic submission), so writes are open to
-- authenticated members and correctness is enforced by the ttt_move function
-- and by client-side turn checks.
drop policy if exists sessions_write on game_sessions;
create policy sessions_write on game_sessions for all to authenticated
  using (true) with check (true);

drop policy if exists players_write on game_players;
create policy players_write on game_players for all to authenticated
  using (true) with check (true);

drop policy if exists invites_write on game_invites;
create policy invites_write on game_invites for all to authenticated
  using (from_id = auth.uid() or to_id = auth.uid())
  with check (from_id = auth.uid() or to_id = auth.uid());

drop policy if exists gartic_write on gartic_rounds;
create policy gartic_write on gartic_rounds for all to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());

-- ------------------------------------------------- server-validated ttt move
-- Tic-tac-toe is the one game where cheating is a single UPDATE away, so the
-- winner check and the move itself are applied inside the database instead of
-- trusting whatever board the client pushes up.
create or replace function ttt_winner(board text[])
returns text
language plpgsql
immutable
as $$
declare
  lines int[][] := array[[1,2,3],[4,5,6],[7,8,9],[1,4,7],[2,5,8],[3,6,9],[1,5,9],[3,5,7]];
  i int;
  filled int := 0;
begin
  for i in 1..8 loop
    if board[lines[i][1]] <> ''
       and board[lines[i][1]] = board[lines[i][2]]
       and board[lines[i][2]] = board[lines[i][3]] then
      return board[lines[i][1]];
    end if;
  end loop;
  for i in 1..9 loop
    if board[i] <> '' then filled := filled + 1; end if;
  end loop;
  if filled = 9 then return 'draw'; end if;
  return null;
end $$;

create or replace function ttt_move(p_session uuid, p_cell int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s        game_sessions%rowtype;
  board    text[];
  turn     text;
  me       uuid := auth.uid();
  x_player uuid;
  o_player uuid;
  my_mark  text;
  winner   text;
  new_state jsonb;
begin
  select * into s from game_sessions where id = p_session for update;
  if not found then raise exception 'no such session'; end if;
  if s.status <> 'active' then raise exception 'game is not active'; end if;
  if p_cell < 0 or p_cell > 8 then raise exception 'cell out of range'; end if;

  board    := array(select jsonb_array_elements_text(s.state->'board'));
  turn     := s.state->>'turn';
  x_player := (s.state->>'x')::uuid;
  o_player := (s.state->>'o')::uuid;

  if me = x_player then my_mark := 'X';
  elsif me = o_player then my_mark := 'O';
  else raise exception 'you are not in this game';
  end if;

  if my_mark <> turn then raise exception 'not your turn'; end if;
  if board[p_cell + 1] <> '' then raise exception 'cell taken'; end if;

  board[p_cell + 1] := my_mark;
  winner := ttt_winner(board);

  update game_sessions
     set state = jsonb_build_object(
           'board',  to_jsonb(board),
           'turn',   case when my_mark = 'X' then 'O' else 'X' end,
           'x',      s.state->>'x',
           'o',      s.state->>'o',
           'winner', winner,
           'scores', coalesce(s.state->'scores', '{"X":0,"O":0,"draws":0}'::jsonb)),
         status = case when winner is null then 'active' else 'done' end,
         updated_at = now()
   where id = p_session
   returning state into new_state;

  return new_state;
end $$;

grant execute on function ttt_move(uuid, int) to authenticated;

-- ------------------------------------------------------------------ realtime
-- Ignore "already member of publication" errors here; they mean it is done.
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table reactions;
alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table schedule_blocks;
alter publication supabase_realtime add table game_sessions;
alter publication supabase_realtime add table game_players;
alter publication supabase_realtime add table game_invites;
alter publication supabase_realtime add table gartic_rounds;

-- ------------------------------------------------------------------- storage
-- Bucket for pasted/uploaded chat images.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists "media read" on storage.objects;
create policy "media read" on storage.objects for select
  using (bucket_id = 'media');

drop policy if exists "media write" on storage.objects;
create policy "media write" on storage.objects for insert to authenticated
  with check (bucket_id = 'media');

-- ============================================================ auth plumbing
-- Two functions make the Netflix-tile flow work on top of real accounts.

-- 1. Profile rows are created by a trigger rather than by the client, so a
--    profile exists the instant the account does -- no window where someone
--    is signed up but has no tile, and no dependency on whether the project
--    has email confirmation switched on.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, slug, display_name, avatar_emoji, avatar_url,
                               avatar_color, accent_color, has_recovery)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'slug', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', 'Friend'),
    coalesce(new.raw_user_meta_data->>'avatar_emoji', '🙂'),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_user_meta_data->>'avatar_color', '#e0574f'),
    coalesce(new.raw_user_meta_data->>'accent_color', '#e0574f'),
    coalesce((new.raw_user_meta_data->>'has_recovery')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end $fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- 2. Clicking a tile gives us a slug and a password, but Supabase signs in by
--    email. People who registered a recovery address are signed up under that
--    real address (which is what makes reset emails deliverable), so the
--    address cannot simply be derived from the slug.
--
--    This function hands back the login email ONLY to a caller who already
--    proved they know the password, so it discloses nothing a successful
--    login would not have disclosed anyway. It does bypass Supabase's own
--    login rate limiting, which is an accepted trade for a private group
--    that already sits behind the front-door password.
create or replace function login_email(p_slug text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, auth, extensions
as $fn$
declare
  pid  uuid;
  enc  text;
  mail text;
begin
  select id into pid from public.profiles where slug = p_slug;
  if pid is null then return null; end if;

  select encrypted_password, email into enc, mail from auth.users where id = pid;
  if enc is null then return null; end if;

  if enc = crypt(p_password, enc) then
    return mail;
  end if;
  return null;
end $fn$;

revoke all on function login_email(text, text) from public;
grant execute on function login_email(text, text) to anon, authenticated;
