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
Nothing about passing it is stored anywhere, so being signed in does not skip
it: the profile session survives a reload, the front door deliberately does
not.

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
replies, typing indicators, images (click, paste, or drag), and Giphy search.
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
4. otherwise, free.

Presence deliberately outranks the timetable: a schedule saying *AP Bio* tells
you nothing useful about someone whose browser has been shut for an hour. Each
card also shows what is next and when, which is the part that actually helps you
find a moment to talk.

### Games
All three share one lobby: create a room, invite people from the list, invites
arrive as a toast. Any room can be **left** (it stays open for everyone else) and
the host can **cancel** it outright, which ends it for everyone after one
confirmation. Gartic offers **Start anyway** below its recommended player count,
since two people still works — the chains are just shorter.

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
- **Haxball** — top-down 2D football, host-authoritative. Players start in a
  lobby and pick Red, Blue or the bench; the host sets team size, pitch size,
  player speed, shot power, charge rate, ball drag, goal limit and match length,
  then starts the match. Shots are **charged** — hold the kick key to build
  power, with a dotted aim guide and a power meter — and a **best-of series**
  tracks match wins. The host runs a 60 Hz physics loop and broadcasts
  snapshots at 30 Hz over Supabase Realtime; everyone else sends key state.

  **Be realistic about this one.** It is a simplified take, not a clone, and
  every input takes a round trip through Supabase before it shows up. It is fine
  for messing about and it will not feel like the real Haxball. If the lag
  bothers you, the fix is to move the snapshot transport to WebRTC data channels
  and keep Supabase only for signalling.

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
    games/        lobby substrate, room hook + haxball / tictactoe / gartic
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

87 tests covering the parts where bugs actually hide: the status engine's
priority rules, glyph resolution and overlap detection, time parsing and
formatting, tic-tac-toe win detection, knockout seeding and bye propagation,
Gartic's chain rotation (nobody should ever get their own chain twice) and its
configurable rounds, Haxball's collisions, goal maths, charged shots and match
limits, and two jsdom tests — one that mounts the whole app and walks through
the front door, and one pinning the game-room loading contract that once made
every game unopenable.

The suite pins its own `VITE_…` values, so it behaves identically on every
machine and never touches a real Supabase project.

Realtime paths are not unit tested — they are checked by opening two browsers.
