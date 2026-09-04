import { useState } from 'react';
import { useSession } from '../../state/session';
import { useEconomy, type ShopItem } from '../../state/economy';
import { Modal } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { RARITY_COLOR, type Rarity } from './cosmetics';
import { CosmeticPreview } from './CosmeticPreview';

type Kind = 'trail' | 'goalfx' | 'celebration' | 'ball';

const KINDS: { id: Kind; label: string; icon: IconName; blurb: string }[] = [
  { id: 'ball', label: 'Balls', icon: 'football', blurb: 'How the ball looks while you are the last to touch it.' },
  { id: 'trail', label: 'Ball trails', icon: 'sparkle', blurb: 'Follows the ball while you have it.' },
  { id: 'goalfx', label: 'Goal effects', icon: 'zap', blurb: 'Fires across the pitch when you score.' },
  { id: 'celebration', label: 'Celebrations', icon: 'message', blurb: 'What the pitch says after your goal.' },
];

/**
 * Shop and locker in one place, because they are the same list seen twice:
 * what you could own, and what you are wearing. Splitting them into separate
 * screens would mean opening two things to change one.
 */
export function Shop({ onClose }: { onClose: () => void }) {
  const { profile } = useSession();
  const { items, owned, equipped, buy, equip } = useEconomy();

  const [kind, setKind] = useState<Kind>('ball');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [justBought, setJustBought] = useState<string | null>(null);

  if (!profile) return null;

  const shown = items.filter((i) => i.kind === kind);
  const meta = KINDS.find((k) => k.id === kind)!;

  const act = async (item: ShopItem) => {
    setError('');
    setBusy(item.id);
    try {
      if (!owned.has(item.id)) {
        const err = await buy(item.id);
        if (err) {
          setError(err);
          return;
        }
        setJustBought(item.id);
        window.setTimeout(() => setJustBought(null), 1800);
      }
      // Buying something you cannot see is pointless, so it goes straight on.
      await equip(kind, item.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          Shop
          <span className="coin-pill">
            <Icon name="coin" size={14} />
            {profile.coins.toLocaleString()}
          </span>
        </span>
      }
      onClose={onClose}
      wide
    >
      <div className="settings-nav" style={{ margin: '-18px -18px 16px' }}>
        {KINDS.map((k) => (
          <button
            key={k.id}
            className="settings-tab"
            data-on={kind === k.id}
            onClick={() => setKind(k.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
          >
            <Icon name={k.icon} size={15} />
            {k.label}
          </button>
        ))}
      </div>

      <p className="row-sub" style={{ margin: '0 0 14px' }}>
        {meta.blurb} Earn coins by playing — a win pays 60, a draw 30, a loss 15,
        plus 10 for every goal.
      </p>

      {error && <p className="err" style={{ marginTop: 0 }}>{error}</p>}

      <div className="shop-grid">
        {shown.map((item) => {
          const isOwned = owned.has(item.id);
          const isOn = equipped[kind] === item.id;
          const affordable = profile.coins >= item.price;

          return (
            <div
              key={item.id}
              className="shop-card"
              data-on={isOn}
              style={{ ['--rarity' as string]: RARITY_COLOR[item.rarity as Rarity] }}
            >
              <CosmeticPreview id={item.id} kind={kind} accent={profile.accent_color} />

              <div className="shop-name">
                {item.name}
                {item.is_default && <span className="pill">free</span>}
              </div>
              <div className="shop-rarity">{item.rarity}</div>
              {item.blurb && <div className="shop-blurb">{item.blurb}</div>}

              <button
                className={`btn btn-sm ${isOn ? '' : isOwned ? 'btn-accent' : affordable ? 'btn-accent' : ''}`}
                disabled={isOn || busy === item.id || (!isOwned && !affordable)}
                onClick={() => void act(item)}
                style={{ width: '100%', marginTop: 'auto' }}
              >
                {busy === item.id ? (
                  <span className="spinner" />
                ) : isOn ? (
                  <>
                    <Icon name="check" size={14} />
                    Equipped
                  </>
                ) : isOwned ? (
                  'Equip'
                ) : affordable ? (
                  <>
                    <Icon name="coin" size={14} />
                    {item.price}
                  </>
                ) : (
                  <>
                    <Icon name="lock" size={13} />
                    {item.price}
                  </>
                )}
              </button>

              {justBought === item.id && <div className="shop-bought">Bought!</div>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
