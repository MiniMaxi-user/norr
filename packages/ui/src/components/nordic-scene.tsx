import type { SVGProps } from "react";
import { cx } from "../cx";

/**
 * Decorative full-bleed illustration for the login screen's right-hand
 * panel: a layered Nordic dusk — forest silhouettes doubled by a lake
 * reflection, a brass "midnight sun" glow, faint aurora bands and a small
 * compass rose nodding to "norr" (Swedish for north) — the brand's own "we
 * give direction" story. Pure inline SVG, no raster assets. Ported from
 * norrdesign's `examples/lib/NordicScene.tsx` reference build.
 *
 * Colors are mixed from the fixed `--ui-brand-*` primitives (never a raw
 * hex, and never the semantic `--ui-accent`/`--ui-fg` tokens) the same way
 * `Logo`'s peillijn stroke is fixed — this is a fixed brand surface (like
 * `Logo`), not a theme-following one: it always renders this dusk palette
 * regardless of the page's light/dark toggle.
 */

const VIEW_W = 900;
const VIEW_H = 1400;
const SHORE_Y = 1000;

/** One conifer silhouette's outline, kept separate per tree (rather than
 * joined into the row's single path string) so each can sway independently
 * — see `ForestRow`. */
interface TreeShape {
  d: string;
}

/** A row of stepped-tier conifer silhouettes, deterministically varied — no Math.random. */
function pineRow(baseY: number, count: number, spacing: number, offset: number, minH: number, maxH: number): TreeShape[] {
  const trees: TreeShape[] = [];
  for (let i = 0; i < count; i++) {
    const x = offset + i * spacing;
    const h = minH + ((i * 47) % (maxH - minH));
    const w = h * 0.62;
    const y = baseY;
    trees.push({
      d: [
        `M${x - w / 2},${y}`,
        `L${x - w / 6},${y}`,
        `L${x - w / 2.6},${y - h * 0.38}`,
        `L${x - w / 6},${y - h * 0.38}`,
        `L${x - w / 3},${y - h * 0.7}`,
        `L${x - w / 10},${y - h * 0.7}`,
        `L${x},${y - h}`,
        `L${x + w / 10},${y - h * 0.7}`,
        `L${x + w / 3},${y - h * 0.7}`,
        `L${x + w / 6},${y - h * 0.38}`,
        `L${x + w / 2.6},${y - h * 0.38}`,
        `L${x + w / 6},${y}`,
        `L${x + w / 2},${y}`,
        "Z",
      ].join(" "),
    });
  }
  return trees;
}

/** A jagged distant-ridge silhouette between two x bounds. */
function ridge(baseY: number, peakMin: number, peakMax: number, steps: number, seedMul: number) {
  const step = VIEW_W / steps;
  let d = `M-10,${baseY + 300}`;
  d += ` L-10,${baseY}`;
  for (let i = 0; i <= steps; i++) {
    const x = i * step;
    const h = peakMin + ((i * seedMul) % (peakMax - peakMin));
    d += ` L${x.toFixed(1)},${(baseY - h).toFixed(1)}`;
  }
  d += ` L${VIEW_W + 10},${baseY} L${VIEW_W + 10},${baseY + 300} Z`;
  return d;
}

const backRidge = ridge(760, 60, 150, 10, 53);
const frontRidge = ridge(880, 40, 130, 12, 41);
const forestBack = pineRow(940, 26, 38, -10, 55, 105);
const forestMid = pineRow(968, 24, 42, 8, 70, 130);
const forestFront = pineRow(SHORE_Y, 20, 50, -20, 90, 170);

function ReflectionGroup({ children }: { children: React.ReactNode }) {
  return (
    <g transform={`translate(0, ${SHORE_Y * 2}) scale(1, -1)`} opacity={0.32} filter="url(#ns-blur-reflect)">
      {children}
    </g>
  );
}

/** One depth-graded forest row, rendered as individually-swaying trees
 * rather than one flattened path — each tree's `animation-duration`/`-delay`
 * is deterministically varied by index (same no-Math.random convention as
 * `pineRow`'s height jitter) so the row doesn't sway in lockstep; the actual
 * `ns-sway` keyframes/timing-function/iteration-count live on the shared
 * `.ns-tree` class (see the `<style>` block in `NordicScene`). Trees are
 * grouped under one `<g fill/opacity>` rather than each carrying its own —
 * SVG composites a group's `opacity` as a single flattened layer, so
 * neighboring trees' overlapping silhouettes still merge seamlessly at the
 * row's opacity instead of double-blending at the overlap like independent
 * per-path opacity would. */
function ForestRow({ trees, fill, opacity }: { trees: TreeShape[]; fill: string; opacity: number }) {
  return (
    <g fill={fill} opacity={opacity}>
      {trees.map((tree, i) => (
        <path
          key={i}
          d={tree.d}
          className="ns-tree"
          style={{
            animationDuration: `${5.5 + ((i * 13) % 6)}s`,
            animationDelay: `-${(i * 7) % 6}s`,
          }}
        />
      ))}
    </g>
  );
}

