import { useMemo, useState } from 'react';
import { useSession } from '../../state/session';
import { useEconomy, type ShopItem } from '../../state/economy';
import { Modal } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import { RARITY_COLOR, type Rarity } from './cosmetics';
import { CosmeticPreview } from './CosmeticPreview';

/** What the database calls each family of item. */
export type Kind = 'trail' | 'goalfx' | 'celebration' | 'ball' | 'banner' | 'banneranim' | 'flag';

/**
 * A tab in the shop.
 *
 * Not one per database kind: the country balls are ordinary `ball` items, but
 * there are getting on for two hundred of them, and putting them in with the
 * dozen designed ones would bury those completely. So a tab is a kind plus an
 * optional filter over it, and the two tabs equip through the same slot.
 */
const KINDS: {
  id: string;
  kind: Kind;
  label: string;
  icon: IconName;
  blurb: string;
  only?: (item: ShopItem) => boolean;
  search?: boolean;
}[] = [
  {
    id: 'ball',
    kind: 'ball',
    label: 'Balls',
    icon: 'football',
    blurb: 'How the ball looks while you are on the pitch.',
  },
  {
    id: 'country',
    kind: 'flag',
    label: 'Countries',
    icon: 'users',
    blurb: 'Your country, worn on your player. Your team colour stays as the ring.',
    search: true,
  },
  {
    id: 'trail',
    kind: 'trail',
    label: 'Ball trails',
    icon: 'sparkle',
    blurb: 'Follows the ball while you have it.',
  },
  {
    id: 'goalfx',
    kind: 'goalfx',
    label: 'Goal effects',
    icon: 'zap',
    blurb: 'Fires across the pitch when you score.',
  },
  {
    id: 'celebration',
    kind: 'celebration',
    label: 'Celebrations',
    icon: 'message',
    blurb: 'What the pitch says after your goal.',
  },
  {
    id: 'banner',
    kind: 'banner',
    label: 'Goal cards',
    icon: 'image',
    blurb: 'A picture that pops in on the right when you score.',
  },
  {
    id: 'banneranim',
    kind: 'banneranim',
    label: 'Card motion',
    icon: 'play',
    blurb: 'How your goal card moves while it is up. Free — pick whichever.',
  },
];

/**
 * Shop and locker in one place, because they are the same list seen twice:
 * what you could own, and what you are wearing. Splitting them into separate
 * screens would mean opening two things to change one.
 */
export function Shop({ onClose }: { onClose: () => void }) {
  const { profile } = useSession();
  const { items, owned, equipped, buy, equip } = useEconomy();

  const [tab, setTab] = useState('ball');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [justBought, setJustBought] = useState<string | null>(null);

  const meta = KINDS.find((k) => k.id === tab) ?? KINDS[0];

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => i.kind === meta.kind)
      .filter((i) => (meta.only ? meta.only(i) : true))
      .filter((i) => !q || i.name.toLowerCase().includes(q));
  }, [items, meta, query]);

  if (!profile) return null;

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
      await equip(meta.kind, item.id);
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
            data-on={tab === k.id}
            onClick={() => {
              setTab(k.id);
              setQuery('');
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
          >
            <Icon name={k.icon} size={15} />
            {k.label}
          </button>
        ))}
      </div>

      <p className="row-sub" style={{ margin: '0 0 12px' }}>
        {meta.blurb}
        {meta.kind !== 'banneranim' &&
          ' Earn coins by playing — a win pays 60, a draw 30, a loss 15, plus 10 for every goal.'}
      </p>

      {meta.search && (
        <label className="shop-search">
          <Icon name="search" size={15} />
          <input
            className="input"
            placeholder={`Search ${shown.length === 1 ? '1 country' : `${shown.length} countries`}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="btn btn-ghost btn-icon" onClick={() => setQuery('')} aria-label="Clear">
              <Icon name="x" size={15} />
            </button>
          )}
        </label>
      )}

      {error && <p className="err" style={{ marginTop: 0 }}>{error}</p>}

      <div className="shop-grid">
        {shown.map((item) => {
          const isOwned = owned.has(item.id);
          const isOn = equipped[meta.kind] === item.id;
          const affordable = profile.coins >= item.price;

          return (
            <div
              key={item.id}
              className="shop-card"
              data-on={isOn}
              style={{ ['--rarity' as string]: RARITY_COLOR[item.rarity as Rarity] }}
            >
              <CosmeticPreview id={item.id} kind={meta.kind} accent={profile.accent_color} />

              <div className="shop-name">
                {item.name}
                {item.is_default && <span className="pill">free</span>}
              </div>
              <div className="shop-rarity">{item.rarity}</div>
              {item.blurb && <div className="shop-blurb">{item.blurb}</div>}

              <button
                className={`btn btn-sm ${isOn ? '' : isOwned || affordable ? 'btn-accent' : ''}`}
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
                ) : item.price === 0 ? (
                  'Use it'
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

        {shown.length === 0 && (
          <div className="empty" style={{ gridColumn: '1 / -1' }}>
            {query ? `Nothing matching “${query}”.` : 'Nothing here yet.'}
          </div>
        )}
      </div>
    </Modal>
  );
}
