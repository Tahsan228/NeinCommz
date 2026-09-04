import { useState } from 'react';
import { MAIN_ROOM, type Room } from '../../lib/types';
import { useSession } from '../../state/session';
import { useDirectory } from '../../state/directory';
import { useRooms } from '../../state/rooms';
import { Avatar, Field, Modal } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { EMOJI_CHOICES } from '../profiles/ProfileScreens';

/** Rename a group, change its icon and backdrop, and manage who is in it. */
export function RoomEditor({ room, onClose }: { room: Room; onClose: () => void }) {
  const { profile } = useSession();
  const { profiles, byId } = useDirectory();
  const { membersOf, addMember, removeMember, updateRoom, leaveRoom } = useRooms();

  const members = membersOf(room.id);
  const outsiders = profiles.filter((p) => !members.includes(p.id));
  const isMain = room.id === MAIN_ROOM;

  const [name, setName] = useState(room.name);
  const [backdrop, setBackdrop] = useState(room.backdrop_url ?? '');
  const [backdropError, setBackdropError] = useState('');

  const saveBackdrop = () => {
    const url = backdrop.trim();
    if (url && !/^https:\/\/\S+$/i.test(url)) {
      setBackdropError('That needs to be a full https:// link to an image.');
      return;
    }
    setBackdropError('');
    void updateRoom(room.id, { backdrop_url: url || null });
  };

  return (
    <Modal title={isMain ? 'Main' : 'Group settings'} onClose={onClose} wide>
      {!isMain && (
        <>
          <Field label="Name">
            <input
              className="input"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && void updateRoom(room.id, { name: name.trim() })}
            />
          </Field>

          <Field label="Icon">
            <div className="emoji-grid">
              {EMOJI_CHOICES.map((e) => (
                <button
                  key={e}
                  type="button"
                  data-sel={e === room.icon_emoji}
                  onClick={() => void updateRoom(room.id, { icon_emoji: e })}
                >
                  {e}
                </button>
              ))}
            </div>
          </Field>
        </>
      )}

      <Field label="Backdrop image URL">
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            placeholder="https://…/wallpaper.jpg"
            value={backdrop}
            onChange={(e) => setBackdrop(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveBackdrop()}
          />
          <button className="btn btn-sm" onClick={saveBackdrop}>
            Apply
          </button>
        </div>
      </Field>
      <p className="row-sub" style={{ marginTop: -8 }}>
        Paste a link to a hosted image. It sits behind this conversation for
        everyone in it; leave it empty to go back to plain.
      </p>
      {backdropError && <p className="err">{backdropError}</p>}

      <div className="label" style={{ marginTop: 18 }}>
        In this chat · {members.length}
      </div>
      <div className="group">
        {members.map((id) => {
          const p = byId.get(id);
          return (
            <div className="row" key={id}>
              <Avatar
                emoji={p?.avatar_emoji ?? '🙂'}
                url={p?.avatar_url}
                color={p?.avatar_color ?? '#555'}
                size={30}
                name={p?.display_name}
              />
              <div className="row-main">
                <div className="row-title">{p?.display_name ?? 'Someone'}</div>
                {room.created_by === id && <div className="row-sub">Started this group</div>}
              </div>
              {!isMain && id !== profile?.id && (
                <button
                  className="btn btn-sm btn-danger"
                  title="Remove from group"
                  onClick={() => void removeMember(room.id, id)}
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!isMain && outsiders.length > 0 && (
        <>
          <div className="label" style={{ marginTop: 18 }}>Add someone</div>
          <div className="group" style={{ maxHeight: 220, overflowY: 'auto' }}>
            {outsiders.map((p) => (
              <button
                key={p.id}
                className="row row-clickable"
                onClick={() => void addMember(room.id, p.id)}
              >
                <Avatar
                  emoji={p.avatar_emoji}
                  url={p.avatar_url}
                  color={p.avatar_color}
                  size={30}
                  name={p.display_name}
                />
                <div className="row-main">
                  <div className="row-title">{p.display_name}</div>
                </div>
                <Icon name="userPlus" size={17} />
              </button>
            ))}
          </div>
        </>
      )}

      {!isMain && (
        <button
          className="btn btn-danger"
          style={{ marginTop: 18 }}
          onClick={() => {
            void leaveRoom(room.id);
            onClose();
          }}
        >
          <Icon name="logout" size={16} />
          Leave this group
        </button>
      )}

      {isMain && (
        <p className="row-sub" style={{ marginTop: 14 }}>
          Main is the room everyone shares — people join it automatically and
          nobody can be removed from it.
        </p>
      )}
    </Modal>
  );
}
