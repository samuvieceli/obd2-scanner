// Charts: one synchronized time chart per parameter (uPlot, bundled locally).
import uPlot from "uplot";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { pidText, t } from "../i18n";
import { hasLiveSource, isSupported, on, readKeys, setChartKeys, state, type Series } from "../store";
import { CALC_KEYS, calcInputs, isCalc } from "../calc";
import { calcValues } from "../trip";
import { CHART_PRESETS, chartPresetKeys, matchChartPreset, type ChartPresetId } from "../presets";
import { normalize } from "../search";
import { cssVar } from "../theme";
import { button, clear, decimalsFor, displayValue, errorText, h, timestampForFile, toast, unitOf } from "../ui";
import { fmtNum } from "../i18n";
import { copyCard, drawCard } from "../share";

const PALETTE = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"];
const WINDOWS = [30, 60, 300, 900, 0]; // seconds, 0 = all

const CATEGORY_ORDER = ["engine", "fuel", "air", "temperature", "emissions", "electrical", "vehicle"];

let windowS = 60;
/** Choice for a recording (opened or replayed); live data uses state.chartKeys. */
let recChosen: string[] | null = null;

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);

  const viewing = state.viewSession;
  const sessionSeries = new Map<string, Series>();
  if (viewing) {
    for (const f of viewing.session.frames) {
      for (const [k, v] of Object.entries(f.values)) {
        let s = sessionSeries.get(k);
        if (!s) sessionSeries.set(k, (s = { t: [], v: [] }));
        s.t.push(f.t_ms / 1000);
        s.v.push(v);
      }
      // Calculated values (consumption), computed from each frame.
      for (const [k, v] of Object.entries(calcValues(f.values))) {
        if (v === undefined || !Number.isFinite(v)) continue;
        let s = sessionSeries.get(k);
        if (!s) sessionSeries.set(k, (s = { t: [], v: [] }));
        s.t.push(f.t_ms / 1000);
        s.v.push(v);
      }
    }
  }
  // Event marks of a viewed recording, in seconds like the time axis.
  const marks = viewing ? [...(viewing.session.marks ?? [])].sort((a, b) => a - b).map((m) => m / 1000) : [];
  const markColor = cssVar("--danger") || "#ef4444";
  const drawMarks = (u: uPlot) => {
    if (!marks.length) return;
    const ctx = u.ctx;
    const { top, height } = u.bbox;
    ctx.save();
    ctx.strokeStyle = markColor;
    ctx.fillStyle = markColor;
    ctx.lineWidth = Math.max(1, devicePixelRatio || 1) * 1.5;
    ctx.setLineDash([6, 4]);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${11 * (devicePixelRatio || 1)}px system-ui, sans-serif`;
    marks.forEach((m, i) => {
      const x = Math.round(u.valToPos(m, "x", true));
      if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) return;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
      ctx.stroke();
      ctx.fillText(`★${i + 1}`, x + 4, top + 12 * (devicePixelRatio || 1));
    });
    ctx.restore();
  };
  const source = () => (viewing ? sessionSeries : state.history);
  const live = () => !viewing && !state.playback;
  /** Whether `key` can be charted here: recorded, or answered by the car. */
  const has = (key: string): boolean => {
    if (viewing) return sessionSeries.has(key);
    if (isCalc(key)) return calcInputs(key, has) !== null;
    // Before connecting anything known can be chosen; it is read once supported.
    if (live() && !state.adapter) return key === "battery_voltage" || state.catalog.some((m) => m.key === key);
    return isSupported(key);
  };
  const allKeys = () => [...state.catalog.map((m) => m.key), ...(state.catalog.some((m) => m.key === "battery_voltage") ? [] : ["battery_voltage"]), ...CALC_KEYS];
  const available = () => (viewing ? [...sessionSeries.keys()] : allKeys().filter(has));

  let paused = false;
  const plots = new Map<string, uPlot>();
  const chartBox = h("div", { class: "charts" });
  const chips = h("div", { class: "chips" });
  const presetRow = h("div", { class: "chips preset-row", role: "group", "aria-label": t("charts.presets") });
  const picker = h("div", { class: "picker", hidden: true });

  /** The stored choice: null follows the dashboard (live) or shows the first four (recording). */
  const stored = () => (live() ? state.chartKeys : recChosen);
  const selected = (): string[] => {
    const avail = available();
    const sel = stored();
    if (sel) return sel.filter(has);
    if (live()) return state.liveKeys.filter((k) => has(k) || state.history.has(k));
    return avail.slice(0, 4);
  };

  /** Changes the charted parameters; live, the adapter starts reading new ones. */
  const choose = (keys: string[] | null) => {
    if (live()) {
      setChartKeys(keys);
      if (state.connection === "connected") api.setLive(readKeys(), state.polling).catch((e) => toast(errorText(e), "error"));
    } else recChosen = keys;
    renderAll();
  };

  const renderPresets = () => {
    clear(presetRow);
    presetRow.append(h("span", { class: "muted small" }, t("charts.presets")));
    const active = matchChartPreset(stored(), has);
    for (const id of Object.keys(CHART_PRESETS) as ChartPresetId[]) {
      const keys = chartPresetKeys(id, has);
      // A recording has no dashboard to follow; skip groups with nothing to show.
      if (id === "dashboard" ? !live() : !keys?.length) continue;
      presetRow.append(
        h(
          "button",
          {
            type: "button",
            class: `chip ${id === active ? "on" : ""}`,
            "aria-pressed": String(id === active),
            title: t(`charts.preset.${id}.help`),
            onclick: () => choose(keys),
          },
          t(`charts.preset.${id}.name`),
        ),
      );
    }
  };

  const renderChips = () => {
    clear(chips);
    const sel = selected();
    for (const k of sel) {
      chips.append(
        h(
          "button",
          {
            type: "button",
            class: "chip on",
            title: `${pidText(k).name} · ${t("charts.remove")}`,
            onclick: () => choose(sel.filter((x) => x !== k)),
          },
          `${pidText(k).short} ✕`,
        ),
      );
    }
    chips.append(
      h(
        "button",
        {
          type: "button",
          class: "chip",
          "aria-expanded": String(!picker.hidden),
          onclick: () => {
            picker.hidden = !picker.hidden;
            renderAll();
            if (!picker.hidden) picker.querySelector<HTMLInputElement>("input[type=search]")?.focus();
          },
        },
        picker.hidden ? `+ ${t("charts.choose")}` : t("charts.closePicker"),
      ),
    );
  };

  // Full list by category with a search box, like the dashboard's picker.
  let query = "";
  const pickerList = h("div");
  const renderPickerList = () => {
    clear(pickerList);
    const sel = selected();
    const words = normalize(query).split(/\s+/).filter(Boolean);
    const matches = (key: string) => {
      const p = pidText(key);
      const pid = state.catalog.find((m) => m.key === key)?.pid;
      const text = normalize(`${p.name} ${p.short} ${key} ${pid === undefined ? "" : pid.toString(16).padStart(2, "0")}`);
      return words.every((w) => text.includes(w));
    };
    const avail = available().filter(matches);
    const category = (k: string) => (isCalc(k) ? "calculated" : k === "battery_voltage" ? "electrical" : (state.catalog.find((m) => m.key === k)?.category ?? "vehicle"));
    let shown = 0;
    for (const cat of ["calculated", ...CATEGORY_ORDER]) {
      const items = avail.filter((k) => category(k) === cat);
      if (!items.length) continue;
      shown += items.length;
      pickerList.append(
        h(
          "fieldset",
          null,
          h("legend", null, t(`categories.${cat}`)),
          items.map((k) =>
            h(
              "label",
              { class: "check", title: pidText(k).desc },
              h("input", {
                type: "checkbox",
                checked: sel.includes(k),
                onchange: (e: Event) => choose((e.target as HTMLInputElement).checked ? [...sel, k] : sel.filter((x) => x !== k)),
              }),
              h("span", null, pidText(k).name),
            ),
          ),
        ),
      );
    }
    if (!shown) pickerList.append(h("p", { class: "muted small" }, t("dashboard.pickerNone")));
  };
  const pickerSearch = h("input", {
    type: "search",
    class: "grow",
    placeholder: t("dashboard.pickerSearch"),
    "aria-label": t("dashboard.pickerSearch"),
    oninput: (e: Event) => {
      query = (e.target as HTMLInputElement).value;
      renderPickerList();
    },
  });
  picker.append(
    h("div", { class: "row" }, h("p", { class: "muted small grow" }, live() ? t("charts.chooseHelp") : t("charts.chooseHelpRecording")), button(t("dashboard.selectNone"), () => choose([]), "ghost")),
    h("div", { class: "row" }, pickerSearch),
    pickerList,
  );

  const renderAll = () => {
    renderPresets();
    renderChips();
    if (!picker.hidden) renderPickerList();
    buildPlots();
  };

  const sync = uPlot.sync("obd");

  const buildPlots = () => {
    plots.forEach((p) => p.destroy());
    plots.clear();
    clear(chartBox);
    const sel = selected();
    if (!sel.length) {
      chartBox.append(h("p", { class: "muted" }, t("charts.empty")));
      return;
    }
    const width = Math.max(320, chartBox.clientWidth || root.clientWidth - 48);
    sel.forEach((key, i) => {
      const color = cssVar(PALETTE[i % PALETTE.length]) || "#22d3ee";
      const unit = unitOf(key);
      const wrap = h("div", { class: "chart-card" });
      const title = h("div", { class: "chart-title" }, h("strong", null, pidText(key).name), h("span", { class: "muted" }, unit ? ` (${unit})` : ""));
      wrap.append(title);
      chartBox.append(wrap);
      const axisColor = cssVar("--muted");
      const gridColor = cssVar("--grid");
      const opts: uPlot.Options = {
        width,
        height: 170,
        cursor: { sync: { key: sync.key }, drag: { x: true, y: false } },
        legend: { show: true },
        scales: { x: { time: false } },
        hooks: { draw: [drawMarks] },
        axes: [
          { stroke: axisColor, grid: { stroke: gridColor }, ticks: { stroke: gridColor }, label: t("charts.time"), labelSize: 18, size: 36 },
          {
            stroke: axisColor,
            grid: { stroke: gridColor },
            ticks: { stroke: gridColor },
            size: 56,
            values: (_u, vals) => vals.map((v) => fmtNum(v, Math.min(decimalsFor(key), 2))),
          },
        ],
        series: [
          { label: t("charts.time"), value: (_u, v) => (v == null ? "—" : fmtNum(v, 1)) },
          {
            label: pidText(key).short,
            stroke: color,
            width: 2,
            fill: color + "22",
            points: { show: false },
            value: (_u, v) => (v == null ? "—" : `${fmtNum(v, decimalsFor(key))} ${unit}`),
          },
        ],
      };
      const plot = new uPlot(opts, dataFor(key), wrap);
      sync.sub(plot);
      plots.set(key, plot);
    });
  };

  const dataFor = (key: string): uPlot.AlignedData => {
    const s = source().get(key);
    if (!s || !s.t.length) return [[], []];
    const shown = (v: number[]) => v.map((x) => displayValue(key, x));
    if (!windowS || viewing) return [s.t.slice(), shown(s.v)];
    // Same time window for every chart, even when one value comes slower.
    const end = Math.max(state.lastFrameT ?? 0, s.t[s.t.length - 1]);
    let i = s.t.length - 1;
    while (i > 0 && s.t[i - 1] >= end - windowS) i--;
    return [s.t.slice(i), shown(s.v.slice(i))];
  };

  const refresh = () => {
    // An opened recording does not change; redrawing would undo the zoom.
    if (paused || viewing) return;
    plots.forEach((p, key) => p.setData(dataFor(key)));
  };

  /** All visible charts stacked in one picture, each with its title. */
  const composeCharts = (): HTMLCanvasElement | null => {
    if (!plots.size) return null;
    const canvases = [...plots.entries()].map(([k, p]) => ({ key: k, canvas: p.root.querySelector("canvas") as HTMLCanvasElement }));
    const scale = window.devicePixelRatio || 1;
    const titleH = 28 * scale;
    const w = Math.max(...canvases.map((c) => c.canvas.width));
    const hgt = canvases.reduce((a, c) => a + c.canvas.height + titleH, 0) + 16 * scale;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = hgt;
    const ctx = out.getContext("2d")!;
    ctx.fillStyle = cssVar("--surface") || "#111827";
    ctx.fillRect(0, 0, w, hgt);
    ctx.font = `${14 * scale}px system-ui, sans-serif`;
    let y = 8 * scale;
    for (const c of canvases) {
      ctx.fillStyle = cssVar("--text") || "#fff";
      const unit = unitOf(c.key);
      ctx.fillText(`${pidText(c.key).name}${unit ? ` (${unit})` : ""}`, 12 * scale, y + 18 * scale);
      y += titleH;
      ctx.drawImage(c.canvas, 0, y);
      y += c.canvas.height;
    }
    return out;
  };

  const exportPng = async () => {
    const out = composeCharts();
    if (!out) return;
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
    if (!blob) return;
    const path = await save({ defaultPath: `obd2-grafico-${timestampForFile()}.png`, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (!path) return;
    try {
      await api.saveFile(path, Array.from(new Uint8Array(await blob.arrayBuffer())));
      toast(t("common.saved", { path }), "ok");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const copyPng = async () => {
    const out = composeCharts();
    if (!out) return;
    const lines = selected().map((k) => {
      const mm = (viewing ? null : state.minmax[k]) ?? null;
      const unit = unitOf(k);
      return { text: mm ? `${pidText(k).name}: ${t("dashboard.min")} ${fmtNum(displayValue(k, mm[0]), decimalsFor(k))} · ${t("dashboard.max")} ${fmtNum(displayValue(k, mm[1]), decimalsFor(k))} ${unit}` : pidText(k).name };
    });
    await copyCard(drawCard(viewing ? `${t("charts.title")} · ${viewing.name}` : t("charts.title"), lines, out), "obd2-grafico");
  };

  const windowSel = h(
    "select",
    {
      "aria-label": t("charts.window"),
      disabled: !!viewing,
      onchange: (e: Event) => {
        windowS = Number((e.target as HTMLSelectElement).value);
        refresh();
      },
    },
    WINDOWS.map((w) =>
      h(
        "option",
        { value: String(w), selected: w === windowS },
        w === 0 ? t("charts.all") : w < 60 ? t("charts.seconds", { n: w }) : t("charts.minutes", { n: w / 60 }),
      ),
    ),
  );
  const pauseBtn = button(t("charts.pause"), () => {
    paused = !paused;
    pauseBtn.textContent = paused ? t("charts.resume") : t("charts.pause");
    refresh();
  }, "ghost");

  const head = h(
    "div",
    { class: "page-head" },
    h("h1", null, t("charts.title")),
    h(
      "div",
      { class: "toolbar" },
      h("label", { class: "inline" }, h("span", null, t("charts.window")), windowSel),
      viewing ? null : pauseBtn,
      button(t("share.copy"), copyPng, "secondary", { title: t("share.help") }),
      button(t("charts.exportPng"), exportPng, "ghost"),
    ),
  );
  page.append(head);
  if (viewing) {
    page.append(
      h(
        "div",
        { class: "alert" },
        h("span", null, t("charts.viewing", { name: viewing.name })),
        button(t("charts.backToLive"), () => {
          state.viewSession = null;
          location.hash = "#/charts";
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }, "ghost"),
      ),
    );
  } else if (!hasLiveSource() && !state.history.size) {
    page.append(h("p", { class: "muted" }, t("charts.empty")));
  }
  page.append(presetRow, h("div", { class: "field" }, h("span", { class: "label" }, t("charts.params")), chips), picker);
  if (marks.length) {
    // Jump chips: zoom all charts to 30 s around each marked event.
    page.append(
      h(
        "div",
        { class: "field" },
        h("span", { class: "label" }, t("marks.inChart")),
        h(
          "div",
          { class: "chips" },
          h(
            "button",
            {
              type: "button",
              class: "chip",
              onclick: () =>
                plots.forEach((p) => {
                  const xs = p.data[0];
                  if (xs.length) p.setScale("x", { min: xs[0], max: xs[xs.length - 1] });
                }),
            },
            t("charts.all"),
          ),
          marks.map((m, i) =>
            h(
              "button",
              {
                type: "button",
                class: "chip mark-chip",
                title: t("marks.jump", { n: i + 1 }),
                onclick: () => plots.forEach((p) => p.setScale("x", { min: Math.max(0, m - 15), max: m + 15 })),
              },
              `★${i + 1} · ${fmtNum(m, 0)} s`,
            ),
          ),
        ),
      ),
    );
  }
  page.append(chartBox);
  renderPresets();
  renderChips();
  requestAnimationFrame(buildPlots);

  let raf = 0;
  const ro = new ResizeObserver(() => {
    const w = chartBox.clientWidth;
    // Hidden (mini mode): keep the last size instead of shrinking to nothing.
    if (w === 0) return;
    plots.forEach((p) => p.setSize({ width: w, height: 170 }));
  });
  ro.observe(chartBox);
  const onTheme = () => buildPlots();
  window.addEventListener("themechange", onTheme);
  const offs = [
    on("frame", () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), refresh()));
    }),
    // Seeking a replayed recording rebuilds the history from scratch.
    on("playback", () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), refresh()));
    }),
    on("live-keys", renderAll),
    // Connecting tells which parameters the car answers.
    on("connection", () => {
      renderPresets();
      renderChips();
      if (!picker.hidden) renderPickerList();
    }),
  ];
  return () => {
    offs.forEach((f) => f());
    ro.disconnect();
    window.removeEventListener("themechange", onTheme);
    cancelAnimationFrame(raf);
    plots.forEach((p) => p.destroy());
  };
}
