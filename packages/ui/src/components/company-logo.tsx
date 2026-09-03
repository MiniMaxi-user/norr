import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

export type CompanyLogoSize = "sm" | "md" | "lg";

export interface CompanyLogoProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  size?: CompanyLogoSize;
  /** Public URL of an uploaded logo — when present, renders an `<img>` inside
   * the tile. Pass `undefined`/`null` (or omit) to render `fallback` instead. */
  logoUrl?: string | null;
  /** Accessible label for the `<img>` — required whenever `logoUrl` is set,
   * e.g. `${clientName} logo`. Ignored (the tile is `aria-hidden` instead)
   * when there's no `logoUrl` to render. */
  alt?: string;
  /** Rendered in place of the image when there's no `logoUrl` — callers
   * supply their own icon (e.g. `<Building2 />` from `@yourorg/ui/icons`)
   * rather than this package hardcoding one, same "icon passed as a prop"
   * convention `IconButton`/`Badge` etc. already use. */
  fallback?: ReactNode;
}

/**
 * Company/business-entity logo tile (issue #120) — deliberately its own
 * primitive rather than a reuse of `Avatar`: a person's headshot is always
 * pre-cropped to a fixed square/circle before it ever reaches `Avatar`
 * (`AvatarUploader`'s crop step), so `Avatar`'s `object-fit: cover` never
 * loses meaningful content. A company logo is the opposite — the source is
 * typically NOT square (a wide wordmark, a tall mark, ...), and the story's
 * "compressed" requirement is a plain resize-to-max-dimension + webp
 * re-encode, no forced crop. `object-fit: contain` on a bordered, tinted
 * square tile shows the whole logo at whatever aspect ratio it has, letterboxed
 * rather than cropped — the "same family, adapted for a logo" look the
 * uploader UI (`app/(app)/clients/components/client-logo-uploader.tsx`) and
 * the read-only preview (`app/(app)/settings/components/
 * organization-company-form.tsx`) both need.
 */
export function CompanyLogo({ size = "md", logoUrl, alt, fallback, className, ...rest }: CompanyLogoProps) {
  return (
    <span
      className={cx("ui-company-logo", size && `ui-company-logo-${size}`, className)}
      aria-hidden={logoUrl ? undefined : true}
      {...rest}
    >
      {logoUrl ? <img className="ui-company-logo-img" src={logoUrl} alt={alt ?? ""} /> : fallback}
    </span>
  );
}
