/**
 * The landing hero's temple, drawn as thin line art on the dark ground.
 *
 * Every stroke uses `pathLength="1"` so the CSS can draw it in with one dash offset, whatever its
 * real length. The cyan line across the architrave is the strike: the one horizontal the logo's
 * flat stroke is named after. No fills, no raster, no marble — the page is dark and so is this.
 */
const COLUMNS = 6;
const COL_W = 34;
const LEFT = 70;
const RIGHT = 450;
const COL_TOP = 196;
const COL_BOTTOM = 392;

export function Temple({ className }: { className?: string }) {
  const gap = (RIGHT - LEFT - COLUMNS * COL_W) / (COLUMNS - 1);
  const columns = Array.from({ length: COLUMNS }, (_, i) => LEFT + i * (COL_W + gap));

  return (
    <svg className={className} viewBox="0 0 520 470" role="img" aria-label="A temple drawn in thin lines, with a cyan strike line across it">
      <g className="t-stroke" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {/* pediment */}
        <path pathLength={1} d="M40 128 L260 52 L480 128 Z" />
        <path pathLength={1} d="M78 120 L260 64 L442 120" opacity="0.5" />
        {/* cornice and frieze */}
        <path pathLength={1} d="M30 128 H490 V142 H30 Z" />
        <path pathLength={1} d="M44 142 H476 V172 H44 Z" />
        {[60, 442].map((x) => (
          <path key={`tri${x}`} pathLength={1} d={`M${x} 147 V167 M${x + 6} 147 V167 M${x + 12} 147 V167`} opacity="0.55" />
        ))}
        {/* architrave */}
        <path pathLength={1} d="M52 172 H468 V190 H52 Z" />
        {/* columns */}
        {columns.map((x, i) => (
          <g key={`col${i}`}>
            <path pathLength={1} d={`M${x - 5} ${COL_TOP - 6} H${x + COL_W + 5} V${COL_TOP} H${x - 5} Z`} />
            <path pathLength={1} d={`M${x + 2} ${COL_TOP} L${x} ${COL_BOTTOM} M${x + COL_W - 2} ${COL_TOP} L${x + COL_W} ${COL_BOTTOM}`} />
            {[0.25, 0.5, 0.75].map((f) => (
              <path
                key={f}
                pathLength={1}
                d={`M${x + COL_W * f} ${COL_TOP + 4} V${COL_BOTTOM - 2}`}
                opacity="0.35"
              />
            ))}
          </g>
        ))}
        {/* stylobate */}
        <path pathLength={1} d="M40 392 H480 V404 H40 Z" />
        <path pathLength={1} d="M26 404 H494 V418 H26 Z" />
        <path pathLength={1} d="M12 418 H508 V432 H12 Z" />
      </g>
      {/* the inscription: the curve every offer is priced by, carved into the frieze */}
      <text className="t-inscription" x="260" y="162.5" textAnchor="middle">
        Y = L·K·Φ( Φ⁻¹(1 − X/L) − σ√τ )
      </text>
      {/* the strike */}
      <path className="t-strike" pathLength={1} d="M0 181 H520" fill="none" strokeLinecap="round" />
    </svg>
  );
}
