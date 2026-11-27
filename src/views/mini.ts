// Mini window: the program shrinks to a small box that stays above other
// windows (maps, music, a video call), showing the HUD's 3–4 values. "Back"
// returns the window to its previous size and place.
//
// The window size and position are saved before shrinking. In a browser
// (development) the window calls fail and only the compact layout is shown.
import { getCurrentWindow, LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { pidText, t } from "../i18n";
import { on, state } from "../store";
import { clear, fmtValue, h, unitOf, warmBadge } from "../ui";
import { startPolling } from "./dashboard";
import { initialKeys } from "./hud";

const MINI_W = 360;
const ROW_H = 64;
const NORMAL_MIN = new LogicalSize(960, 620);

let root: HTMLElement | null = null;
let offs: (() => void)[] = [];
let saved: { size: PhysicalSize; pos: PhysicalPosition; maximized: boolean } | null = null;

const win = () => {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
};

export function inMini(): boolean {
  return !!root;
}

async function shrink(rows: number) {
  const w = win();
  if (!w) return;
  try {
    saved = { size: await w.outerSize(), pos: await w.outerPosition(), maximized: await w.isMaximized() };
    if (saved.maximized) await w.unmaximize();
    await w.setMinSize(null);
    await w.setSize(new LogicalSize(MINI_W, 56 + rows * ROW_H));
    await w.setAlwaysOnTop(true);
  } catch {
    /* not running inside the app window */
  }
}

async function restore() {
  const w = win();
  if (!w) return;
  try {
    await w.setAlwaysOnTop(false);
    await w.setMinSize(NORMAL_MIN);
    if (saved) {
      await w.setSize(saved.size);
      await w.setPosition(saved.pos);
      if (saved.maximized) await w.maximize();
    }
  } catch {
    /* not running inside the app window */
  }
  saved = null;
}

export async function exitMini() {
  if (!root) return;
  offs.forEach((f) => f());
  offs = [];
  root.remove();
  root = null;
  document.body.classList.remove("mini-mode");
  await restore();
}

export async function enterMini() {
  if (root) return;
  const keys = initialKeys();
  const cells = new Map<string, HTMLElement>();
  const warm = h("span", { class: "warm-badge", hidden: true });
  const list = h("div", { class: "mini-values" });
  const render = () => {
    clear(list);
    cells.clear();
    if (!keys.length) list.append(h("p", { class: "muted small" }, t("hud.pick")));
    for (const k of keys) {
      const v = h("span", { class: "mini-value" });
      cells.set(k, v);
      list.append(h("div", { class: "mini-row" }, h("span", { class: "mini-label" }, pidText(k).short), v, h("span", { class: "mini-unit" }, unitOf(k))));
    }
    update();
  };
  const update = () => {
    for (const [k, el] of cells) el.textContent = fmtValue(k, state.latest[k]);
    warmBadge(warm, state);
  };
  root = h(
    "div",
    { class: "mini", role: "region", "aria-label": t("mini.title") },
    // The top strip moves the window (it has no title bar of its own here).
    h(
      "div",
      { class: "mini-bar", "data-tauri-drag-region": "" },
      h("span", { class: "mini-dot", "data-tauri-drag-region": "", title: t("mini.drag") }, "⠿"),
      warm,
      h("button", { type: "button", class: "btn btn-ghost mini-back", title: t("mini.backHelp"), onclick: () => void exitMini() }, t("mini.back")),
    ),
    list,
  );
  document.body.classList.add("mini-mode");
  document.body.append(root);
  render();
  let raf = 0;
  offs = [
    on("frame", () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), update()));
    }),
    () => cancelAnimationFrame(raf),
  ];
  // The box is only useful with values coming in.
  if (!state.polling && !state.playback && state.connection === "connected") await startPolling(true).catch(() => undefined);
  await shrink(Math.max(1, keys.length));
}

export function initMini() {
  document.addEventListener("keydown", (e) => {
    if (root && e.key === "Escape") void exitMini();
  });
}
