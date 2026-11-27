// Entry point: builds the window layout, the menu and wires backend events.
import "uplot/dist/uPlot.min.css";
import "./styles.css";

import { api, events, isTauri } from "./api";
import { getLang, onLangChange, setLang, t } from "./i18n";
import { emit, on, pushFrame, pushLog, state } from "./store";
import { clear, h, toast, errorText } from "./ui";
import { applyTheme } from "./theme";

import * as connection from "./views/connection";
import * as dashboard from "./views/dashboard";
import * as charts from "./views/charts";
import * as diagnostics from "./views/diagnostics";
import * as vehicle from "./views/vehicle";
import * as terminal from "./views/terminal";
import * as sessions from "./views/sessions";
import * as glossary from "./views/glossary";
import * as settings from "./views/settings";

type View = { mount: (root: HTMLElement) => (() => void) | void };

const ROUTES: { id: string; icon: string; view: View }[] = [
  { id: "connection", icon: "M4 12h4l2-3 4 6 2-3h4", view: connection },
  { id: "dashboard", icon: "M4 14a8 8 0 1 1 16 0M12 14l4-4", view: dashboard },
  { id: "charts", icon: "M4 19V5M4 19h16M7 15l3-4 3 2 5-6", view: charts },
  { id: "diagnostics", icon: "M12 3l9 16H3zM12 10v4M12 17v.01", view: diagnostics },
  { id: "vehicle", icon: "M5 16l1.5-5h11L19 16M5 16h14v3H5zM7.5 19v1M16.5 19v1", view: vehicle },
  { id: "terminal", icon: "M4 5h16v14H4zM7 9l3 3-3 3M12 15h5", view: terminal },
  { id: "sessions", icon: "M6 3h9l4 4v14H6zM9 12h7M9 16h7", view: sessions },
  { id: "glossary", icon: "M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM9 8h6", view: glossary },
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
  if (state.connection === "connecting") {
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

function renderView() {
  if (cleanup) cleanup();
  clear(content);
  renderNav();
  const route = ROUTES.find((r) => r.id === currentRoute())!;
  cleanup = route.view.mount(content);
  content.focus({ preventScroll: true });
}

function layout() {
  clear(app);
  const langSelect = h(
    "select",
    {
      class: "lang-select",
      "aria-label": t("settings.language"),
      onchange: (e: Event) => setLang((e.target as HTMLSelectElement).value as "pt-BR" | "en-US"),
    },
    h("option", { value: "pt-BR", selected: getLang() === "pt-BR" }, "PT-BR"),
    h("option", { value: "en-US", selected: getLang() === "en-US" }, "EN-US"),
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
      h("div", { class: "sidebar-foot" }, langSelect, h("span", { class: "muted small" }, state.appVersion ? `v${state.appVersion}` : "")),
    ),
    h("div", { class: "main" }, h("header", { class: "topbar" }, statusEl), content),
  );
  content.tabIndex = -1;
  renderStatus();
  renderView();
}

async function boot() {
  document.documentElement.lang = getLang();
  applyTheme();
  if (!isTauri()) {
    app.append(h("div", { class: "empty" }, h("p", null, t("errors.noTauri"))));
    return;
  }
  try {
    state.catalog = await api.pidCatalog();
    state.appVersion = (await api.appInfo()).version;
  } catch (e) {
    toast(errorText(e), "error");
  }
  await events.liveFrame((f) => {
    pushFrame(f);
    if (f.dropped.length) {
      const names = f.dropped.join(", ");
      state.liveKeys = state.liveKeys.filter((k) => !f.dropped.includes(k));
      emit("live-keys");
      toast(t("dashboard.dropped", { names }), "info");
    }
  });
  await events.findings((list) => {
    state.findings = list;
    emit("findings");
  });
  await events.log(pushLog);
  await events.connectionLost((e) => {
    state.connection = "disconnected";
    state.polling = false;
    state.adapter = null;
    emit("connection");
    toast(errorText(e), "error");
  });

  on("connection", renderStatus);
  on("recording", renderStatus);
  let lastRate = 0;
  on("frame", () => {
    if (Math.abs(lastRate - state.rateHz) >= 0.5) {
      lastRate = state.rateHz;
      renderStatus();
    }
  });
  onLangChange(layout);
  window.addEventListener("hashchange", renderView);
  layout();
}

boot();
