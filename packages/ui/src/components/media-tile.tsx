import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type MediaTileSize = "md" | "lg" | "xl";

export interface MediaTileProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Public URL of an uploaded photo — when present, renders an `<img>`
   * inside the tile. Pass `undefined`/`null` (or omit) to render `fallback`
   * instead. */
  imageUrl?: string | null;
  /** Accessible label for the `<img>` — required whenever `imageUrl` is set.
   * Ignored (the tile is `aria-hidden` instead) when there's no `imageUrl` to
   * render. */
  alt?: string;
  /** Rendered in place of the image when there's no `imageUrl` — callers
   * supply their own icon (e.g. `<Camera />` from `@yourorg/ui/icons`) rather
   * than this package hardcoding one, same "icon passed as a prop" convention
   * `CompanyLogo`/`IconButton`/`Badge` etc. already use. */
  fallback?: ReactNode;
  size?: MediaTileSize;
  className?: string;
}

/**
 * A generic, non-cropped photo tile (issue #123, Articles' "photo somewhere
 * well-designed" ask) — a tinted, bordered square-ish surface with
 * `object-fit: contain` so an arbitrary tenant-supplied source (any aspect
 * ratio, not pre-cropped) is letterboxed rather than cropped or distorted.
 * Deliberately its own primitive rather than a reuse of `CompanyLogo`: that
 * component's name/doc comment are specific to a business-entity logo, and a
 * product/article photo is a different concern that happens to want the
 * exact same "bordered tile, contain-fit, icon fallback" shape — reused here
 * as a shared, more generically-named primitive instead of forking one more
 * bespoke `<img>` + inline style per module. First caller: the Article detail
 * screen's Photo section (`app/(app)/articles/components/article-media-section.tsx`).
 * Purely presentational (no `onError` — same reasoning `CompanyLogo`/`Avatar`
 * document for themselves: this package's client boundary is intentionally
 * limited to `ThemeProvider`/`useTheme`/`Tabs`), so a broken URL falls back to
 * the browser's own broken-image icon rather than this tile's `fallback` —
 * acceptable, matching the read-only table row treatment this same module's
 * list view already has for a bad `image_url`.
 */
export function MediaTile({ imageUrl, alt, fallback, size = "lg", className, ...rest }: MediaTileProps) {
  return (
    <div
      className={cx("ui-media-tile", size && `ui-media-tile-${size}`, className)}
      aria-hidden={imageUrl ? undefined : true}
      {...rest}
    >
      {imageUrl ? <img className="ui-media-tile-img" src={imageUrl} alt={alt ?? ""} /> : fallback}
    </div>
  );
}
