# NeinCommz

A private room for a group of friends: persistent chat, a status board driven by
everyone's class schedule, and three games. Built to be used from a school
computer with no phone in sight.

Nothing is ephemeral. Every message is kept forever.

---

## Setup

Two things to do: point it at a Supabase project, then run it.

### 1. Supabase (free, about five minutes)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql),
   and run it. It is genuinely safe to run more than once — **re-run it after
   pulling changes**, since that is how new columns (like profile pictures)
   arrive. Watch for a green success message: the editor runs the file as one
   transaction, so if any statement fails, *nothing* is applied.
3. Go to **Authentication → Sign In / Providers → Email** and turn
   **Confirm email** *off*. Profiles are Netflix-style tiles, not signups with
   an inbox round trip; with confirmation on, a new profile cannot get in until
   someone clicks a link.
4. Copy `.env.example` to `.env` and paste in your **Project URL** and
   **anon public** key from **Project Settings → API**.

### 2. Run it

```bash
npm install
npm run dev
```

Open the printed URL. The front-door password is `cold` (change it with
`VITE_SITE_PASSWORD` in `.env`).

### 3. Put it online

Deploy to **Vercel** — it serves the static build *and* runs `api/gifs.ts`,
which the GIF picker needs. Set these in **Project Settings → Environment
Variables**, then redeploy:

| Variable | Value | Reaches the browser? |
|---|---|---|
| `VITE_SUPABASE_URL` | your project URL | **yes** |
| `VITE_SUPABASE_ANON_KEY` | your anon public key | **yes** |
| `VITE_SITE_PASSWORD` | `cold` | **yes** |
| `GIPHY_KEY` | your Giphy key | no — server only |

Everyone visits the same URL and the same Supabase project, so history and
status are shared.

### Which secrets are actually secret

**Anything named `VITE_…` is public.** Vite inlines those values into the
JavaScript bundle at build time, so they are readable in devtools on the
deployed site. Putting them in Vercel instead of the repo keeps them off GitHub
and nowhere else.

That is fine for the three that need it:

- The **Supabase anon key** is *designed* to be public. It identifies the
  project and authorises nothing; row-level security is what protects the data.
  Never put the `service_role` key anywhere near this app.
- The **site password** is a curtain, documented as such below.

**`GIPHY_KEY` has no `VITE_` prefix on purpose.** It is read only by
[`api/gifs.ts`](api/gifs.ts), a server function that proxies Giphy and returns
just the GIF URLs. The key never enters the bundle, so nobody can lift it and
burn your quota. The same handler runs during `npm run dev` through a
middleware in [`vite.config.ts`](vite.config.ts), so local and deployed
behaviour cannot drift.

Without a key the endpoint answers 503 and the GIF button falls back to
pasting a link, which keeps the app working.

---

## How the two passwords differ

They are not the same kind of thing, and it matters.

**The site password (`cold`)** is a **curtain, not a lock.** It is compared in
the browser, so anyone who opens devtools can walk straight past it. It exists
so the page is not casually stumbled into. Do not treat it as protection.

It is asked for on **every** load — a reload, a new tab, coming back tomorrow.

**Profile sessions are not persisted either.** Reloading the page signs you out
and asks for the profile password again. That is deliberate: this is built for
shared school computers, where a session that survives a refresh is a session
the next person at that machine inherits.

**Profile passwords are real.** Each profile is a genuine Supabase Auth account.
Every table is behind row-level security that requires a logged-in session, so
without signing in the chat history is genuinely unreadable — not merely
hidden. Anonymous visitors can read exactly one thing: a view containing names,
avatar emoji and tile colours, which is what draws the profile picker.

Two consequences worth knowing:

- **A recovery email is the only way back in.** It is optional when creating a
  profile, and skipping it means a forgotten password cannot be reset — the
  profile has to be remade. The signup screen says so.
- Signing in from a tile calls a `login_email` database function that maps a
  profile name to its login address. It only answers callers who already
  supplied the correct password, so it discloses nothing a successful login
  would not have. It does sidestep Supabase's own login rate limiting, which is
  an accepted trade for a small private group already behind the front door.

---

## What's in it

### Chat
iMessage-shaped: grouped bubbles with tails, day separators, tapback reactions,
replies, typing indicators, read receipts under your own last message, images
(click, paste, or drag), and Giphy search.
Messages send optimistically and offer a retry if the network drops. History
loads a page at a time going backwards, so a year of messages does not stall the
first paint.

Pictures are drawn with no container behind them, so transparent PNGs and
stickers stay transparent instead of sitting on a coloured card. A caption
becomes its own bubble underneath rather than a tinted strip. The message list
hides its scrollbar, which otherwise sat on top of the bubbles.

