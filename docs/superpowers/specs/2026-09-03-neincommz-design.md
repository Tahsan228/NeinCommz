# NeinCommz — design

**Date:** 2026-09-03
**Status:** built

A private web app for a group of school friends to talk, coordinate, and play
without phones. All history is retained permanently.

## Decisions taken up front

| Question | Choice | Why |
|---|---|---|
| Where data lives | Supabase (hosted Postgres + Auth + Realtime) | Real cross-device sync and permanent history with no server to keep running. |
| Phase 1 scope | Everything, all three games | Explicitly requested after being shown the smaller alternative. |
| Password model | Real Supabase Auth accounts behind Netflix-style tiles | Chat history must be genuinely unreadable without signing in, not merely hidden. |
| Schedule model | Free-form weekly block builder | Works for any bell schedule; rigid period grids break on A/B days and after-school activities. |
| Password recovery | Real, email-based | Requested. Optional at signup; skipping it means no way back. |
| Chat style | iMessage | Requested, including images and GIFs. |

## Architecture

React 18 + TypeScript + Vite. Hand-written CSS — the beveled, gradient look is
easier to control with custom properties and layered `box-shadow` than with a
utility framework.

Three transports, chosen per feature:

- **Postgres + Realtime subscriptions** — chat, reactions, profiles, schedules,
  tic-tac-toe, Gartic. Durable, so history survives.
- **Realtime presence** — who is online / away / offline.
- **Realtime broadcast, no DB writes** — Haxball snapshots at 30 Hz, and typing
  indicators. Both are worthless a second later; neither belongs in a table.

### Modules

| Unit | Does | Depends on |
|---|---|---|
| `state/session` | auth, own profile, prefs, theme application | supabase |
| `state/directory` | everyone's profiles, schedules, presence | session |
| `features/status/statusEngine` | pure `resolveStatus` + overlap detection | types only |
| `features/chat` | message list, composer, GIF picker | session, directory |
| `features/games/lobby` | create / join / invite / state, shared by all games | supabase |
| `features/games/haxball/physics` | pure deterministic 2D world | nothing |
| `features/games/gartic/rounds` | pure chain rotation | nothing |
| `features/games/tictactoe/rules` | pure win detection, mirrors the DB function | nothing |

The pure modules carry the logic worth testing and depend on nothing, which is
what makes the test suite cheap.

## Auth

- Site gate (`cold`): browser-side, `sessionStorage`. A curtain. Documented as
  such in the README and in the source.
- Profiles: real Supabase Auth accounts. A `profiles_public` view exposes only
  name / emoji / colour to anonymous visitors so the picker can render.
- Profile rows are created by an `on auth.users insert` trigger, so no window
  exists where an account has no profile.
- Tile sign-in calls `login_email(slug, password)`, a security-definer function
  that returns the account's login address only to a caller who already proved
  the password. Accepted trade: it bypasses Supabase's login rate limiting.
- RLS: authenticated may read all; writes are owner-scoped, except game tables
  where players legitimately write shared state.

## Status resolution

Priority: **manual override** (until expiry) → **presence** (away/offline) →
**current schedule block** → **Free**.

Presence outranking the schedule is the one non-obvious call: a timetable saying
"AP Bio" is not information about someone whose browser has been shut for an
hour. A manual override still outranks presence, because "at practice, back at
6" is a deliberate statement that should survive going offline.

## Known limits

- **Haxball latency.** Every input round-trips through Supabase. Playable, not
  competitive. The upgrade path is WebRTC data channels with Supabase kept for
  signalling only.
- **No recovery without an email.** By design; the signup screen warns.
- **`login_email` bypasses auth rate limiting.** Acceptable for a private group
  behind the front door; would not be for a public app.
- **Single chat room.** The `rooms` table supports more; the UI shows one.

## Testing

Vitest. 56 tests: status engine priority and overlaps, time parsing/formatting,
tic-tac-toe wins, Gartic chain rotation invariants, Haxball collision and goal
maths, and a jsdom mount test that walks through the site gate. Realtime paths
are verified by opening two browsers.
