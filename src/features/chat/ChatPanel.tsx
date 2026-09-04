import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errText, supabase } from '../../lib/supabase';
import type { Message, Reaction, UUID } from '../../lib/types';
import { formatDaySeparator, formatStamp, sameDay } from '../../lib/time';
import { splitLinks } from '../../lib/linkify';
import { useSession } from '../../state/session';
import { useDirectory } from '../../state/directory';
import { Avatar } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { Composer, type OutgoingMessage } from './Composer';

const PAGE = 200;
const TAPBACKS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];

/**
 * The iMessage tail. Inline SVG so it can carry the bubble's colour on top of
 * the page's gradient — the usual two-pseudo-element mask trick needs a flat
 * background behind it, which this app does not have.
 *
 * The shape's straight right edge overlaps the bubble by 5px, exactly covering
 * the corner that `[data-tail]` squares off, so the two read as one piece
 * instead of the tail floating alongside it.
 */
function Tail({ mine }: { mine: boolean }) {
  return (
    <svg className={`tail ${mine ? 'tail-mine' : 'tail-them'}`} viewBox="0 0 16 18" aria-hidden>
      <path d="M16 18V0c-.5 5.4-2.2 9.6-5 12.6-1.6 1.7-3.6 3-6 3.9-1 .4-.8 1.5.3 1.5H16z" />
    </svg>
  );
}

/**
 * Message text with links made clickable. Built from parts rather than HTML —
 * the text is written by other people, so it must never reach innerHTML.
 */
