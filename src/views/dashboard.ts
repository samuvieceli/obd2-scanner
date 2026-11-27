// Live dashboard: value cards for the selected parameters + interpretation.
import { api } from "../api";
import { pidText, t } from "../i18n";
import { DEFAULT_KEYS, emit, isSupported, on, setLiveKeys, state } from "../store";
import { busy, button, clear, errorText, fmtValue, h, notConnected, pidTip, toast, unitOf } from "../ui";
import type { Category } from "../api";
import { findingList } from "./findings";

const CATEGORY_ORDER: Category[] = ["engine", "fuel", "air", "temperature", "emissions", "electrical", "vehicle"];

export async function startPolling(on_: boolean) {
  await api.setLive(state.liveKeys, on_);
  state.polling = on_;
  emit("connection");
}

export async function toggleRecording() {
  state.recording = state.recording.recording ? await api.stopRecording() : await api.startRecording();
  emit("recording");
}

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  if (state.connection !== "connected") {
    page.append(h("h1", null, t("dashboard.title")), notConnected());
    return;
  }

  const cards = new Map<string, { value: HTMLElement; range: HTMLElement; bar: HTMLElement }>();
  const grid = h("div", { class: "value-grid" });
  const findingsBox = h("div");
  const picker = h("div", { class: "picker", hidden: true });

  const pollBtn = button("", async () => {
    await busy(pollBtn, () => startPolling(!state.polling));
    renderToolbar();
  }, "primary");
  const recBtn = button("", async () => {
    await busy(recBtn, toggleRecording);
    renderToolbar();
  }, "secondary");
  const chooseBtn = button(t("dashboard.choose"), () => {
    picker.hidden = !picker.hidden;
    if (!picker.hidden) renderPicker();
  }, "ghost");

  const renderToolbar = () => {
    pollBtn.textContent = state.polling ? t("dashboard.stopReading") : t("dashboard.startReading");
    pollBtn.className = `btn ${state.polling ? "btn-secondary" : "btn-primary"}`;
    recBtn.textContent = state.recording.recording ? t("dashboard.stopRecord") : t("dashboard.record");
    recBtn.className = `btn ${state.recording.recording ? "btn-danger" : "btn-secondary"}`;
  };

  const renderPicker = () => {
    clear(picker);
    const apply = async (keys: string[]) => {
      setLiveKeys(keys);
      try {
        await api.setLive(keys, state.polling);
      } catch (e) {
        toast(errorText(e), "error");
      }
      renderPicker();
      renderCards();
    };
    picker.append(
      h(
        "div",
        { class: "row" },
        h("p", { class: "muted small grow" }, t("dashboard.chooseHelp")),
        button(t("dashboard.selectDefault"), () => apply(DEFAULT_KEYS.filter(isSupported)), "ghost"),
        button(t("dashboard.selectAll"), () => apply(state.catalog.map((m) => m.key).filter(isSupported)), "ghost"),
        button(t("dashboard.selectNone"), () => apply([]), "ghost"),
      ),
    );
    for (const cat of CATEGORY_ORDER) {
      const items = state.catalog.filter((m) => m.category === cat);
      if (!items.length) continue;
      picker.append(
        h(
          "fieldset",
          null,
          h("legend", null, t(`categories.${cat}`)),
          items.map((m) => {
            const supported = isSupported(m.key);
            return h(
              "label",
              { class: `check ${supported ? "" : "disabled"}`, title: supported ? pidText(m.key).desc : t("dashboard.notSupported") },
              h("input", {
                type: "checkbox",
                disabled: !supported,
                checked: state.liveKeys.includes(m.key),
                onchange: (e: Event) => {
                  const checked = (e.target as HTMLInputElement).checked;
                  const keys = checked ? [...state.liveKeys, m.key] : state.liveKeys.filter((k) => k !== m.key);
                  apply(keys);
                },
              }),
              h("span", null, pidText(m.key).name),
            );
          }),
        ),
      );
    }
  };

  const renderCards = () => {
    clear(grid);
    cards.clear();
    const keys = state.liveKeys.filter(isSupported);
    if (!keys.length) {
      grid.append(h("p", { class: "muted" }, t("dashboard.empty")));
      return;
    }
    for (const key of keys) {
      const txt = pidText(key);
      const value = h("span", { class: "value" });
      const range = h("span", { class: "range" });
      const bar = h("span", { class: "bar-fill" });
      grid.append(
        h(
          "article",
          { class: "value-card", "aria-label": txt.name },
          h("header", null, h("span", { class: "name", title: txt.name }, txt.short), pidTip(key)),
          h("div", { class: "value-line" }, value, h("span", { class: "unit" }, unitOf(key))),
          h("div", { class: "bar" }, bar),
          range,
        ),
      );
      cards.set(key, { value, range, bar });
    }
    updateValues();
  };

  const updateValues = () => {
    for (const [key, c] of cards) {
      const v = state.latest[key];
      c.value.textContent = fmtValue(key, v);
      const mm = state.minmax[key];
      c.range.textContent = mm ? `${t("dashboard.min")} ${fmtValue(key, mm[0])} · ${t("dashboard.max")} ${fmtValue(key, mm[1])}` : "";
      const m = state.catalog.find((x) => x.key === key);
      const lo = m?.min ?? 0;
      const hi = m?.max ?? (key === "battery_voltage" ? 16 : 100);
      const pct = v === undefined ? 0 : Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
      c.bar.style.width = `${pct}%`;
    }
  };

  const renderFindings = () => {
    clear(findingsBox);
    findingsBox.append(findingList(state.findings));
  };

  // First visit after connecting: keep only what this car supports.
  if (state.adapter && state.liveKeys.every((k) => !isSupported(k) || k === "battery_voltage")) {
    setLiveKeys(DEFAULT_KEYS.filter(isSupported));
  }

  renderToolbar();
  page.append(
    h("div", { class: "page-head" }, h("h1", null, t("dashboard.title")), h("div", { class: "toolbar" }, chooseBtn, recBtn, pollBtn)),
    picker,
    h(
      "div",
      { class: "dash-layout" },
      grid,
      h(
        "aside",
        { class: "card findings-card" },
        h("h2", null, t("dashboard.findings")),
        findingsBox,
        h("p", { class: "muted small" }, t("dashboard.findingsDisclaimer")),
      ),
    ),
  );
  renderCards();
  renderFindings();

  let raf = 0;
  const offs = [
    on("frame", () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), updateValues()));
    }),
    on("findings", renderFindings),
    on("live-keys", renderCards),
    on("recording", renderToolbar),
    on("connection", renderToolbar),
  ];
  return () => {
    offs.forEach((f) => f());
    cancelAnimationFrame(raf);
  };
}
