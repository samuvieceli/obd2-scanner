export type Theme = "dark" | "light" | "system";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem("theme");
    if (v === "dark" || v === "light" || v === "system") return v;
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
