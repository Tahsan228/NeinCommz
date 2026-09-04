import { useState } from 'react';
import type { UUID } from '../../lib/types';
import { MAIN_ROOM } from '../../lib/types';
import { useSession } from '../../state/session';
import { useDirectory } from '../../state/directory';
import { describeRoom, useRooms } from '../../state/rooms';
import { Avatar } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { ChatPanel } from './ChatPanel';
import { RoomEditor } from './RoomEditor';
import { NewRoom } from './NewRoom';
import { ProfileCard } from '../profiles/ProfileCard';

/**
 * The chat column: a strip of conversations across the top, the open one
 * below it.
 *
 * A strip rather than a sidebar because this column is narrow — a nested list
 * beside the thread would leave neither enough room to read.
 */
export function ChatColumn() {
  const { profile } = useSession();
  const { byId } = useDirectory();
  const { rooms, membersOf, activeId, setActiveId, active } = useRooms();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<UUID | null>(null);

  const me = profile?.id;
  const nameOf = (id: UUID) => byId.get(id)?.display_name ?? 'Someone';
  const avatarOf = (id: UUID) => ({
    emoji: byId.get(id)?.avatar_emoji ?? '🙂',
    url: byId.get(id)?.avatar_url ?? null,
    color: byId.get(id)?.avatar_color ?? '#555',
  });

  // Main first, then groups, then DMs — the order people actually scan in.
  const ordered = [...rooms].sort((a, b) => {
    const rank = (r: typeof a) => (r.id === MAIN_ROOM ? 0 : r.kind === 'group' ? 1 : 2);
    return rank(a) - rank(b) || a.created_at.localeCompare(b.created_at);
  });

  const current = active
    ? describeRoom(active, membersOf(active.id), me, nameOf, avatarOf)
    : { title: 'Chat', emoji: '💬', url: null, color: '#555', subtitle: '' };

  return (
    <>
      <div className="room-strip">
        {ordered.map((room) => {
          const d = describeRoom(room, membersOf(room.id), me, nameOf, avatarOf);
          return (
            <button
              key={room.id}
              className="room-chip"
              data-on={room.id === activeId}
              title={d.title}
              onClick={() => setActiveId(room.id)}
            >
              <Avatar emoji={d.emoji} url={d.url} color={d.color} size={22} name={d.title} />
              <span>{d.title}</span>
            </button>
          );
        })}

        <button
          className="room-chip room-chip-new"
          title="Start a conversation"
          aria-label="Start a conversation"
          onClick={() => setCreating(true)}
        >
          <Icon name="plus" size={16} />
        </button>
      </div>

      <ChatPanel
        key={activeId}
        roomId={activeId}
        title={current.title}
        subtitle={
          active?.id === MAIN_ROOM
            ? `${membersOf(MAIN_ROOM).length} people · every message kept`
            : current.subtitle
        }
        backdropUrl={active?.backdrop_url ?? null}
        onOpenProfile={setViewing}
        onOpenRoomSettings={active && active.kind === 'group' ? () => setEditing(true) : undefined}
      />

      {creating && <NewRoom onClose={() => setCreating(false)} />}
      {editing && active && <RoomEditor room={active} onClose={() => setEditing(false)} />}
      {viewing && <ProfileCard id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}