function MessageText({ body }: { body: string }) {
  return (
    <>
      {splitLinks(body).map((part, i) =>
        part.kind === 'link' ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="msg-link"
            onClick={(e) => e.stopPropagation()}
          >
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </>
  );
}

export function ChatPanel({
  roomId,
  title,
  subtitle,
  backdropUrl,
  onOpenProfile,
  onOpenRoomSettings,
}: {
  roomId: UUID;
  title: string;
  subtitle: string;
  backdropUrl?: string | null;
  onOpenProfile?: (id: UUID) => void;
  onOpenRoomSettings?: () => void;
}) {
  const { profile, prefs } = useSession();
  const { byId } = useDirectory();

  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; label: string } | null>(null);
  const [tapbackFor, setTapbackFor] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [typers, setTypers] = useState<Map<UUID, number>>(new Map());
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [hit, setHit] = useState<string | null>(null);
  const [readers, setReaders] = useState<Map<UUID, string>>(new Map());

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const typingChannel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSent = useRef(0);

  const me = profile?.id;

  // Everything below is per-room, so switching rooms starts clean rather
  // than briefly showing the previous conversation under the new title.
  useEffect(() => {
    setMessages([]);
    setLoading(true);
    setHasOlder(false);
    setReplyTo(null);
    setSearchOpen(false);
    setQuery('');
    setResults(null);
    setTypers(new Map());
    pinnedRef.current = true;
  }, [roomId]);

  /* ------------------------------------------------------------ history -- */
  // Everything is kept forever, so the initial load takes the newest page and
  // walks backwards on demand rather than pulling years of history at once.
  useEffect(() => {
    if (!me) return;
    let alive = true;
    (async () => {
      const { data, error: e } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(PAGE);
      if (!alive) return;
      if (e) setError(errText(e));
      const rows = ((data as Message[]) ?? []).reverse();
      setMessages(rows);
      setHasOlder(rows.length === PAGE);
      setLoading(false);

      const { data: rx } = await supabase.from('reactions').select('*');
      if (alive && rx) setReactions(rx as Reaction[]);
    })();
    return () => {
      alive = false;
    };
  }, [me, roomId]);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (!oldest) return;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;

    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', roomId)
      .lt('created_at', oldest.created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE);

    const rows = ((data as Message[]) ?? []).reverse();
    setHasOlder(rows.length === PAGE);
    setMessages((cur) => [...rows, ...cur]);

    // Keep the reading position steady instead of yanking to the top.
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight;
    });
  }, [messages, roomId]);

  /* ----------------------------------------------------------- realtime -- */
  useEffect(() => {
    if (!me) return;

    const ch = supabase
      .channel('chat:main')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as Message;
            setMessages((cur) => {
              if (cur.some((m) => m.id === row.id)) return cur;
              // Replace our own optimistic copy rather than showing it twice.
              const optimistic = cur.findIndex(
                (m) => m.pending && m.author_id === row.author_id && m.body === row.body,
              );
              if (optimistic !== -1) {
                const next = cur.slice();
                next[optimistic] = row;
                return next;
              }
              return [...cur, row];
            });
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as Message;
            setMessages((cur) => cur.map((m) => (m.id === row.id ? row : m)));
          } else if (payload.eventType === 'DELETE') {
            const gone = payload.old as { id: string };
            setMessages((cur) => cur.filter((m) => m.id !== gone.id));
          }
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setReactions((cur) => [...cur, payload.new as Reaction]);
        } else if (payload.eventType === 'DELETE') {
          const old = payload.old as Reaction;
          setReactions((cur) =>
            cur.filter(
              (r) =>
                !(
                  r.message_id === old.message_id &&
                  r.profile_id === old.profile_id &&
                  r.emoji === old.emoji
                ),
            ),
          );
        }
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [me, roomId]);

  /* ------------------------------------------------------------- typing -- */
  // Typing is ephemeral by nature, so it rides the broadcast channel and never
  // touches the database.
  useEffect(() => {
    if (!me) return;
    const ch = supabase.channel(`typing:${roomId}`, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const id = (payload as { id: UUID }).id;
      setTypers((cur) => new Map(cur).set(id, Date.now()));
    }).subscribe();
    typingChannel.current = ch;

    const sweep = window.setInterval(() => {
      setTypers((cur) => {
        const next = new Map(cur);
        let changed = false;
        for (const [id, at] of next) {
          if (Date.now() - at > 4000) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : cur;
      });
    }, 1500);

    return () => {
      window.clearInterval(sweep);
      void supabase.removeChannel(ch);
      typingChannel.current = null;
    };
  }, [me, roomId]);

  const announceTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < 1800) return;
    lastTypingSent.current = now;
    void typingChannel.current?.send({ type: 'broadcast', event: 'typing', payload: { id: me } });
  }, [me]);

  /* ------------------------------------------------------ read receipts -- */
  useEffect(() => {
    if (!me) return;

    const load = async () => {
      const { data } = await supabase
        .from('read_state')
        .select('profile_id, last_read_at')
        .eq('room_id', roomId);
      setReaders(
        new Map(
          ((data as { profile_id: UUID; last_read_at: string }[]) ?? []).map((r) => [
            r.profile_id,
            r.last_read_at,
          ]),
        ),
      );
    };
    void load();

    const ch = supabase
      .channel(`reads:${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'read_state', filter: `room_id=eq.${roomId}` },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [me, roomId]);

  // Mark the room read whenever the newest message is actually on screen.
  // Doing it on every render would claim you had read things scrolled far
  // above, which is exactly the lie a read receipt must not tell.
  const newestAt = messages.length ? messages[messages.length - 1].created_at : null;

  /** My latest message, which is the only one worth hanging a receipt on. */
  const myLastId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].author_id === me && !messages[i].pending) return messages[i].id;
    }
    return null;
  }, [messages, me]);

  /** Who had caught up as of that message. */
  const seenBy = useMemo(() => {
    const target = messages.find((m) => m.id === myLastId);
    if (!target) return [];
    const at = new Date(target.created_at).getTime();
    return [...readers.entries()]
      .filter(([id, when]) => id !== me && new Date(when).getTime() >= at)
      .map(([id]) => byId.get(id)?.display_name ?? 'Someone')
      .sort();
  }, [messages, myLastId, readers, me, byId]);
  useEffect(() => {
    if (!me || !newestAt || searchOpen || !pinnedRef.current || document.hidden) return;
    void supabase
      .from('read_state')
      .upsert(
        { room_id: roomId, profile_id: me, last_read_at: new Date().toISOString() },
        { onConflict: 'room_id,profile_id' },
      );
  }, [me, roomId, newestAt, searchOpen]);

  /* -------------------------------------------------------------- search -- */
  // Searched server-side so it reaches the whole history, not just the page
  // that happens to be on screen.
  useEffect(() => {
    const q = query.trim();
    if (!searchOpen || q.length < 2) {
      setResults(null);
      return;
    }
    const t = window.setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .ilike('body', '%' + q + '%')
        .order('created_at', { ascending: false })
        .limit(60);
      setResults((data as Message[]) ?? []);
      setSearching(false);
    }, 280);
    return () => window.clearTimeout(t);
  }, [query, searchOpen, roomId]);

  /** Reopen the conversation around a search result and flash it. */
  const jumpTo = useCallback(async (target: Message) => {
    const [{ data: before }, { data: after }] = await Promise.all([
      supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .lte('created_at', target.created_at)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .gt('created_at', target.created_at)
        .order('created_at', { ascending: true })
        .limit(30),
    ]);

    const older = ((before as Message[]) ?? []).reverse();
    setMessages([...older, ...((after as Message[]) ?? [])]);
    setHasOlder(older.length === 60);
    setSearchOpen(false);
    setQuery('');
    setResults(null);
    setHit(target.id);
    pinnedRef.current = false;

    requestAnimationFrame(() => {
      document.getElementById('msg-' + target.id)?.scrollIntoView({ block: 'center' });
    });
    window.setTimeout(() => setHit(null), 2600);
  }, [roomId]);

  /* ----------------------------------------------------------- scrolling -- */
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  /**
   * Pin to the newest message.
   *
   * Called more than once on purpose. Setting scrollTop the moment a page of
   * history arrives lands short, because the bubbles have not been laid out
   * yet and the images inside them have no height — which is why opening the
   * app left you part-way up the conversation instead of at the bottom.
   */
  const stickToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (!pinnedRef.current && !prefs.autoScroll) return;
    stickToBottom();
    const frame = requestAnimationFrame(stickToBottom);
    // One more after layout has certainly settled, for slow first paints.
    const late = window.setTimeout(stickToBottom, 150);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(late);
    };
  }, [messages.length, typers.size, prefs.autoScroll, roomId, loading, stickToBottom]);

  /* -------------------------------------------------------------- send --- */
  const send = useCallback(
    async (out: OutgoingMessage) => {
      if (!me) return;
      const tempId = `pending-${crypto.randomUUID()}`;
      const optimistic: Message = {
        id: tempId,
        room_id: roomId,
        author_id: me,
        kind: out.kind,
        body: out.body,
        media_url: out.media_url,
        media_w: out.media_w,
        media_h: out.media_h,
        reply_to: replyTo?.id ?? null,
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
        pending: true,
      };
      setMessages((cur) => [...cur, optimistic]);
      setReplyTo(null);
      pinnedRef.current = true;

      const { data, error: e } = await supabase
        .from('messages')
        .insert({
          room_id: roomId,
          author_id: me,
          kind: out.kind,
          body: out.body,
          media_url: out.media_url,
          media_w: out.media_w,
          media_h: out.media_h,
          reply_to: optimistic.reply_to,
        })
        .select()
        .single();

      setMessages((cur) => {
        const i = cur.findIndex((m) => m.id === tempId);
        if (i === -1) return cur;
        const next = cur.slice();
        // The realtime INSERT may have already swapped this in; either way we
        // end up with exactly one copy of the row.
        if (e || !data) next[i] = { ...optimistic, pending: false, failed: true };
        else if (cur.some((m) => m.id === (data as Message).id)) next.splice(i, 1);
        else next[i] = data as Message;
        return next;
      });
      if (e) setError(errText(e));
    },
    [me, replyTo, roomId],
  );

  const retry = useCallback(
    (m: Message) => {
      setMessages((cur) => cur.filter((x) => x.id !== m.id));
      void send({
        kind: m.kind,
        body: m.body,
        media_url: m.media_url,
        media_w: m.media_w,
        media_h: m.media_h,
      });
    },
    [send],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!me) return;
      setTapbackFor(null);
      const mine = reactions.find(
        (r) => r.message_id === messageId && r.profile_id === me && r.emoji === emoji,
      );
      if (mine) {
        setReactions((cur) => cur.filter((r) => r !== mine));
        await supabase
          .from('reactions')
          .delete()
          .match({ message_id: messageId, profile_id: me, emoji });
      } else {
        const row: Reaction = {
          message_id: messageId,
          profile_id: me,
          emoji,
          created_at: new Date().toISOString(),
        };
        setReactions((cur) => [...cur, row]);
        await supabase.from('reactions').insert(row);
      }
    },
    [me, reactions],
  );

  const remove = useCallback(async (id: string) => {
    setMessages((cur) => cur.filter((m) => m.id !== id));
    await supabase.from('messages').delete().eq('id', id);
  }, []);

  /* ------------------------------------------------------------ derived -- */
  const reactionsByMessage = useMemo(() => {
    const m = new Map<string, Reaction[]>();
    for (const r of reactions) {
      const list = m.get(r.message_id);
      if (list) list.push(r);
      else m.set(r.message_id, [r]);
    }
    return m;
  }, [reactions]);

  const messagesById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const typingNames = useMemo(
    () =>
      [...typers.keys()]
        .filter((id) => id !== me)
        .map((id) => byId.get(id)?.display_name)
        .filter(Boolean) as string[],
    [typers, byId, me],
  );

  if (!profile) return null;

  return (
    <>
      <div className="chat-head">
        {searchOpen ? (
          <>
            <Icon name="search" size={16} style={{ color: 'var(--ink-faint)', flex: 'none' }} />
            <input
              className="input"
              style={{ padding: '7px 11px', fontSize: 13.5 }}
              autoFocus
              placeholder="Search every message…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchOpen(false);
                  setQuery('');
                }
              }}
            />
            <button
              className="btn btn-ghost btn-icon"
              aria-label="Close search"
              onClick={() => {
                setSearchOpen(false);
                setQuery('');
              }}
            >
              <Icon name="x" size={16} />
            </button>
          </>
        ) : (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </h2>
              <div className="sub">{subtitle}</div>
            </div>
            <button
              className="btn btn-ghost btn-icon"
              title="Search messages"
              aria-label="Search messages"
              onClick={() => setSearchOpen(true)}
            >
              <Icon name="search" size={17} />
            </button>
            {onOpenRoomSettings && (
              <button
                className="btn btn-ghost btn-icon"
                title="Group settings"
                aria-label="Group settings"
                onClick={onOpenRoomSettings}
              >
                <Icon name="users" size={17} />
              </button>
            )}
          </>
        )}
      </div>

      {searchOpen && (
        <div className="search-results">
          {searching && <div className="empty">Searching…</div>}
          {!searching && query.trim().length < 2 && (
            <div className="empty">Type at least two characters.</div>
          )}
          {!searching && results?.length === 0 && (
            <div className="empty">Nothing matches that.</div>
          )}
          {!searching &&
            results?.map((r) => {
              const who = byId.get(r.author_id);
              return (
                <button key={r.id} className="search-hit" onClick={() => void jumpTo(r)}>
                  <Avatar
                    emoji={who?.avatar_emoji ?? '🙂'}
                    url={who?.avatar_url}
                    color={who?.avatar_color ?? '#555'}
                    size={24}
                    name={who?.display_name}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="search-hit-meta">
                      {who?.display_name ?? 'Someone'} · {formatDaySeparator(r.created_at)}{' '}
                      {formatStamp(r.created_at, prefs.clock24)}
                    </div>
                    <div className="search-hit-body">{r.body}</div>
                  </div>
                </button>
              );
            })}
        </div>
      )}

      <div
        className="msgs"
        ref={scrollRef}
        onScroll={onScroll}
        hidden={searchOpen}
        style={
          backdropUrl
            ? { backgroundImage: `url(${backdropUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : undefined
        }
      >
        {backdropUrl && <div className="msgs-scrim" />}
        {loading && <div className="empty">Loading history…</div>}

        {!loading && hasOlder && (
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center', marginBottom: 10 }} onClick={() => void loadOlder()}>
            Load older messages
          </button>
        )}

        {!loading && messages.length === 0 && (
          <div className="empty">
            Nothing here yet.
            <br />
            Whatever gets said stays said — this room never forgets.
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const author = byId.get(m.author_id);
          const mine = m.author_id === me;
          const newDay = !prev || !sameDay(prev.created_at, m.created_at);
          const startsGroup = newDay || !prev || prev.author_id !== m.author_id;
          const endsGroup =
            !next ||
            next.author_id !== m.author_id ||
            !sameDay(next.created_at, m.created_at) ||
            new Date(next.created_at).getTime() - new Date(m.created_at).getTime() > 5 * 60_000;
          const rx = reactionsByMessage.get(m.id) ?? [];
          const quoted = m.reply_to ? messagesById.get(m.reply_to) : null;

          return (
            <div key={m.id} id={`msg-${m.id}`}>
              {newDay && <div className="daysep">{formatDaySeparator(m.created_at)}</div>}
              {startsGroup && !mine && (
                <button
                  className="msg-author msg-author-btn"
                  onClick={() => author && onOpenProfile?.(author.id)}
                >
                  {author?.display_name ?? 'Someone'}
                </button>
              )}

              <div className="msg" data-mine={mine} data-last={endsGroup} style={{ position: 'relative' }}>
                {!mine && (
                  <div style={{ width: 26, flex: 'none' }}>
                    {endsGroup && author && (
                      <button
                        className="avatar-btn"
                        title={`About ${author.display_name}`}
                        onClick={() => onOpenProfile?.(author.id)}
                      >
                      <Avatar
                        emoji={author.avatar_emoji}
                        url={author.avatar_url}
                        color={author.avatar_color}
                        size={26}
                        name={author.display_name}
                      />
                      </button>
                    )}
                  </div>
                )}

                <div className="bubble-wrap">
                  {quoted && (
                    <div className="reply-quote">
                      {byId.get(quoted.author_id)?.display_name ?? 'Someone'}:{' '}
                      {quoted.body ?? (quoted.kind === 'gif' ? 'GIF' : 'photo')}
                    </div>
                  )}

                  {m.media_url ? (
                    <>
                      {/* No frame around the picture: any background here shows
                          through transparent PNGs as a coloured card. */}
                      <div className="bubble-media" style={m.pending ? { opacity: 0.6 } : undefined}>
                        <img
                          src={m.media_url}
                          alt={m.kind === 'gif' ? 'GIF' : 'Shared image'}
                          loading="lazy"
                          width={m.media_w ?? undefined}
                          height={m.media_h ?? undefined}
                          style={
                            m.media_w && m.media_h
                              ? { aspectRatio: `${m.media_w} / ${m.media_h}` }
                              : undefined
                          }
                          onClick={() => setLightbox(m.media_url)}
                          onLoad={() => {
                            // A picture that has just been measured pushes
                            // everything below it down.
                            if (pinnedRef.current) stickToBottom();
                          }}
                        />
                      </div>
                      {m.body && (
                        <div
                          className={`bubble ${mine ? 'bubble-mine' : 'bubble-them'}`}
                          data-tail={endsGroup && prefs.bubbleTails ? (mine ? 'mine' : 'them') : undefined}
                          style={{ marginTop: 4 }}
                        >
                          <MessageText body={m.body} />
                          {endsGroup && prefs.bubbleTails && <Tail mine={mine} />}
                        </div>
                      )}
                    </>
                  ) : (
                    <div
                      className={`bubble ${mine ? 'bubble-mine' : 'bubble-them'} ${
                        hit === m.id ? 'bubble-hit' : ''
                      }`}
                      data-tail={endsGroup && prefs.bubbleTails ? (mine ? 'mine' : 'them') : undefined}
                      style={m.pending ? { opacity: 0.6 } : undefined}
                    >
                      {m.body && <MessageText body={m.body} />}
                      {endsGroup && prefs.bubbleTails && <Tail mine={mine} />}
                    </div>
                  )}

                  {rx.length > 0 && (
                    <div className="tapbacks">
                      {groupEmoji(rx).map(([emoji, list]) => (
                        <button
                          key={emoji}
                          className="tapback"
                          data-mine={list.some((r) => r.profile_id === me)}
                          title={list
                            .map((r) => byId.get(r.profile_id)?.display_name ?? '?')
                            .join(', ')}
                          onClick={() => void toggleReaction(m.id, emoji)}
                        >
                          {emoji}
                          {list.length > 1 && <span>{list.length}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {m.id === myLastId && seenBy.length > 0 && (
                    <div className="seen" title={seenBy.join(', ')}>
                      <Icon name="check" size={11} />
                      {seenBy.length === 1
                        ? `Seen by ${seenBy[0]}`
                        : seenBy.length <= 3
                          ? `Seen by ${seenBy.slice(0, -1).join(', ')} and ${seenBy[seenBy.length - 1]}`
                          : `Seen by ${seenBy.length} people`}
                    </div>
                  )}

                  {endsGroup && (
                    <div className="stamp">
                      {m.failed ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ color: '#ff9089', padding: '0 4px' }}
                          onClick={() => retry(m)}
                        >
                          Didn't send — retry
                        </button>
                      ) : m.pending ? (
                        'Sending…'
                      ) : (
                        formatStamp(m.created_at, prefs.clock24)
                      )}
                    </div>
                  )}
                </div>

                {!m.pending && (
                  <div className="msg-tools">
                    <button
                      onClick={() => setTapbackFor(tapbackFor === m.id ? null : m.id)}
                      title="React"
                      aria-label="React"
                    >
                      <Icon name="smile" size={15} />
                    </button>
                    <button
                      onClick={() =>
                        setReplyTo({
                          id: m.id,
                          label: byId.get(m.author_id)?.display_name ?? 'someone',
                        })
                      }
                      title="Reply"
                      aria-label="Reply"
                    >
                      <Icon name="reply" size={15} />
                    </button>
                    {mine && (
                      <button onClick={() => void remove(m.id)} title="Delete" aria-label="Delete">
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>
                )}

                {tapbackFor === m.id && (
                  <div className="tapback-pop" style={mine ? { right: 34 } : { left: 34 }}>
                    {TAPBACKS.map((e) => (
                      <button key={e} onClick={() => void toggleReaction(m.id, e)}>
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="typing">
        {typingNames.length > 0 && (
          <>
            <i />
            <i />
            <i />
            <span>
              {typingNames.slice(0, 2).join(' and ')}
              {typingNames.length > 2 ? ` and ${typingNames.length - 2} more` : ''}{' '}
              {typingNames.length === 1 ? 'is' : 'are'} typing
            </span>
          </>
        )}
      </div>

      {error && (
        <p className="err" style={{ padding: '0 14px' }}>
          {error}
        </p>
      )}

      <Composer
        onSend={send}
        onTyping={announceTyping}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      )}
    </>
  );
}

function groupEmoji(list: Reaction[]): [string, Reaction[]][] {
  const m = new Map<string, Reaction[]>();
  for (const r of list) {
    const arr = m.get(r.emoji);
    if (arr) arr.push(r);
    else m.set(r.emoji, [r]);
  }
  return [...m.entries()];
}
