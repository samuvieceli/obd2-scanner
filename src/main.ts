// Entry point: builds the window layout, the menu and wires backend events.
import "uplot/dist/uPlot.min.css";
import "./styles.css";

import { api, events, isTauri } from "./api";
import { getLang, LANGS, onLangChange, t, type Lang } from "./i18n";
import { emit, on, pushFrame, pushLog, setChartKeys, state } from "./store";
import { clear, h, installTooltips, toast, errorText } from "./ui";
import { applyTheme, getTheme, type Theme } from "./theme";
import { prefs, setActiveProfile } from "./prefs";
import { changeLanguage } from "./units";
import { initAlerts } from "./alerts";
import { initTrip } from "./trip";
import { initDriveSummary } from "./views/drive-summary";
import { initSearch, openSearch } from "./views/search";
import { initMini } from "./views/mini";
import { initKeepAwake } from "./awake";
import { initSafety } from "./views/safety";
import { SPEEDS, seek, setSpeed, stopPlayback, togglePlay } from "./playback";
import { fmtNum } from "./i18n";
import { loadMaker } from "./maker";

import * as connection from "./views/connection";
import * as dashboard from "./views/dashboard";
import { markEvent } from "./views/dashboard";
import * as charts from "./views/charts";
import * as journey from "./views/journey";
import { initJourney } from "./journey-live";
import * as hud from "./views/hud";
import * as performance from "./views/performance";
import * as guided from "./views/guided";
import * as prepurchase from "./views/prepurchase";
import { initTrimCollector } from "./views/guided";
import * as diagnostics from "./views/diagnostics";
import * as vehicle from "./views/vehicle";
import * as terminal from "./views/terminal";
import * as sessions from "./views/sessions";
import * as glossary from "./views/glossary";
import * as docs from "./views/docs";
import * as settings from "./views/settings";

type View = { mount: (root: HTMLElement) => (() => void) | void };

