"use client";
// TEMPORARY stub — see package.json description.
// This is the only file in the stub that truly needs "use client": it's the
// one imported directly from a Server Component (app/layout.tsx) and owns
// theme state (localStorage + system preference), so it must run on the
// client. Everything else in this stub is plain presentational markup and
// lives in index.js instead.

const React = require("react");
const { createContext, useContext, useEffect, useState, useCallback } = React;

const ThemeContext = createContext({ theme: "system", setTheme: () => {} });

function getSystemTheme() {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function ThemeProvider(props) {
  const { attribute, defaultTheme, enableSystem, children } = props;
  const [theme, setThemeState] = useState(defaultTheme || "system");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("norr-ui-theme");
      if (stored) setThemeState(stored);
    } catch (e) {
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

  const setTheme = useCallback((next) => {
    setThemeState(next);
    try {
      window.localStorage.setItem("norr-ui-theme", next);
    } catch (e) {
      // ignore
    }
  }, []);

  return React.createElement(ThemeContext.Provider, { value: { theme, setTheme } }, children);
}

function useTheme() {
  return useContext(ThemeContext);
}

module.exports = { ThemeProvider, useTheme };
