// Charts: one synchronized time chart per parameter (uPlot, bundled locally).
import uPlot from "uplot";
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { pidText, t } from "../i18n";
import { on, state, type Series } from "../store";
import { cssVar } from "../theme";
import { button, clear, decimalsFor, errorText, h, timestampForFile, toast, unitOf } from "../ui";
import { fmtNum } from "../i18n";

const PALETTE = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"];
const WINDOWS = [30, 60, 300, 900, 0]; // seconds, 0 = all

let windowS = 60;
let chosen: string[] | null = null;

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
    }
  }
  const source = () => (viewing ? sessionSeries : state.history);
  const available = () => (viewing ? [...sessionSeries.keys()] : [...state.liveKeys]);

  let paused = false;
  const plots = new Map<string, uPlot>();
  const chartBox = h("div", { class: "charts" });
  const chips = h("div", { class: "chips" });

  const selected = () => {
    const avail = available();
    const sel = (chosen ?? avail.slice(0, 4)).filter((k) => avail.includes(k));
    return sel.length ? sel : avail.slice(0, 4);
  };

  const renderChips = () => {
    clear(chips);
    const sel = selected();
    for (const k of available()) {
      const on_ = sel.includes(k);
      chips.append(
        h(
          "button",
          {
            type: "button",
            class: `chip ${on_ ? "on" : ""}`,
            "aria-pressed": on_ ? "true" : "false",
            title: pidText(k).name,
            onclick: () => {
              chosen = on_ ? sel.filter((x) => x !== k) : [...sel, k];
              renderChips();
              buildPlots();
            },
          },
          pidText(k).short,
        ),
      );
    }
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
    if (!windowS || viewing) return [s.t.slice(), s.v.slice()];
    const end = s.t[s.t.length - 1];
    let i = s.t.length - 1;
    while (i > 0 && s.t[i - 1] >= end - windowS) i--;
    return [s.t.slice(i), s.v.slice(i)];
  };

  const refresh = () => {
    if (paused) return;
    plots.forEach((p, key) => p.setData(dataFor(key)));
  };

  const exportPng = async () => {
    if (!plots.size) return;
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
      button(t("charts.exportPng"), exportPng, "secondary"),
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
  } else if (state.connection !== "connected" && !state.history.size) {
    page.append(h("p", { class: "muted" }, t("charts.empty")));
  }
  page.append(h("div", { class: "field" }, h("span", { class: "label" }, t("charts.params")), chips), chartBox);
  renderChips();
  requestAnimationFrame(buildPlots);

  let raf = 0;
  const ro = new ResizeObserver(() => {
    const w = chartBox.clientWidth;
    plots.forEach((p) => p.setSize({ width: w, height: 170 }));
  });
  ro.observe(chartBox);
  const onTheme = () => buildPlots();
  window.addEventListener("themechange", onTheme);
  const offs = [
    on("frame", () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), refresh()));
    }),
    on("live-keys", () => {
      renderChips();
      buildPlots();
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
