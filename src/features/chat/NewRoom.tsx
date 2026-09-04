import { useState } from 'react';
import type { UUID } from '../../lib/types';
import { useSession } from '../../state/session';
import { useDirectory } from '../../state/directory';
import { useRooms } from '../../state/rooms';
import { Avatar, Field, Modal, Spinner } from '../../components/ui';
import { Icon } from '../../components/Icon';

/** Start a group chat, or open a direct message with one person. */
export function NewRoom({ onClose }: { onClose: () => void }) {
  const { profile } = useSession();
  const { profiles } = useDirectory();
  const { createGroup, openDm } = useRooms();

  const [mode, setMode] = useState<'dm' | 'group'>('dm');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<UUID>>(new Set());
  const [busy, setBusy] = useState(false);

  const others = profiles.filter((p) => p.id !== profile?.id);

  const toggle = (id: UUID) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      // A direct message is between exactly two people, so picking someone
      // else replaces the choice rather than adding to it.
      else if (mode === 'dm') return new Set([id]);
      else next.add(id);
      return next;
    });

  const go = async () => {
    setBusy(true);
    if (mode === 'dm') {
      const [other] = [...picked];
      if (other) await openDm(other);
    } else {
      await createGroup(name, [...picked]);
    }
    setBusy(false);
    onClose();
  };

  const ready = mode === 'dm' ? picked.size === 1 : picked.size >= 1 && name.trim().length > 0;

  return (
    <Modal
      title="New conversation"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-accent" disabled={!ready || busy} onClick={() => void go()}>
            {busy ? <Spinner /> : mode === 'dm' ? 'Open chat' : 'Create group'}
          </button>
        </>
      }
    >
      <div className="settings-nav" style={{ margin: '-18px -18px 18px' }}>
        <button
          className="settings-tab"
          data-on={mode === 'dm'}
          onClick={() => {
            setMode('dm');
            setPicked(new Set());
          }}
        >
          <Icon name="message" size={15} /> Direct message
        </button>
        <button
          className="settings-tab"
          data-on={mode === 'group'}
          onClick={() => setMode('group')}
        >
          <Icon name="users" size={15} /> Group
        </button>
      </div>

      {mode === 'group' && (
        <Field label="Group name">
          <input
            className="input"
            autoFocus
            maxLength={40}
            placeholder="Bio class survivors"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      )}

      <div className="label">{mode === 'dm' ? 'Who' : 'Who is in it'}</div>
      <div className="group" style={{ maxHeight: 280, overflowY: 'auto' }}>
        {others.length === 0 && <div className="empty">Nobody else has a profile yet.</div>}
        {others.map((p) => (
          <button key={p.id} className="row row-clickable" onClick={() => toggle(p.id)}>
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
            {picked.has(p.id) && <Icon name="check" size={17} style={{ color: 'var(--accent)' }} />}
          </button>
        ))}
      </div>
    </Modal>
  );
}