const ROUTES: { id: string; icon: string; view: View }[] = [
  { id: "connection", icon: "M4 12h4l2-3 4 6 2-3h4", view: connection },
  { id: "dashboard", icon: "M4 14a8 8 0 1 1 16 0M12 14l4-4", view: dashboard },
  { id: "hud", icon: "M3 7h18v8H3zM8 19h8M7 11h2M11 11h6", view: hud },
  { id: "journey", icon: "M7 21l3-18M17 21l-3-18M12 6v2M12 11v2M12 16v3", view: journey },
  { id: "performance", icon: "M9 2h6M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 9v4l3 2", view: performance },
  { id: "guided", icon: "M9 11l3 3 8-8M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11", view: guided },
  { id: "prepurchase", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5M8 11l2 2 4-4", view: prepurchase },
  { id: "charts", icon: "M4 19V5M4 19h16M7 15l3-4 3 2 5-6", view: charts },
  { id: "diagnostics", icon: "M12 3l9 16H3zM12 10v4M12 17v.01", view: diagnostics },
  { id: "vehicle", icon: "M5 16l1.5-5h11L19 16M5 16h14v3H5zM7.5 19v1M16.5 19v1", view: vehicle },
  { id: "terminal", icon: "M4 5h16v14H4zM7 9l3 3-3 3M12 15h5", view: terminal },
  { id: "sessions", icon: "M6 3h9l4 4v14H6zM9 12h7M9 16h7", view: sessions },
  { id: "glossary", icon: "M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM9 8h6", view: glossary },
  { id: "docs", icon: "M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2zM13 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5M7 8h2M7 12h2M16 8h2M16 12h2", view: docs },
  { id: "settings", icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2", view: settings },
];

function icon(d: string): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

const app = document.getElementById("app")!;
const content = h("main", { class: "content", id: "content" });
const nav = h("nav", { class: "nav" });
const statusEl = h("div", { class: "status" });
const dayNightEl = h("div", { class: "seg daynight", role: "group" });
const playerEl = h("div", { class: "player", hidden: true });
const linkEl = h("div", { class: "link-banner", hidden: true, role: "status" });
let cleanup: (() => void) | void;

function currentRoute(): string {
  const id = location.hash.replace(/^#\//, "");
  return ROUTES.some((r) => r.id === id) ? id : "connection";
}

function renderNav() {
  clear(nav);
  const active = currentRoute();
  for (const r of ROUTES) {
    nav.append(
      h(
        "a",
        { href: `#/${r.id}`, class: r.id === active ? "active" : "", "aria-current": r.id === active ? "page" : false },
        icon(r.icon),
        h("span", null, t(`nav.${r.id}`)),
      ),
    );
  }
}

function renderStatus() {
  clear(statusEl);
  let label = t("status.disconnected");
  let cls = "off";
  if (state.playback) {
    label = t("playback.status");
    cls = "on";
  } else if (state.link) {
    label = t(state.link.state === "reconnecting" ? "status.reconnecting" : "status.recovering");
    cls = "wait";
  } else if (state.connection === "connecting") {
    label = t("status.connecting");
    cls = "wait";
  } else if (state.connection === "connected") {
    if (state.vehicleError) {
      label = t("status.adapterOnly");
      cls = "warn";
    } else {
      label = state.polling ? t("status.polling") : t("status.connected");
      cls = "on";
    }
  }
  statusEl.append(h("span", { class: `pill pill-${cls}` }, h("span", { class: "dot" }), label));
  if (state.connection === "connected" && state.adapter) {
    statusEl.append(h("span", { class: "muted small" }, state.adapter.transport));
  }
  if (state.polling && state.rateHz > 0) {
    statusEl.append(h("span", { class: "muted small" }, t("status.rate", { rate: state.rateHz })));
  }
  if (state.recording.recording) {
    statusEl.append(h("span", { class: "pill pill-rec" }, h("span", { class: "dot" }), t("status.recording")));
  }
}

/**
 * Quick day/night switch: high contrast for strong sun, deep red for night
 * driving. Pressing the active one again goes back to the theme chosen in
 * Settings.
 */
function renderDayNight() {
  clear(dayNightEl);
  dayNightEl.setAttribute("aria-label", t("daynight.label"));
  const current = getTheme();
  const pick = (target: Theme) => {
    let next = target;
    if (current === target) {
      try {
        next = (localStorage.getItem("themeBeforeQuick") as Theme | null) ?? "dark";
      } catch {
        next = "dark";
      }
    } else if (current !== "contrast" && current !== "night") {
      try {
        localStorage.setItem("themeBeforeQuick", current);
      } catch {
        /* not remembered */
      }
    }
    applyTheme(next);
  };
  for (const [target, icon] of [
    ["contrast", "☀"],
    ["night", "☾"],
  ] as const) {
    dayNightEl.append(
      h(
        "button",
        { type: "button", "aria-pressed": String(current === target), title: t(`daynight.${target}`), onclick: () => pick(target) },
        h("span", { "aria-hidden": "true" }, icon),
        h("span", { class: "daynight-text" }, t(`daynight.${target}Short`)),
      ),
    );
  }
}

/** Banner shown while a frozen adapter is reset or a lost link is reopened. */
function renderLink() {
  const l = state.link;
  linkEl.hidden = !l;
  clear(linkEl);
  if (!l) return;
  const text =
    l.state === "reconnecting"
      ? t("link.reconnectingBanner", { attempt: l.attempt, s: l.nextInS })
      : t("link.recoveringBanner");
  linkEl.append(
    h("span", { class: "spinner", "aria-hidden": "true" }),
    h("div", { class: "grow" }, h("strong", null, text), h("p", { class: "small muted" }, t(`link.${l.state}Help`))),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-ghost btn-sm",
        onclick: async () => {
          await api.disconnect().catch(() => undefined);
          state.link = null;
          state.connection = "disconnected";
          state.adapter = null;
          state.polling = false;
          emit("link");
          emit("connection");
        },
      },
      t("link.stop"),
    ),
  );
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

let slider: HTMLInputElement | null = null;
let posLabel: HTMLElement | null = null;
let playBtn: HTMLButtonElement | null = null;
let dragging = false;

/** Bar with play/pause, speed and position while a recording is replayed. */
function renderPlayer() {
  const p = state.playback;
  playerEl.hidden = !p;
  if (!p) {
    clear(playerEl);
    slider = posLabel = playBtn = null;
    return;
  }
  if (!slider) {
    clear(playerEl);
    playBtn = h("button", { type: "button", class: "btn btn-primary btn-sm", onclick: () => togglePlay() });
    slider = h("input", {
      type: "range",
      min: "0",
      step: "100",
      class: "grow",
      "aria-label": t("playback.position"),
      oninput: () => (dragging = true),
      onchange: (e: Event) => {
        dragging = false;
        seek(Number((e.target as HTMLInputElement).value));
      },
    });
    posLabel = h("span", { class: "muted small mono" });
    const speedSel = h(
      "select",
      { "aria-label": t("playback.speed"), onchange: (e: Event) => setSpeed(Number((e.target as HTMLSelectElement).value)) },
      SPEEDS.map((v) => h("option", { value: String(v), selected: v === p.speed }, `${fmtNum(v, v < 1 ? 1 : 0)}×`)),
    );
    playerEl.append(
      h("span", { class: "player-name", title: p.name }, t("playback.title", { name: p.name })),
      playBtn,
      slider,
      posLabel,
      speedSel,
      p.session.marks?.length
        ? h(
            "button",
            {
              type: "button",
              class: "btn btn-ghost btn-sm",
              title: t("marks.nextHelp"),
              onclick: () => {
                const cur = state.playback;
                if (!cur) return;
                const marks = [...(cur.session.marks ?? [])].sort((a, b) => a - b);
                // A few seconds before the mark, to see what led to it.
                const next = marks.find((m) => m - 5000 > cur.posMs + 500) ?? marks[0];
                seek(next - 5000);
              },
            },
            t("marks.next", { n: p.session.marks.length }),
          )
        : "",
      h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => stopPlayback() }, t("playback.close")),
    );
  }
  slider.max = String(p.durationMs);
  if (!dragging) slider.value = String(p.posMs);
  posLabel!.textContent = `${clock(p.posMs)} / ${clock(p.durationMs)}`;
  playBtn!.textContent = p.playing ? t("playback.pause") : t("playback.play");
}

