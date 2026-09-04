export type UUID = string;

export type BlockKind = 'class' | 'free' | 'lunch' | 'activity' | 'other';
export type Presence = 'online' | 'away' | 'offline';
export type GameId = 'haxball' | 'tictactoe' | 'gartic';

export interface Prefs {
  theme: 'graphite' | 'midnight' | 'forest' | 'plum' | 'paper';
  fontSize: number;
  density: 'comfy' | 'compact';
  sendOnEnter: boolean;
  clock24: boolean;
  sounds: boolean;
  volume: number;
  notifications: boolean;
  shareStatus: boolean;
  awayAfterMin: number;
  showSeconds: boolean;
  bubbleTails: boolean;
  autoScroll: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'graphite',
  fontSize: 14,
  density: 'comfy',
  sendOnEnter: true,
  clock24: false,
  sounds: true,
  volume: 60,
  notifications: false,
  shareStatus: true,
  awayAfterMin: 5,
  showSeconds: false,
  bubbleTails: true,
  autoScroll: true,
};

export interface Profile {
  id: UUID;
  slug: string;
  display_name: string;
  avatar_emoji: string;
  /** An uploaded profile picture. When set it replaces the emoji everywhere. */
  avatar_url: string | null;
  avatar_color: string;
  accent_color: string;
  has_recovery: boolean;
  bio: string | null;
  /** Spendable currency, awarded by award_match() in the database. */
  coins: number;
  /** Currently worn cosmetics, keyed by kind: trail / goalfx / celebration. */
  equipped: Record<string, string>;
  status_text: string | null;
  status_emoji: string | null;
  status_expires_at: string | null;
  prefs: Partial<Prefs>;
  created_at: string;
}

/** The anonymous-readable slice used to draw the profile picker. */
export interface PublicProfile {
  id: UUID;
  slug: string;
  display_name: string;
  avatar_emoji: string;
  avatar_url: string | null;
  avatar_color: string;
  has_recovery: boolean;
}

export interface Room {
  id: UUID;
  name: string;
  /** 'group' for Main and user-made groups, 'dm' for a two-person thread. */
  kind: 'group' | 'dm';
  icon_emoji: string | null;
  icon_url: string | null;
  /** A hosted image URL used as the conversation's backdrop. */
  backdrop_url: string | null;
  created_by: UUID | null;
  created_at: string;
}

export interface RoomMember {
  room_id: UUID;
  profile_id: UUID;
  joined_at: string;
}

export interface Message {
  id: UUID;
  room_id: UUID;
  author_id: UUID;
  kind: 'text' | 'image' | 'gif';
  body: string | null;
  media_url: string | null;
  media_w: number | null;
  media_h: number | null;
  reply_to: UUID | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  /** Client-only: set while the row is still in flight. */
  pending?: boolean;
  failed?: boolean;
}

export interface Reaction {
  message_id: UUID;
  profile_id: UUID;
  emoji: string;
  created_at: string;
}

export interface ScheduleBlock {
  id: UUID;
  profile_id: UUID;
  label: string;
  kind: BlockKind;
  emoji: string | null;
  start_min: number;
  end_min: number;
  days: number[];
  created_at: string;
}

export interface GameSession {
  id: UUID;
  game: GameId;
  host_id: UUID;
  status: 'lobby' | 'active' | 'done';
  max_players: number;
  state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface GamePlayer {
  session_id: UUID;
  profile_id: UUID;
  seat: number;
  team: number;
  joined_at: string;
}

export interface GameInvite {
  id: UUID;
  session_id: UUID;
  from_id: UUID;
  to_id: UUID;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

export interface GarticRound {
  id: UUID;
  session_id: UUID;
  chain_index: number;
  step_index: number;
  author_id: UUID;
  kind: 'prompt' | 'drawing' | 'guess';
  text_content: string | null;
  strokes: DrawOp[] | null;
  created_at: string;
}

/**
 * One drawing operation. Stored rather than pixels, so a drawing stays a few
 * kilobytes, scales to any canvas, and can be replayed — which is also what
 * lets the paint bucket work: a fill is just another op in the sequence.
 *
 * `t` is optional so drawings saved by the original stroke-only version still
 * replay: no `t` means a freehand stroke.
 */
export interface DrawOp {
  t?: 'stroke' | 'fill' | 'line' | 'rect' | 'ellipse';
  c: string;
  w?: number;
  /** Freehand points, flattened as x,y,x,y… */
  p?: number[];
  /** Fill origin. */
  x?: number;
  y?: number;
  /** Shape corners. */
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  /** Filled shape rather than outlined. */
  f?: boolean;
}

/** @deprecated kept so older imports keep compiling. */
export type Stroke = DrawOp;

export const MAIN_ROOM: UUID = '00000000-0000-0000-0000-000000000001';