### Status board
A status button in the top-right corner sets a temporary override — a preset
like *heads down* or *at practice*, or anything you type — with a duration after
which it clears itself and the schedule takes back over.

Each person builds a weekly schedule in Settings — blocks with a label, a kind
(class / free period / lunch / activity), a time range, and which weekdays they
repeat. The board resolves what everyone is doing right now, in this order:

1. a manual override ("at practice") until it expires,
2. away / offline, from live presence,
3. whichever schedule block covers this minute,
4. otherwise, just **Online**.

Having nothing scheduled is deliberately **not** the same as being free. Only a
block someone marked as a free period reads as free and shows green — otherwise
anyone who never filled in a timetable would appear available around the clock,
which is worse than saying nothing at all.

Presence deliberately outranks the timetable: a schedule saying *AP Bio* tells
you nothing useful about someone whose browser has been shut for an hour. Each
card also shows what is next and when, which is the part that actually helps you
find a moment to talk.

### Games
All games share one lobby: create a room, invite people from the list, invites
arrive as a toast. If a host closes the tab, the room passes to whoever has
been in it longest rather than stranding everyone — and clears itself away if
they have all gone. Any room can be **left** (it stays open for everyone else) and
the host can **cancel** it outright, which ends it for everyone after one
confirmation. Gartic offers **Start anyway** below its recommended player count,
since two people still works — the chains are just shorter.

- **Chess** — a full rules engine: castling with every condition, en passant,
  promotion, check, checkmate, stalemate, the fifty-move rule, threefold
  repetition, and algebraic notation with proper disambiguation. Play someone
  else, or **play the computer** at three strengths. The engine is alpha-beta
  over piece-square tables; the easier settings add a deliberate blunder rate,
  because a weak engine that plays perfectly-but-shallowly is far less fun to
  beat than one that occasionally hangs a piece. It always takes a mate when one
  is there, at any strength. Games against the computer don't touch anyone's
  rating, which also makes chess the first game you can open on your own.
- **Tic-tac-toe** — moves are applied by a Postgres function, so a doctored
  board pushed from a browser console is rejected rather than believed. Play a
  best-of series or a **knockout tournament** for 3–8 players with a live
  bracket; draws are replayed rather than eliminating anyone.
- **Gartic Phone** — prompt → draw → guess → draw, with per-phase timers the
  host sets, an optional "draw anything" opening and a pinned round count. The
  tools cover brush, eraser, paint bucket, line, rectangle, ellipse and an
  eyedropper, with a colour wheel, undo/redo and recent colours. At the end the
  album is **revealed one panel at a time**, host-driven so everyone sees the
  same picture together, with autoplay. Drawings are stored as operation lists
  rather than PNGs: kilobytes instead of hundreds, replayable at any size, and
  it is what makes the paint bucket possible at all.
- **Haxball** — top-down 2D football, host-authoritative. Players can stand
  **in the goal**, which is what makes a keeper possible, so the mouth is wide,
  the net is deep, and the ball is large enough to see. Players start in a
  lobby and pick Red, Blue or the bench; the host sets team size, pitch size,
  player speed, shot power, charge rate, ball drag, goal limit and match length,
  then starts the match. Power comes from **keeping the ball at your
  feet**, not from holding a key: walking it forward winds up a shot, losing it
  drops everything you had, and the kick key fires the moment there is anything
  to hit — so you can run at a loose ball with it held and strike on contact.
  Even a bare touch sends the ball a long way. Holding the key pales your disc,
  the way it does in the original, and discs carry initials so a crowded box
  stays readable. A **best-of series** tracks match wins. The host runs a 60 Hz physics loop and broadcasts
  snapshots at 30 Hz over Supabase Realtime; everyone else sends key state.
  A goal is a short film rather than a banner: the camera pushes in on whoever
  scored and holds there with their name and celebration behind letterbox bars,
  then the replay runs at normal speed — crawling through the strike itself,
  because a replay at one speed shows you everything except the bit you wanted
  to see — with the scorer, the assist and the score along the bottom. Then it
  fades and play restarts behind a countdown. Each client tapes what it was
  already drawing, so none of it costs anything on the wire.

  **Be realistic about this one.** It is a simplified take, not a clone, and
  every input takes a round trip through Supabase before it shows up. It is fine
  for messing about and it will not feel like the real Haxball. If the lag
  bothers you, the fix is to move the snapshot transport to WebRTC data channels
  and keep Supabase only for signalling.

### Playing alone
Chess and tic-tac-toe both ship an opponent, so either can be opened on your
own. Tic-tac-toe is small enough to solve outright, so its hardest setting is
literally perfect and cannot be beaten — the easier ones know the perfect move
and decline to play it some of the time, which is a far better way to be
beatable than playing at random.