function renderView() {
  if (cleanup) cleanup();
  clear(content);
  renderNav();
  const route = ROUTES.find((r) => r.id === currentRoute())!;
  cleanup = route.view.mount(content);
  content.focus({ preventScroll: true });
}

function layout() {
  // Rebuilt on a language or profile change: stay where the user was.
  const scroll = content.scrollTop;
  clear(app);
  const p = prefs();
  const profileSelect = h(
    "select",
    {
      class: "lang-select",
      "aria-label": t("profiles.active"),
      title: t("profiles.active"),
      onchange: (e: Event) => setActiveProfile((e.target as HTMLSelectElement).value),
    },
    p.profiles.map((x) => h("option", { value: x.id, selected: x.id === p.activeProfile }, x.name)),
  );
  const langSelect = h(
    "select",
    {
      class: "lang-select",
      "aria-label": t("settings.language"),
      title: t("settings.languageHelp"),
      onchange: (e: Event) => changeLanguage((e.target as HTMLSelectElement).value as Lang),
    },
    LANGS.map((l) => h("option", { value: l.id, selected: l.id === getLang(), title: l.label }, l.short)),
  );
  app.append(
    h(
      "aside",
      { class: "sidebar" },
      h(
        "div",
        { class: "brand" },
        h("img", { src: "/icon.png", alt: "" }),
        h("div", null, h("strong", null, t("app.name")), h("span", null, t("app.tagline"))),
      ),
      nav,
      h("div", { class: "sidebar-foot" }, profileSelect, langSelect, h("span", { class: "muted small" }, state.appVersion ? `v${state.appVersion}${state.portableData ? ` · ${t("settings.portableShort")}` : ""}` : "")),
    ),
    h(
      "div",
      { class: "main" },
      h(
        "header",
        { class: "topbar" },
        statusEl,
        h(
          "button",
          { type: "button", class: "btn btn-ghost search-btn", title: t("search.button"), onclick: () => openSearch() },
          icon("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.5-4.5"),
          h("span", null, t("search.short")),
          h("kbd", null, "Ctrl+F"),
        ),
        dayNightEl,
      ),
      linkEl,
      playerEl,
      content,
    ),
  );
  content.tabIndex = -1;
  slider = null;
  renderPlayer();
  renderStatus();
  renderDayNight();
  renderLink();
  renderView();
  content.scrollTop = scroll;
}

