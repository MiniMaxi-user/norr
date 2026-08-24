import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../cx";

/**
 * Split-screen shell for a pre-auth screen (login today; reach for it again
 * for any future full-bleed auth surface): a form column paired with a
 * full-bleed brand illustration. Ported structurally from norrdesign's
 * `LoginPage.stories.tsx` reference build. Hook-free, like every other
 * layout primitive in this package — purely structural CSS, no state.
 *
 * ```tsx
 * <AuthSplitLayout>
 *   <AuthSplitLayout.Panel>
 *     <Logo />
 *     <AuthSplitLayout.FormArea>...</AuthSplitLayout.FormArea>
 *     <Text tone="muted">Beveiligd met enterprise-grade encryptie</Text>
 *   </AuthSplitLayout.Panel>
 *   <AuthSplitLayout.Illustration cornerMark={<Logomark />} tagline="..." description="...">
 *     <NordicScene />
 *   </AuthSplitLayout.Illustration>
 * </AuthSplitLayout>
 * ```
 */
export interface AuthSplitLayoutProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

function AuthSplitLayoutRoot({ className, children, ...rest }: AuthSplitLayoutProps) {
  return (
    <div className={cx("ui-auth-split", className)} {...rest}>
      {children}
    </div>
  );
}

export interface AuthSplitPanelProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/** Left column: logo (top) / form (middle) / trust line (bottom), spaced
 * across the full column height. */
function AuthSplitPanel({ className, children, ...rest }: AuthSplitPanelProps) {
  return (
    <div className={cx("ui-auth-split-panel", className)} {...rest}>
      {children}
    </div>
  );
}

export interface AuthSplitFormAreaProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/** Centered, width-capped wrapper for the actual sign-in form block within
 * `Panel` — kept narrow (like a real login card) even though `Panel` itself
 * spans the full column width. */
function AuthSplitFormArea({ className, children, ...rest }: AuthSplitFormAreaProps) {
  return (
    <div className={cx("ui-auth-split-form", className)} {...rest}>
      {children}
    </div>
  );
}

export interface AuthSplitIllustrationProps extends HTMLAttributes<HTMLDivElement> {
  /** Small brand mark pinned to the top-left corner of the illustration
   * (e.g. `<Logomark />`). */
  cornerMark?: ReactNode;
  /** Headline rendered over the illustration's bottom gradient scrim. */
  tagline?: ReactNode;
  /** Supporting copy under `tagline`. */
  description?: ReactNode;
  children?: ReactNode;
}

/** Right column: full-bleed illustration (`children`, typically
 * `<NordicScene />`) with an optional corner mark and a bottom gradient
 * scrim carrying a tagline. Hidden below the layout's tablet breakpoint (see
 * styles.css) — the form panel becomes the whole screen on narrow
 * viewports, same as norrdesign's reference build. */
function AuthSplitIllustration({
  cornerMark,
  tagline,
  description,
  className,
  children,
  ...rest
}: AuthSplitIllustrationProps) {
  return (
    <div className={cx("ui-auth-split-illustration", className)} {...rest}>
      {children}
      {cornerMark && <div className="ui-auth-split-illustration-mark">{cornerMark}</div>}
      {(tagline || description) && (
        <div className="ui-auth-split-illustration-scrim">
          {tagline && <p className="ui-auth-split-illustration-tagline">{tagline}</p>}
          {description && <p className="ui-auth-split-illustration-description">{description}</p>}
        </div>
      )}
    </div>
  );
}

export const AuthSplitLayout = Object.assign(AuthSplitLayoutRoot, {
  Panel: AuthSplitPanel,
  FormArea: AuthSplitFormArea,
  Illustration: AuthSplitIllustration,
});