Haxball fills empty shirts with bots: up to four a side, at three skill levels.
They chase only when they are the closest, hold position otherwise, aim where
the ball is going rather than where it is, and never shoot towards their own
net. They are there to make up the numbers, so they earn nobody anything and
carry no rating.

### On a phone
Small screens get a two-tab layout — **who's around** and **chat** — rather
than three squeezed columns, with the status board as the default because that
is what the app is for when you are not at a desk. Games are deliberately
absent there: Haxball needs two hands on a keyboard and chess needs a board
bigger than a thumb, and a half-working game is worse than an honestly missing
one. Everything else — chat, DMs, groups, status, the shop, leaderboards,
profiles, settings — works.

### The dashboard
A small board above the status list: the time, local weather from Open-Meteo
(no key, no account — location is asked for once and kept in your browser at
neighbourhood precision), what you have on next, how many people are free right
now, and how far it is to the weekend. Decline the location prompt and
everything except the weather still works.

### Ratings, coins and the shop
Every finished game is recorded. Competitive games (Haxball, tic-tac-toe) move
an **Elo rating** — provisional players swing further, the top of the table
settles down, and a win is never worth exactly zero however lopsided the
matchup. Gartic has no winner to speak of, so it pays **coins** and counts
games rather than moving a rating.

Coins buy cosmetics: **ball designs** and **ball trails** that follow whoever
last touched the ball,
**goal effects** that fire across the pitch when you score, and **celebrations**
the pitch shouts afterwards. Everyone starts with the free defaults and 250
coins. Shop cards animate a live preview, because a trail is only a trail once
it is moving.

**Leaderboards** sit on the page rather than behind a button: a compact top
five in the side column, with the full table a click away. Both filter by game
and by today / this week / this month / all time — the windowed views are
rebuilt from per-match rows, since aggregate stats carry no dates.

Everyone appears on the board whether or not they have played, at zero. An
empty panel saying "nothing recorded" tells you less than a list of zeroes,
which at least shows who is here and makes the first result feel like it moved
something.

None of this is client-trusted: ratings, payouts and purchases all run through
security-definer functions in the database, and awarding one session twice is
refused by a unique constraint rather than by good manners.

### Settings
Per profile: display name, an uploaded **profile picture** of any size — it is
resized in the browser before upload, so a 30 MB photo off a phone becomes a
few hundred KB and nothing is ever rejected for being too big — or an emoji
plus colour as the fallback, accent colour, five themes
(including a light one), font size, message density, bubble tails, 12/24-hour
clock, Enter-to-send, auto-scroll, sounds with volume, desktop notifications,
status sharing, away timeout, the schedule editor, and changing your password.

---

## Layout of the code

```
src/
  lib/            supabase client, shared types, time and image helpers
  state/          session (auth + prefs), directory (people, schedules,
                  presence), toasts
  components/     the UI primitives every screen is built from
  features/
    gate/         the front door
    profiles/     picker, create, sign in, password reset
    chat/         message list, composer, GIF picker
    status/       the board and the pure status engine
    schedule/     the weekly editor
    economy/      elo maths, cosmetics, shop and leaderboards
    games/        lobby substrate, room hook + haxball / chess / tictactoe / gartic
    settings/     the settings modal
api/gifs.ts           server-side Giphy proxy, so the key stays off clients
supabase/schema.sql   the entire database, in one runnable file
tests/                the logic worth testing, plus a mount smoke test
```

The design language lives in `src/styles/tokens.css`: dark surfaces, a 1px top
highlight and layered shadows on anything raised, hairline-separated row groups,
and one accent colour per profile that tints buttons, your own bubbles, and the
glow behind the page.

## Tests

```bash
npm test
```

249 tests covering the parts where bugs actually hide: the status engine's
priority rules, glyph resolution and overlap detection, time parsing and
formatting, tic-tac-toe win detection, knockout seeding and bye propagation,
Gartic's chain rotation (nobody should ever get their own chain twice) and its
configurable rounds, Haxball's collisions, goal maths, charged shots and match
limits, Elo expectation/symmetry and the coin payouts, URL detection in messages, the
whole chess rulebook (pins, castling rights, en passant expiry, promotion, mate,
stalemate, repetition), the bots (a perfect tic-tac-toe player must draw
against itself; a Haxball bot must never kick towards its own goal), the
leaderboard's ordering and its rule that nobody is ever dropped from the table,
who gets credited with a goal and an assist, what happens to a room when its
host closes the tab (exactly one client may act on it), what each power-up
orb actually does, and two jsdom tests — one that mounts the whole app and walks through
the front door, and one pinning the game-room loading contract that once made
every game unopenable.

The suite pins its own `VITE_…` values, so it behaves identically on every
machine and never touches a real Supabase project.

Realtime paths are not unit tested — they are checked by opening two browsers.
