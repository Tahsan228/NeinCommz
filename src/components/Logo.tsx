/**
 * The NeinCommz mark.
 *
 * A crystal facet with an N cut through it — cold, and a monogram, without
 * needing either word spelled out. Drawn as SVG so it stays sharp at any size
 * and picks up the profile's accent colour, and paired with a wordmark so the
 * corner reads as a logo rather than a stray glyph.
 */

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span className="logo-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden focusable="false">
        <defs>
          <linearGradient id="nc-facet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
            <stop offset="55%" stopColor="rgba(255,255,255,0.08)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.22)" />
          </linearGradient>
        </defs>

        {/* The crystal: a hexagon, slightly tall, with facet lines. */}
        <path d="M16 2.6 27.2 9v14L16 29.4 4.8 23V9z" fill="url(#nc-facet)" />
        <path
          d="M16 2.6 27.2 9v14L16 29.4 4.8 23V9z"
          fill="none"
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <path
          d="M16 2.6v26.8M4.8 9l22.4 14M27.2 9 4.8 23"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="0.9"
        />

        {/* The N, sitting proud of the facets. */}
        <path
          d="M11.6 21.4V10.6l8.8 10.8V10.6"
          fill="none"
          stroke="#fff"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word">
        <b>Nein</b>
        <span>Commz</span>
      </span>
    </span>
  );
}
