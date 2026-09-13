/**
 * A Doric temple, drawn rather than photographed: stepped base, six fluted columns, architrave,
 * triglyph frieze and pediment, in pale marble on a light ground. A grain filter stipples the
 * surfaces the way an engraving would, and a mask lets the base dissolve into the page.
 *
 * The one thin cyan line across the architrave is the strike line from the logo.
 */

const COLUMNS = [150, 290, 430, 570, 710, 850];
const SHAFT_TOP = 430;
const SHAFT_BOTTOM = 752;
const HALF_TOP = 31;
const HALF_BOTTOM = 39;
const FLUTES = 9;

function Column({ cx }: { cx: number }) {
  const shaft = `M${cx - HALF_TOP} ${SHAFT_TOP} L${cx + HALF_TOP} ${SHAFT_TOP} L${cx + HALF_BOTTOM} ${SHAFT_BOTTOM} L${cx - HALF_BOTTOM} ${SHAFT_BOTTOM} Z`;
  const flutes = Array.from({ length: FLUTES }, (_, i) => {
    const t = (i + 1) / (FLUTES + 1);
    const xTop = cx - HALF_TOP + t * 2 * HALF_TOP;
    const xBottom = cx - HALF_BOTTOM + t * 2 * HALF_BOTTOM;
    // Flutes near the edges turn away from the light, so they read darker.
    const edge = Math.abs(t - 0.4) * 2;
    return (
      <line
        key={i}
        x1={xTop}
        y1={SHAFT_TOP + 4}
        x2={xBottom}
        y2={SHAFT_BOTTOM - 2}
        stroke="#51637a"
        strokeOpacity={0.14 + edge * 0.22}
        strokeWidth={1.3}
      />
    );
  });
  return (
    <g>
      <path d={shaft} fill="url(#tpl-shaft)" stroke="#72859c" strokeOpacity={0.45} strokeWidth={1} />
      {flutes}
      {/* echinus and abacus */}
      <path
        d={`M${cx - 46} 405 L${cx + 46} 405 L${cx + HALF_TOP + 4} ${SHAFT_TOP} L${cx - HALF_TOP - 4} ${SHAFT_TOP} Z`}
        fill="url(#tpl-stone)"
        stroke="#72859c"
        strokeOpacity={0.45}
      />
      <rect x={cx - 52} y={390} width={104} height={15} fill="url(#tpl-stone)" stroke="#72859c" strokeOpacity={0.45} />
      <rect x={cx - HALF_TOP - 4} y={SHAFT_TOP} width={(HALF_TOP + 4) * 2} height={6} fill="#51637a" opacity={0.12} />
    </g>
  );
}

export function Temple({ className }: { className?: string }) {
  const triglyphs = Array.from({ length: 12 }, (_, i) => 118 + i * 69);
  return (
    <svg className={className} viewBox="50 90 900 800" role="img" aria-label="A drawing of a Greek temple">
      <defs>
        <linearGradient id="tpl-stone" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#edf1f5" />
          <stop offset="1" stopColor="#bcc7d3" />
        </linearGradient>
        <linearGradient id="tpl-shaft" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#b3c0cd" />
          <stop offset="0.3" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#eaeff4" />
          <stop offset="1" stopColor="#9eadbe" />
        </linearGradient>
        <linearGradient id="tpl-fade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0.7" stopColor="#fff" />
          <stop offset="0.9" stopColor="#000" />
        </linearGradient>
        <linearGradient id="tpl-cella" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#b8c4d0" />
          <stop offset="1" stopColor="#dde4ea" />
        </linearGradient>
        <radialGradient id="tpl-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <mask id="tpl-mask">
          <rect width="1000" height="1000" fill="url(#tpl-fade)" />
        </mask>
        <filter id="tpl-grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="2" seed="7" stitchTiles="stitch" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.22  0 0 0 0 0.28  0 0 0 0 0.38  0 0 0 -1.6 1.02"
          />
          <feComposite operator="in" in2="SourceGraphic" />
        </filter>
      </defs>

      <ellipse cx="500" cy="480" rx="430" ry="380" fill="url(#tpl-glow)" />

      <g mask="url(#tpl-mask)">
        <g id="tpl-body">
          {/* pediment */}
          <path d="M90 250 L500 108 L910 250 Z" fill="url(#tpl-stone)" stroke="#72859c" strokeOpacity={0.5} />
          <path d="M150 238 L500 128 L850 238 Z" fill="#e6ecf1" stroke="#72859c" strokeOpacity={0.35} />
          {/* cornice, frieze, architrave */}
          <rect x="80" y="250" width="840" height="22" fill="url(#tpl-stone)" stroke="#72859c" strokeOpacity={0.5} />
          <rect x="80" y="272" width="840" height="6" fill="#51637a" opacity={0.14} />
          <rect x="104" y="278" width="792" height="54" fill="#f2f5f8" stroke="#72859c" strokeOpacity={0.4} />
          {triglyphs.map((x) => (
            <g key={x}>
              <rect x={x} y="282" width="30" height="46" fill="#dde4eb" />
              <line x1={x + 10} x2={x + 10} y1="284" y2="326" stroke="#51637a" strokeOpacity={0.28} />
              <line x1={x + 20} x2={x + 20} y1="284" y2="326" stroke="#51637a" strokeOpacity={0.28} />
            </g>
          ))}
          <rect x="110" y="332" width="780" height="58" fill="url(#tpl-stone)" stroke="#72859c" strokeOpacity={0.45} />
          <rect x="110" y="376" width="780" height="14" fill="#51637a" opacity={0.08} />

          {/* the cella wall in shadow behind the colonnade, so the columns stand forward */}
          <rect x="120" y="390" width="760" height="362" fill="url(#tpl-cella)" />
          {COLUMNS.map((cx) => (
            <Column key={cx} cx={cx} />
          ))}

          {/* stylobate */}
          <rect x="120" y="752" width="760" height="34" fill="url(#tpl-stone)" stroke="#72859c" strokeOpacity={0.45} />
          <rect x="95" y="786" width="810" height="34" fill="url(#tpl-stone)" stroke="#72859c" strokeOpacity={0.4} />
          <rect x="70" y="820" width="860" height="34" fill="url(#tpl-stone)" stroke="#72859c" strokeOpacity={0.35} />
        </g>
        {/* engraving grain, confined to the stone */}
        <use href="#tpl-body" filter="url(#tpl-grain)" opacity={0.28} />
      </g>

      {/* the strike line */}
      <line x1="30" x2="970" y1="361" y2="361" stroke="#4ed5d5" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
