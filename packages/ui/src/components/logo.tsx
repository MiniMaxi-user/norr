import type { ReactNode } from "react";

export interface LogoProps {
  /** Defaults to "Norr" (this app's product name) — overridable so this
   * primitive stays reusable rather than hardcoding one tenant's brand. */
  children?: ReactNode;
}

export function Logo({ children }: LogoProps) {
  return (
    <span className="ui-logo">
      <span className="ui-logo-mark" aria-hidden />
      <span className="ui-logo-text">{children ?? "Norr"}</span>
    </span>
  );
}
