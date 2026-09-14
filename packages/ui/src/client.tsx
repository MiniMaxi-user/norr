"use client";
// The only file in this package that truly needs "use client": it's the one
// imported directly from a Server Component (app/layout.tsx) and owns theme
// state (localStorage + system preference), so it must run on the client.
// See tsup.config.ts's top comment for why this lives in its own physical
// entry file rather than inline in index.ts.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ThemeName = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "norr-ui-theme";

export interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
});

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export interface ThemeProviderProps {
  /** Attribute written to `<html>` to reflect the resolved theme — `"class"`
   * (default pattern used by this app) toggles `.light`/`.dark` classes;
   * anything else is used as a `data-*` attribute name. */
  attribute?: "class" | (string & {});
  defaultTheme?: ThemeName;
  enableSystem?: boolean;
  children?: ReactNode;
}

export function ThemeProvider({ attribute, defaultTheme, enableSystem, children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeName>(defaultTheme ?? "system");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeName | null;
      if (stored) setThemeState(stored);
    } catch {
      // localStorage unavailable (SSR/private mode) — fall back to default.
    }
  }, []);

  useEffect(() => {
    const resolved = theme === "system" ? getSystemTheme() : theme;
    const root = document.documentElement;
    if (attribute === "class") {
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
    } else {
      root.setAttribute(attribute || "data-theme", resolved);
    }
  }, [theme, attribute]);

  useEffect(() => {
    if (!enableSystem || theme !== "system" || typeof window.matchMedia !== "function") return undefined;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setThemeState("system"); // triggers the effect above to re-resolve
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme, enableSystem]);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Builds the inline script body for `ThemeScript` below — a plain string,
 * not JSX, so it can be unit-reasoned-about/tested independent of React.
 * Mirrors `ThemeProvider`'s OWN resolution logic exactly (stored
 * `localStorage` value, else `defaultTheme`, resolved through
 * `prefers-color-scheme` when the result is `"system"` — unconditionally,
 * same as that provider's own resolution effect, which doesn't gate this
 * step on `enableSystem` either; that prop only controls whether to keep
 * *reacting* to live OS theme-change events afterwards). Keep the two in
 * sync if either one changes. */
function themeInitScript(defaultTheme: ThemeName, attribute: string): string {
  const applyClass =
    attribute === "class"
      ? 'e.classList.remove("light","dark");e.classList.add(r);'
      : `e.setAttribute(${JSON.stringify(attribute)},r);`;
  return `(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var t=s||${JSON.stringify(defaultTheme)};var r=t==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;var e=document.documentElement;${applyClass}}catch(err){}})();`;
}

export interface ThemeScriptProps {
  /** Must match the `ThemeProvider` this page also renders — see that
   * component's own `attribute` doc comment. */
  attribute?: "class" | (string & {});
  /** Must match the `ThemeProvider` this page also renders. */
  defaultTheme?: ThemeName;
}

/**
 * A blocking inline `<script>`, rendered as the FIRST thing in `<head>` —
 * sets the resolved theme class/attribute on `<html>` synchronously as the
 * browser parses the document, before any stylesheet or this app's own JS
 * bundle loads. `ThemeProvider`'s own theme-resolution effect only runs
 * after React hydrates, which is fine for an in-app SPA transition (the same
 * `<html>` node persists, already correctly classed, across those) but
 * leaves every GENUINE full document load — a fresh visit, a hard refresh,
 * or (bug report, 2026-09-14) the PWA's own offline navigations, which the
 * service worker answers with a real new document — painting the browser's
 * default UA styling (`:root`'s light `--ui-bg: #fff`) for a visible beat
 * before that effect ever runs. A parser-blocking `<script>` (no `async`/
 * `defer`) is deliberate: the browser can't paint until it finishes anyway
 * (render is already gated on the render-blocking stylesheet `<link>`), so
 * this reliably wins the race without any extra signal/flag.
 *
 * Renders identically on the server and resolves to the SAME class on first
 * client paint by construction (it just reads the same storage key the
 * client will), so it doesn't need `suppressHydrationWarning` itself — only
 * `<html>` does, for the OTHER reason `ThemeProvider`'s own doc comment
 * gives (its class can still legitimately change a moment later, e.g. a
 * stale stored value from a theme that no longer resolves the same way).
 */
export function ThemeScript({ attribute = "class", defaultTheme = "system" }: ThemeScriptProps) {
  return <script dangerouslySetInnerHTML={{ __html: themeInitScript(defaultTheme, attribute) }} />;
}
