export const THEMES = ["system", "dark", "light", "night", "contrast", "amber", "terminal", "paper"] as const;
export type Theme = (typeof THEMES)[number];

/** Preview colors (background, surface, accent, text) for the theme picker. */
export const THEME_SWATCH: Record<Exclude<Theme, "system">, string[]> = {
  dark: ["#0b1220", "#111a2c", "#22d3ee", "#e6edf7"],
  light: ["#f3f6fb", "#ffffff", "#0891b2", "#0f1b2d"],
  night: ["#000000", "#1a0808", "#ff3b30", "#ff6b5e"],
  contrast: ["#000000", "#1c1c1c", "#ffff00", "#ffffff"],
  amber: ["#121110", "#26231f", "#f59e0b", "#f3ece2"],
  terminal: ["#020a04", "#082010", "#33ff66", "#b7f7c6"],
  paper: ["#f6f1e7", "#fffdf8", "#9a3412", "#2b2418"],
};

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem("theme");
    if (v && (THEMES as readonly string[]).includes(v)) return v as Theme;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function applyTheme(theme: Theme = getTheme()) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("themechange"));
}

/** Reads a CSS variable (colors for charts). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
