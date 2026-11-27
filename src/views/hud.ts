// Head-up display: a few huge values on a black screen, for reading while
// driving. "Mirror" flips the image so it reads correctly when the phone or
// tablet lies on the dashboard and reflects on the windshield.
import { pidText, t } from "../i18n";
import { isSupported, on, state } from "../store";
import { button, clear, fmtValue, h, notConnected, toast, errorText, unitOf } from "../ui";
import { startPolling } from "./dashboard";

const MAX = 4;
const PREFERRED = ["speed", "rpm", "coolant_temp", "battery_voltage"];

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: setting just isn't remembered */
  }
}

function available(): string[] {
  return state.liveKeys.filter(isSupported);
}

function initialKeys(): string[] {
  const avail = available();
  let saved: string[] = [];
  try {
    saved = JSON.parse(load("hudKeys") ?? "[]") as string[];
  } catch {
    saved = [];
  }
  const keep = saved.filter((k) => avail.includes(k));
  if (keep.length) return keep.slice(0, MAX);
  const pref = PREFERRED.filter((k) => avail.includes(k));
  return (pref.length ? pref : avail).slice(0, MAX);
}

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  if (state.connection !== "connected") {
    page.append(h("h1", null, t("hud.title")), notConnected());
    return;
  }

  let keys = initialKeys();
  let mirror = load("hudMirror") === "1";
  const screen = h("div", { class: "hud-screen", tabindex: "0", "aria-live": "off" });
  const chips = h("div", { class: "chips" });
  const cells = new Map<string, HTMLElement>();

  const pollBtn = button("", async () => {
    try {
      await startPolling(!state.polling);
    } catch (e) {
      toast(errorText(e), "error");
    }
    renderToolbar();
  }, "primary");
  const mirrorBtn = button("", () => {
    mirror = !mirror;
    save("hudMirror", mirror ? "1" : "0");
    renderToolbar();
    applyMirror();
  }, "secondary");
  const fullBtn = button(t("hud.fullscreen"), async () => {
    try {
      await screen.requestFullscreen();
    } catch {
      toast(t("hud.fullscreenFailed"), "info");
    }
    screen.focus();
  }, "secondary");

  const renderToolbar = () => {
    pollBtn.textContent = state.polling ? t("dashboard.stopReading") : t("dashboard.startReading");
    pollBtn.className = `btn ${state.polling ? "btn-secondary" : "btn-primary"}`;
    mirrorBtn.textContent = mirror ? t("hud.mirrorOn") : t("hud.mirrorOff");
    mirrorBtn.setAttribute("aria-pressed", String(mirror));
  };

  const applyMirror = () => screen.classList.toggle("mirror", mirror);

  const renderChips = () => {
    clear(chips);
    const avail = available();
    if (!avail.length) {
      chips.append(h("p", { class: "muted small" }, t("hud.noKeys")));
      return;
    }
    for (const k of avail) {
      const on_ = keys.includes(k);
      chips.append(
        h(
          "button",
          {
            type: "button",
            class: `chip ${on_ ? "on" : ""}`,
            "aria-pressed": String(on_),
            title: pidText(k).name,
            onclick: () => {
              if (on_) keys = keys.filter((x) => x !== k);
              else if (keys.length >= MAX) {
                toast(t("hud.max", { n: MAX }), "info");
                return;
              } else keys = [...keys, k];
              save("hudKeys", JSON.stringify(keys));
              renderChips();
              renderScreen();
            },
          },
          pidText(k).short,
        ),
      );
    }
  };

  const renderScreen = () => {
    clear(screen);
    cells.clear();
    screen.dataset.count = String(keys.length);
    if (!keys.length) {
      screen.append(h("p", { class: "hud-empty" }, t("hud.pick")));
      return;
    }
    for (const k of keys) {
      const value = h("span", { class: "hud-value" });
      screen.append(
        h(
          "div",
          { class: "hud-cell" },
          value,
          h("span", { class: "hud-label" }, `${pidText(k).short} · ${unitOf(k)}`),
        ),
      );
      cells.set(k, value);
    }
    update();
  };

  const update = () => {
    for (const [k, el] of cells) el.textContent = fmtValue(k, state.latest[k]);
  };

  renderToolbar();
  page.append(
    h(
      "div",
      { class: "page-head" },
      h("h1", null, t("hud.title")),
      h("div", { class: "toolbar" }, mirrorBtn, fullBtn, pollBtn),
    ),
    h("p", { class: "muted small" }, t("hud.help")),
    chips,
    screen,
  );
  renderChips();
  renderScreen();
  applyMirror();

  let raf = 0;
  const offs = [
    on("frame", () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), update()));
    }),
    on("live-keys", () => {
      keys = keys.filter((k) => available().includes(k));
      renderChips();
      renderScreen();
    }),
    on("connection", renderToolbar),
  ];
  return () => {
    offs.forEach((f) => f());
    cancelAnimationFrame(raf);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  };
}
