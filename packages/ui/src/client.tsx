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
      const stored = window.localStorage.getItem("norr-ui-theme") as ThemeName | null;
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
      window.localStorage.setItem("norr-ui-theme", next);
    } catch {
      // ignore
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
