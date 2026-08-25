"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Theme preference. "system" follows the OS setting and keeps following it —
 * it is not resolved once at load, so a machine that flips to dark at sunset
 * flips the app with it.
 */
export type ThemePreference = "light" | "dark" | "system";

/** The theme actually painted: what "system" resolves to right now. */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "postsider:theme";

export const THEME_PREFERENCES: ThemePreference[] = ["light", "dark", "system"];

function isPreference(v: unknown): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

/**
 * Runs before first paint, inlined into <head> by the root layout.
 *
 * The stylesheet keys off an explicit data-theme on <html>, so without this
 * the first frame is always light and a dark-mode user gets a white flash on
 * every navigation that reloads the document. Kept dependency-free and
 * self-contained because it is stringified into the HTML — it cannot import
 * anything, and anything it throws would block hydration, hence the catch.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
var t=(s==='light'||s==='dark')?s:(m?'dark':'light');
document.documentElement.setAttribute('data-theme',t);
}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function storedPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isPreference(raw)) return raw;
  } catch {}
  return "system";
}

interface ThemeState {
  /** What the user picked, including "system". */
  preference: ThemePreference;
  /** What is on screen: "system" already resolved. */
  theme: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
  /** Light ⇄ dark, collapsing "system" to the opposite of what is showing. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Server render and first client render must agree, so both start at the
  // defaults; the inline script has already painted the right theme, and the
  // mount effect below re-syncs React's copy of it.
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [systemPref, setSystemPref] = useState<ResolvedTheme>("light");
  // Until this flips, React's idea of the theme is still the placeholder from
  // the first render. Writing that to <html> would overwrite what the inline
  // script correctly painted and flash the page light for a frame — for a
  // "system" user on a dark machine, until the state below settles.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setPreferenceState(storedPreference());
    setSystemPref(systemTheme());
    setReady(true);
  }, []);

  // Follow the OS while the preference is "system".
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemPref(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const theme: ResolvedTheme =
    preference === "system" ? systemPref : preference;

  useEffect(() => {
    if (!ready) return;
    document.documentElement.setAttribute("data-theme", theme);
  }, [ready, theme]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setPreference(theme === "dark" ? "light" : "dark");
  }, [theme, setPreference]);

  const value = useMemo<ThemeState>(
    () => ({ preference, theme, setPreference, toggle }),
    [preference, theme, setPreference, toggle],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within <ThemeProvider>");
  }
  return ctx;
}