export type NordicSceneProps = SVGProps<SVGSVGElement>;

export function NordicScene({ className, ...rest }: NordicSceneProps) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid slice"
      className={cx("ui-nordic-scene", className)}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <style>
        {`
          .ns-tree {
            transform-box: fill-box;
            transform-origin: 50% 100%;
            animation-name: ns-sway;
            animation-timing-function: ease-in-out;
            animation-iteration-count: infinite;
          }
          .ns-sun-glow {
            transform-box: fill-box;
            transform-origin: 50% 50%;
            animation: ns-glow-pulse 7.5s ease-in-out infinite;
          }
          @keyframes ns-sway {
            0%, 100% { transform: rotate(-1deg); }
            50% { transform: rotate(1deg); }
          }
          @keyframes ns-glow-pulse {
            0%, 100% { opacity: 0.85; transform: scale(0.97); }
            50% { opacity: 1; transform: scale(1.06); }
          }
          @media (prefers-reduced-motion: reduce) {
            .ns-tree, .ns-sun-glow { animation: none; }
          }
        `}
      </style>
      <defs>
        <linearGradient id="ns-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: "var(--ui-brand-fjord)" }} />
          <stop offset="48%" style={{ stopColor: "color-mix(in srgb, var(--ui-brand-fjord) 88%, var(--ui-brand-massing))" }} />
          <stop offset="74%" style={{ stopColor: "color-mix(in srgb, var(--ui-brand-fjord) 62%, var(--ui-brand-massing))" }} />
          <stop offset="100%" style={{ stopColor: "color-mix(in srgb, var(--ui-brand-fjord) 80%, var(--ui-brand-massing))" }} />
        </linearGradient>
        <radialGradient id="ns-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" style={{ stopColor: "var(--ui-brand-massing)", stopOpacity: 0.9 }} />
          <stop offset="45%" style={{ stopColor: "var(--ui-brand-massing)", stopOpacity: 0.35 }} />
          <stop offset="100%" style={{ stopColor: "var(--ui-brand-massing)", stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id="ns-lake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: "color-mix(in srgb, var(--ui-brand-fjord) 70%, var(--ui-brand-massing))" }} />
          <stop offset="100%" style={{ stopColor: "var(--ui-brand-fjord)" }} />
        </linearGradient>
        <filter id="ns-blur-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <filter id="ns-blur-reflect" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id="ns-blur-mist" x="-30%" y="-100%" width="160%" height="300%">
          <feGaussianBlur stdDeviation="26" />
        </filter>
        <clipPath id="ns-lake-clip">
          <rect x="0" y={SHORE_Y} width={VIEW_W} height={VIEW_H - SHORE_Y} />
        </clipPath>
        <radialGradient id="ns-vignette" cx="50%" cy="40%" r="75%">
          <stop offset="55%" style={{ stopColor: "var(--ui-brand-fjord)", stopOpacity: 0 }} />
          <stop offset="100%" style={{ stopColor: "color-mix(in srgb, var(--ui-brand-fjord) 40%, black)", stopOpacity: 0.55 }} />
        </radialGradient>
      </defs>

      <rect width={VIEW_W} height={VIEW_H} fill="url(#ns-sky)" />

      {/* stars — spread across the full sky height (not just the top),
          since the split-layout column crops this scene much shorter than
          its portrait viewBox: on most screens the visible slice sits in
          the lower half, and a starfield only up top would go missing */}
      {[
        [70, 90], [140, 160], [230, 70], [310, 150], [60, 240], [400, 100], [480, 200], [560, 90],
        [180, 260], [650, 150], [720, 240], [820, 110], [870, 220], [40, 340], [260, 320], [610, 300],
        [110, 430], [340, 480], [520, 440], [760, 400], [30, 560], [220, 600], [450, 620], [700, 580],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 2.4 : 1.4} fill="var(--ui-brand-snow)" opacity={i % 4 === 0 ? 0.9 : 0.5} />
      ))}

      {/* midnight sun, low over the treeline — the true midsummer-night
          phenomenon the name nods to. `preserveAspectRatio="slice"` crops
          this portrait viewBox to whatever aspect the split-panel column
          ends up (anywhere from ~1:1 on a laptop to ~1.9:1 on an ultrawide
          monitor); a sun placed as high as this scene's original daytime
          composition disappears above frame on the wider end. cy=580 sits
          in the visible band for both, its lower rim just grazing the
          ridge peaks like it's setting behind them. */}
      <g transform="translate(0, 170)">
        {/* aurora bands */}
        <path
          d="M-50,220 C180,140 330,260 520,180 C680,120 780,200 950,150 L950,320 C760,260 640,320 500,300 C330,280 160,340 -50,300 Z"
          fill="var(--ui-brand-snow)"
          opacity={0.06}
          filter="url(#ns-blur-soft)"
        />
        <path
          d="M-50,340 C150,290 300,380 480,320 C660,260 800,340 950,300 L950,420 C760,380 620,420 470,400 C300,380 140,420 -50,390 Z"
          fill="var(--ui-brand-massing)"
          opacity={0.08}
          filter="url(#ns-blur-soft)"
        />
        <circle className="ns-sun-glow" cx={660} cy={410} r={200} fill="url(#ns-glow)" />
        <circle cx={660} cy={410} r={48} fill="var(--ui-brand-massing)" opacity={0.95} />
      </g>

      {/* mountains */}
      <path d={backRidge} fill="color-mix(in srgb, var(--ui-brand-fjord) 60%, var(--ui-brand-massing))" opacity={0.55} />
      <path d={frontRidge} fill="color-mix(in srgb, var(--ui-brand-fjord) 78%, var(--ui-brand-massing))" opacity={0.8} />

      {/* ground mist, sitting low in the valley ahead of the ridgeline —
          the first of three bands that thicken toward the shore, giving
          the treeline real atmospheric depth instead of flat silhouettes */}
      <ellipse cx={VIEW_W / 2} cy={905} rx={VIEW_W * 0.62} ry={26} fill="var(--ui-brand-snow)" opacity={0.05} filter="url(#ns-blur-mist)" />

      {/* forest — three depth-graded rows, darkest and sharpest nearest the
          shore, each seam softened by a mist band so the layers read as
          distance rather than stacked cutouts */}
      <ForestRow trees={forestBack} fill="color-mix(in srgb, var(--ui-brand-fjord) 88%, black)" opacity={0.7} />
      <ellipse cx={VIEW_W / 2} cy={958} rx={VIEW_W * 0.58} ry={22} fill="var(--ui-brand-snow)" opacity={0.06} filter="url(#ns-blur-mist)" />
      <ForestRow trees={forestMid} fill="color-mix(in srgb, var(--ui-brand-fjord) 94%, black)" opacity={0.85} />
      <ellipse cx={VIEW_W / 2} cy={992} rx={VIEW_W * 0.56} ry={20} fill="var(--ui-brand-snow)" opacity={0.08} filter="url(#ns-blur-mist)" />
      <ForestRow trees={forestFront} fill="var(--ui-brand-fjord)" opacity={1} />

      {/* lake */}
      <rect x="0" y={SHORE_Y} width={VIEW_W} height={VIEW_H - SHORE_Y} fill="url(#ns-lake)" />
      <g clipPath="url(#ns-lake-clip)">
        <ReflectionGroup>
          <circle className="ns-sun-glow" cx={660} cy={230} r={150} fill="url(#ns-glow)" />
          <circle cx={660} cy={230} r={54} fill="var(--ui-brand-massing)" />
          <path d={backRidge} fill="color-mix(in srgb, var(--ui-brand-fjord) 60%, var(--ui-brand-massing))" />
          <path d={frontRidge} fill="color-mix(in srgb, var(--ui-brand-fjord) 78%, var(--ui-brand-massing))" />
          <ForestRow trees={forestFront} fill="var(--ui-brand-fjord)" opacity={1} />
        </ReflectionGroup>
        {/* light ripples */}
        {[1030, 1080, 1140, 1210, 1290, 1360].map((y, i) => (
          <rect key={y} x={80 + (i % 2) * 40} y={y} width={620 - i * 40} height={2} fill="var(--ui-brand-snow)" opacity={0.05 + (i % 3) * 0.02} />
        ))}
      </g>

      {/* mist rising off the shoreline, overlapping the treeline/lake seam —
          the thickest band, where fog actually gathers on a still lake */}
      <ellipse cx={VIEW_W / 2} cy={SHORE_Y} rx={VIEW_W * 0.66} ry={30} fill="var(--ui-brand-snow)" opacity={0.09} filter="url(#ns-blur-mist)" />

      {/* vignette — darkens the frame edges so the midnight sun and
          treeline stay the focal point, the way a graded photograph would */}
      <rect width={VIEW_W} height={VIEW_H} fill="url(#ns-vignette)" />

      {/* compass rose — small brand signature, echoes the Logomark's peillijn */}
      <g transform={`translate(${VIEW_W - 96}, ${VIEW_H - 120})`} opacity={0.85}>
        <circle r="34" fill="none" stroke="var(--ui-brand-snow)" strokeOpacity={0.35} strokeWidth={1} />
        <line x1="0" y1="-34" x2="0" y2="-26" stroke="var(--ui-brand-snow)" strokeOpacity={0.5} strokeWidth={1.5} />
        <line x1="0" y1="34" x2="0" y2="26" stroke="var(--ui-brand-snow)" strokeOpacity={0.35} strokeWidth={1} />
        <line x1="-34" y1="0" x2="-26" y2="0" stroke="var(--ui-brand-snow)" strokeOpacity={0.35} strokeWidth={1} />
        <line x1="34" y1="0" x2="26" y2="0" stroke="var(--ui-brand-snow)" strokeOpacity={0.35} strokeWidth={1} />
        <path d="M0,-20 L6,4 L0,-2 L-6,4 Z" fill="var(--ui-brand-massing)" />
        <text x="0" y="-42" textAnchor="middle" fontSize="11" fontWeight={600} fill="var(--ui-brand-snow)" opacity={0.7}>
          N
        </text>
      </g>
    </svg>
  );
}
