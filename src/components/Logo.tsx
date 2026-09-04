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
          <linearGradient id="nc-edge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-hi, #f4796c)" />
            <stop offset="100%" stopColor="var(--accent, #e0574f)" />
          </linearGradient>
        </defs>

        {/* An upright hexagon, flat-topped and symmetrical about both axes,
            so it reads as a shape rather than as something tipped over. */}
        <path
          d="M16 2.8 27 9.4v13.2L16 29.2 5 22.6V9.4z"
          fill="none"
          stroke="url(#nc-edge)"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />

        {/* The N, centred inside it with even margins. */}
        <path
          d="M12 21V11l8 10V11"
          fill="none"
          stroke="url(#nc-edge)"
          strokeWidth="2.8"
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
