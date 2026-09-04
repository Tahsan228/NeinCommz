/**
 * The icon set. Hand-drawn 24x24 stroke paths that inherit `currentColor`, so
 * an icon always matches the text next to it and never fights the theme.
 *
 * Emoji are kept for things people choose for themselves — avatars, custom
 * status text. Everything that is chrome uses these instead, because emoji
 * render differently on every machine and read as decoration rather than as
 * controls.
 */

export type IconName =
  | 'settings'
  | 'send'
  | 'plus'
  | 'image'
  | 'gif'
  | 'reply'
  | 'trash'
  | 'smile'
  | 'x'
  | 'search'
  | 'undo'
  | 'eraser'
  | 'users'
  | 'userPlus'
  | 'message'
  | 'clock'
  | 'calendar'
  | 'check'
  | 'logout'
  | 'ban'
  | 'play'
  | 'upload'
  | 'key'
  | 'snowflake'
  | 'grid'
  | 'palette'
  | 'football'
  | 'book'
  | 'lunch'
  | 'zap'
  | 'pin'
  | 'moon'
  | 'circle'
  | 'headphones'
  | 'phoneOff'
  | 'chevronDown'
  | 'pencil'
  | 'camera'
  | 'lock'
  | 'bell'
  | 'palette2'
  | 'sparkle'
  | 'trophy'
  | 'coin'
  | 'chess'
  | 'shop'
  | 'flag';

const PATHS: Record<IconName, JSX.Element> = {
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  send: (
    <>
      <path d="M21.5 2.5 2.8 10.2c-.7.3-.7 1.3.1 1.5l6.6 2 2 6.6c.2.8 1.2.8 1.5.1z" />
      <path d="m9.5 13.7 12-11.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m3 16 4.5-4.5a2 2 0 0 1 2.8 0L15 16" />
      <path d="m14 15 1.8-1.8a2 2 0 0 1 2.8 0L21 15.5" />
    </>
  ),
  gif: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="3" />
      <path d="M2.5 8.5h19M2.5 15.5h19M7 4.5v4M7 15.5v4M17 4.5v4M17 15.5v4" />
      <path d="M10.6 10.4v3.2l3-1.6z" />
    </>
  ),
  reply: <path d="M9 15 4 10l5-5M4 10h8a8 8 0 0 1 8 8v1" />,
  trash: (
    <>
      <path d="M4 7h16M10 4h4M9 7v12M15 7v12" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  undo: <path d="M4 9h11a5 5 0 0 1 0 10h-6M4 9l4-4M4 9l4 4" />,
  eraser: (
    <>
      <path d="m5 15 7-7a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8l-4 4H8z" />
      <path d="M8 19H20" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3.5 3.5 0 0 1 0 7M17.5 20a6.4 6.4 0 0 0-2-4.4" />
    </>
  ),
  userPlus: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M18 8v6M15 11h6" />
    </>
  ),
  message: <path d="M20 15a3 3 0 0 1-3 3H9l-5 3 1.2-3.6A3 3 0 0 1 4 15V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  check: <path d="m5 13 4.5 4.5L19 7" />,
  logout: <path d="M15 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h11" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </>
  ),
  play: <path d="M8 5.5v13l11-6.5z" />,
  upload: <path d="M12 16V4M8 8l4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8M17 6l2 2M14.5 8.5l2 2" />
    </>
  ),
  snowflake: (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
      <path d="M12 6.5 9.6 4.6M12 6.5l2.4-1.9M12 17.5l-2.4 1.9M12 17.5l2.4 1.9" />
      <path d="m6.6 9.6-3-.4M6.6 9.6l-.7-2.9M17.4 14.4l3 .4M17.4 14.4l.7 2.9" />
      <path d="m6.6 14.4-3 .4M6.6 14.4l-.7 2.9M17.4 9.6l3-.4M17.4 9.6l.7-2.9" />
    </>
  ),
  grid: <path d="M4 9.5h16M4 14.5h16M9.5 4v16M14.5 4v16" />,
  palette: (
    <>
      <path d="M12 21a9 9 0 1 1 9-9c0 1.7-1.3 3-3 3h-1.5a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 21z" />
      <path d="M7.5 12h.01M9.5 8h.01M14 7.5h.01M16.5 10.5h.01" />
    </>
  ),
  football: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 7.6 3.6 2.6-1.4 4.3H9.8l-1.4-4.3z" />
      <path d="M12 3.1v4.5M20.6 9.9l-5 .3M17.3 19.9l-3.1-5.4M6.7 19.9l3.1-5.4M3.4 9.9l5 .3" />
    </>
  ),
  book: <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />,
  lunch: (
    <>
      <path d="M4 11h16a8 8 0 0 1-8 7 8 8 0 0 1-8-7z" />
      <path d="M3 21h18" />
      <path d="M9 7c0-1 1-1.2 1-2.2S9 3 9 3M14 7c0-1 1-1.2 1-2.2S14 3 14 3" />
    </>
  ),
  zap: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  pin: (
    <>
      <path d="M12 21v-6" />
      <path d="M8.5 4h7l-.8 5.2 2.3 2.3a1 1 0 0 1-.7 1.7H7.7a1 1 0 0 1-.7-1.7l2.3-2.3z" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />,
  circle: <circle cx="12" cy="12" r="6.5" />,
  headphones: <path d="M4 15v-3a8 8 0 0 1 16 0v3M4 14h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM20 14h-2a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1z" />,
  phoneOff: (
    <>
      <path d="M7.5 3.5h9a1.5 1.5 0 0 1 1.5 1.5v6M18 16v3a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V7" />
      <path d="M4 3.5 20 20.5" />
    </>
  ),
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  pencil: <path d="M4 20h4L19.5 8.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z" />,
  camera: (
    <>
      <path d="M3 8a2 2 0 0 1 2-2h2.5l1.3-2h6.4L16.5 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10" rx="2.5" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </>
  ),
  bell: <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 19a2 2 0 0 0 4 0" />,
  palette2: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  sparkle: <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9zM18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />,

  trophy: (
    <>
      <path d="M7 4h10v6a5 5 0 0 1-10 0z" />
      <path d="M7 5.5H4.6a.6.6 0 0 0-.6.7c.3 2.3 1.6 3.7 3.4 4M17 5.5h2.4c.4 0 .7.3.6.7-.3 2.3-1.6 3.7-3.4 4" />
      <path d="M12 15v3M9 21h6M10 18h4l.4 3H9.6z" />
    </>
  ),

  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5.4" />
      <path d="M12 9.4v5.2M10.6 10.6h2.2a1.2 1.2 0 0 1 0 2.4h-1.6a1.2 1.2 0 0 0 0 2.4h2.2" />
    </>
  ),

  // A knight, because a generic grid could be any board game.
  chess: (
    <>
      <path d="M9.5 20h7.5c0-4-1-6.4-2-8.2 1.2-2.6.4-5.2-2-6.6l-.6 1.5-3-1.2-2.6 3.4c-.9 1.2-.6 2.6.6 3.2l2.3-1.7" />
      <path d="M6.5 20h12" />
      <path d="M10.2 9.2h.01" />
    </>
  ),

  shop: (
    <>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" />
    </>
  ),

  flag: <path d="M6 21V4M6 4.5h11l-2 4 2 4H6" />,
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