async function boot() {
  document.documentElement.lang = getLang();
  applyTheme();
  installTooltips();
  if (!isTauri()) {
    app.append(h("div", { class: "empty" }, h("p", null, t("errors.noTauri"))));
    return;
  }
  try {
    state.catalog = await api.pidCatalog();
    await loadMaker();
    const info = await api.appInfo();
    state.appVersion = info.version;
    state.portableData = info.portableData;
    // A recording interrupted last time (program closed or crashed while
    // recording) comes back as the last recording, ready to export.
    state.recoveredFrames = await api.recoveredRecording().catch(() => null);
    if (state.recoveredFrames) {
      state.recording = await api.recordingStatus();
      toast(t("sessions.recovered", { frames: state.recoveredFrames }), "info");
    }
  } catch (e) {
    toast(errorText(e), "error");
  }
  await events.liveFrame((f) => {
    if (state.playback) return;
    pushFrame(f);
    if (f.dropped.length) {
      const names = f.dropped.join(", ");
      state.liveKeys = state.liveKeys.filter((k) => !f.dropped.includes(k));
      if (state.chartKeys) setChartKeys(state.chartKeys.filter((k) => !f.dropped.includes(k)));
      emit("live-keys");
      toast(t("dashboard.dropped", { names }), "info");
    }
  });
  await events.findings((list) => {
    if (state.playback) return;
    state.findings = list;
    emit("findings");
  });
  await events.log(pushLog);
  await events.linkStatus((s) => {
    if (s.state === "recovered" || s.state === "reconnected") {
      state.link = null;
      if (s.adapter) state.adapter = s.adapter;
      if (s.state === "reconnected") state.vehicleError = s.error;
      toast(t(`link.${s.state}`), "ok");
    } else if (s.state === "vehicle_silent") {
      state.link = null;
      toast(t("link.vehicle_silent"), "info");
    } else {
      state.link = s;
    }
    emit("link");
    emit("connection");
  });
  await events.connectionLost((e) => {
    state.connection = "disconnected";
    state.polling = false;
    state.adapter = null;
    state.link = null;
    emit("link");
    emit("connection");
    toast(`${errorText(e)} ${t("link.lostHelp")}`, "error");
  });

  initTrip();
  initDriveSummary();
  void initJourney();
  initSearch(ROUTES.map((r) => r.id));
  initMini();
  initTrimCollector();
  initAlerts();
  initKeepAwake();
  on("connection", renderStatus);
  on("link", renderLink);
  // Another car: screens show its settings, alerts and results.
  on("profile", layout);
  let wasPlaying = false;
  on("playback", () => {
    renderPlayer();
    // Entering or leaving playback changes what every screen can show.
    if (wasPlaying !== !!state.playback) {
      wasPlaying = !!state.playback;
      renderStatus();
      renderView();
    }
  });
  on("recording", renderStatus);
  let lastRate = 0;
  on("frame", () => {
    if (Math.abs(lastRate - state.rateHz) >= 0.5) {
      lastRate = state.rateHz;
      renderStatus();
    }
  });
  window.addEventListener("themechange", renderDayNight);
  // Space marks an event while recording (not while typing or on a button).
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat || !state.recording.recording) return;
    const el = e.target as HTMLElement | null;
    if (el && el.closest("input, textarea, select, button, [contenteditable]")) return;
    e.preventDefault();
    void markEvent();
  });
  onLangChange(() => {
    layout();
    void diagnostics.relocalizeDtcs();
  });
  window.addEventListener("hashchange", renderView);
  layout();
  // Safety notice on top of everything until the user confirms it.
  initSafety();
}

boot();
