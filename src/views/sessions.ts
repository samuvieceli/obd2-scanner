// Recording, export (CSV/JSON), opening recordings and the diagnostic report.
import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { fmtNum, t } from "../i18n";
import { emit, on, readKeys, state } from "../store";
import { busy, button, clear, errorText, h, section, timestampForFile, toast } from "../ui";
import { startPlayback } from "../playback";
import { buildReportHtml } from "./report";
import { driveHistorySection } from "./drive-history";
import { toggleRecording } from "./dashboard";

function duration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m ? `${m} min ${sec} s` : `${fmtNum(s, 1)} s`;
}

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  page.append(h("h1", null, t("sessions.title")));

  const statusBox = h("div");
  const recBtn = button("", async () => {
    // Starting also turns reading on, or the recording would stay empty.
    if (await busy(recBtn, async () => (await toggleRecording(), true))) state.recoveredFrames = null;
    renderStatus();
  }, "primary");

  const renderStatus = () => {
    clear(statusBox);
    const r = state.recording;
    recBtn.textContent = r.recording ? t("sessions.stop") : t("sessions.start");
    recBtn.className = `btn ${r.recording ? "btn-danger" : "btn-primary"}`;
    recBtn.disabled = state.connection !== "connected" && !r.recording;
    if (r.recording) statusBox.append(h("p", { class: "rec-text" }, t("sessions.recording", { frames: r.frames })));
    if (r.recording && !state.polling) statusBox.append(h("p", { class: "muted small" }, t("sessions.needLive")));
    if (state.recoveredFrames && !r.recording) statusBox.append(h("div", { class: "alert alert-warning" }, t("sessions.recoveredHint", { frames: state.recoveredFrames })));
    statusBox.append(
      h("p", { class: "muted" }, r.lastFrames ? t("sessions.last", { frames: r.lastFrames, duration: duration(r.lastDurationS) }) : t("sessions.none")),
    );
    exportBtns.forEach((b) => (b.disabled = !r.lastFrames));
  };

  const doExport = async (format: "csv" | "csv_br" | "json") => {
    const ext = format === "json" ? "json" : "csv";
    const path = await save({
      defaultPath: `obd2-gravacao-${timestampForFile()}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return;
    try {
      await api.exportSession(format, path);
      toast(t("common.saved", { path }), "ok");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const exportOption = (format: "csv" | "csv_br" | "json", title: string, desc: string) => {
    const b = button(title, () => doExport(format), "secondary");
    return { b, el: h("div", { class: "option" }, b, h("p", { class: "muted small" }, desc)) };
  };
  const opts = [
    exportOption("csv_br", t("sessions.csvBr"), t("sessions.csvBrDesc")),
    exportOption("csv", t("sessions.csv"), t("sessions.csvDesc")),
    exportOption("json", t("sessions.json"), t("sessions.jsonDesc")),
  ];
  const exportBtns = opts.map((o) => o.b);

  const pick = async () => {
    const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path || Array.isArray(path)) return null;
    try {
      return { name: path.split(/[\\/]/).pop() ?? path, session: await api.loadSession(path) };
    } catch (e) {
      toast(errorText(e), "error");
      return null;
    }
  };
  const openBtn = button(t("sessions.openCharts"), async () => {
    const r = await pick();
    if (!r) return;
    state.viewSession = r;
    location.hash = "#/charts";
  }, "secondary");
  const replayBtn = button(t("sessions.replay"), async () => {
    const r = await pick();
    if (!r) return;
    if (!r.session.frames.length) {
      toast(t("sessions.replayEmpty"), "info");
      return;
    }
    if (state.polling) {
      try {
        await api.setLive(readKeys(), false);
      } catch {
        /* the worker may already be gone */
      }
      state.polling = false;
      emit("connection");
    }
    state.viewSession = null;
    startPlayback(r.name, r.session);
    location.hash = "#/dashboard";
  }, "primary");

  const saveReport = async () => {
    const path = await save({ defaultPath: `obd2-relatorio-${timestampForFile()}.html`, filters: [{ name: "HTML", extensions: ["html"] }] });
    if (!path) return;
    try {
      await api.saveText(path, buildReportHtml());
      toast(t("common.saved", { path }), "ok");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };
  const printReport = () => {
    const frame = h("iframe", { class: "print-frame", title: t("sessions.reportTitle") });
    document.body.append(frame);
    frame.srcdoc = buildReportHtml();
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 60_000);
    };
  };

  page.append(
    section(t("sessions.recordingTitle"), h("p", { class: "muted" }, t("sessions.recordingIntro")), recBtn, statusBox),
    section(t("sessions.export"), h("div", { class: "options" }, opts.map((o) => o.el))),
    section(
      t("sessions.open"),
      h(
        "div",
        { class: "options" },
        h("div", { class: "option" }, replayBtn, h("p", { class: "muted small" }, t("sessions.replayDesc"))),
        h("div", { class: "option" }, openBtn, h("p", { class: "muted small" }, t("sessions.openDesc"))),
      ),
    ),
    section(
      t("sessions.reportTitle"),
      h("p", { class: "muted" }, t("sessions.reportIntro")),
      h(
        "div",
        { class: "options" },
        h("div", { class: "option" }, button(t("sessions.reportPrint"), printReport, "primary"), h("p", { class: "muted small" }, t("sessions.reportPrintDesc"))),
        h("div", { class: "option" }, button(t("sessions.reportHtml"), saveReport, "secondary")),
      ),
    ),
    driveHistorySection(),
  );

  renderStatus();
  const tick = setInterval(async () => {
    if (state.connection !== "connected") return;
    try {
      state.recording = await api.recordingStatus();
      renderStatus();
    } catch {
      /* ignore */
    }
  }, 1000);
  const offs = [on("recording", renderStatus), on("connection", renderStatus)];
  return () => {
    clearInterval(tick);
    offs.forEach((f) => f());
  };
}
