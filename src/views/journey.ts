// "Viagem" screen: start and end a trip with one button, then see what it
// cost and why (consumption and efficiency only), with a report (PDF),
// spreadsheet (CSV) and image card. Saved recordings can be analysed the
// same way. The automatic trip history (every drive) is at the bottom.
import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { drivesOf, fuelGroup, usualKmPerL } from "../drives";
import { getLang, t } from "../i18n";
import { analyze, logFromFrames, type JourneyAnalysis, type JourneyLog } from "../journey";
import { active, activeTotals, endJourney, startJourney } from "../journey-live";
import { deleteJourney, listJourneys, loadLog, saveJourney, type JourneyMeta } from "../journey-store";
import { prefs, profile } from "../prefs";
import { copyCard, drawCard } from "../share";
import { on, state } from "../store";
import { calibratedFills, fuelFlow } from "../trip";
import { busy, button, clear, errorText, h, infoTip, section, timestampForFile, toast } from "../ui";
import { driveHistorySection, distanceText, economyText, moneyText, volumeText } from "./drive-history";
import {
  bandRows,
  buildJourneyCsv,
  buildJourneyReportHtml,
  cardLines,
  chartsHtml,
  drivingRows,
  durationText,
  engineRows,
  journeyCost,
  journeyTitle,
  mainRows,
  splitRows,
  tipText,
  trustNotes,
  type Row,
} from "./journey-report";
import { openReport } from "./sessions";
import { tripCost } from "../cost";

/** Trip open in the analysis view; kept while the user visits other screens. */
let openId: string | null = null;

function analysisOf(m: JourneyMeta, log: JourneyLog): JourneyAnalysis {
  return analyze(log, {
    diesel: m.fuel === "diesel",
    avgKmPerL: usualKmPerL(drivesOf(m.profileId), fuelGroup(m)),
  });
}

function kv(rows: Row[]): HTMLElement {
  return h(
    "dl",
    { class: "kv" },
    rows.flatMap(([k, v, help]) => [h("dt", null, k, help ? " " : "", help ? infoTip(help) : ""), h("dd", null, v)]),
  );
}

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page journey" });
  root.append(page);
  const nowBox = h("div");
  const mainBox = h("div", { class: "journey-main" });
  page.append(
    h("h1", null, t("journey.title")),
    h("p", { class: "muted lead" }, t("journey.intro")),
    section(t("journey.nowTitle"), nowBox),
    mainBox,
    driveHistorySection(),
  );

  // --- Trip in progress ------------------------------------------------------
  let liveEl: HTMLElement | null = null;
  const renderLive = () => {
    if (!liveEl || !active) return;
    const tot = activeTotals();
    if (!tot) return;
    const rows: Row[] = [
      [t("journey.facts.running"), durationText(tot.runningS)],
      [t("journey.facts.distance"), distanceText(tot.distanceKm)],
    ];
    if (tot.fuelL !== undefined) {
      rows.push([t("journey.facts.fuel"), volumeText(tot.fuelL)]);
      rows.push([t("journey.facts.economy"), economyText(tot.distanceKm >= 1 && tot.fuelL >= 0.05 ? tot.distanceKm / tot.fuelL : undefined)]);
      const c = tripCost(tot.fuelL, active.meta.fuel, state.latest.ethanol_percent, prefs().fuelPrices, prefs().fuelRegion);
      if (c.cost !== undefined) rows.push([t("journey.facts.cost"), moneyText(c.cost)]);
    }
    clear(liveEl);
    liveEl.append(kv(rows));
  };

  const renderNow = () => {
    clear(nowBox);
    liveEl = null;
    const connected = state.connection === "connected";
    if (active) {
      const since = new Date(active.meta.startedAt).toLocaleString(getLang(), { dateStyle: "short", timeStyle: "short" });
      liveEl = h("div");
      const endBtn = button(t("journey.end"), async () => {
        const id = await busy(endBtn, () => endJourney());
        if (id) {
          openId = id;
          toast(t("journey.saved"), "ok");
        } else if (id === null) toast(t("journey.tooShort"), "info");
        renderNow();
        void renderMain();
      }, "danger", { class: "btn btn-danger btn-lg" });
      nowBox.append(
        h("p", { class: "rec-text" }, t("journey.running", { since })),
        connected
          ? state.polling
            ? ""
            : h("p", { class: "muted" }, t("journey.paused"))
          : h("div", { class: "alert alert-warning" }, t("journey.waiting"), h("a", { class: "btn btn-secondary btn-sm", href: "#/connection" }, t("common.goToConnection"))),
        liveEl,
        endBtn,
        h("p", { class: "muted small" }, t("journey.runningHelp")),
      );
      renderLive();
      return;
    }
    const startBtn = button(t("journey.start"), async () => {
      await busy(startBtn, () => startJourney());
      renderNow();
    }, "primary", { class: "btn btn-primary btn-lg", disabled: !connected || !!state.playback });
    nowBox.append(
      h("p", null, t("journey.startHelp")),
      startBtn,
      !connected ? h("p", { class: "muted small" }, t("journey.needConnection"), " ", h("a", { href: "#/connection" }, t("common.goToConnection"))) : "",
      h("p", { class: "muted small" }, t("journey.laptopHelp")),
    );
  };

  // --- Saved trips and the analysis of one ------------------------------------
  let deleting: string | null = null;

  const importRecording = async (btn: HTMLButtonElement) => {
    const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path || Array.isArray(path)) return;
    await busy(btn, async () => {
      const session = await api.loadSession(path);
      const log = logFromFrames(session.frames, fuelFlow);
      if (log.rows.length < 30) {
        toast(t("journey.importEmpty"), "info");
        return;
      }
      const p = profile();
      const keys = new Set(log.keys);
      const method = session.pids.some((x) => x.key === "fuel_rate") ? "pid" : keys.has("maf") ? "maf" : keys.has("intake_map") ? "map" : null;
      const startedAt = session.started_at_unix_ms || Date.now();
      const meta: JourneyMeta = {
        id: `r${Date.now().toString(36)}`,
        profileId: p.id,
        name: path.split(/[\\/]/).pop()?.replace(/\.json$/i, "") ?? "",
        note: "",
        startedAt,
        endedAt: startedAt + (log.rows[log.rows.length - 1][0] ?? 0) * 1000,
        fuel: p.fuel,
        source: "recording",
        method,
        calibrated: method === "pid" || (method !== null && calibratedFills(method) > 0),
        distanceKm: 0,
        runningS: 0,
      };
      const a = analysisOf(meta, log);
      Object.assign(meta, { distanceKm: a.distanceKm, fuelL: a.fuelL, runningS: a.runningS });
      if (!(await saveJourney(meta, log))) toast(t("journey.storageFailed"), "error");
      openId = meta.id;
      await renderMain(meta, log);
    });
  };

  const renderList = async () => {
    const mine = (await listJourneys()).filter((m) => m.profileId === profile().id && !m.active);
    clear(mainBox);
    const importBtn: HTMLButtonElement = button(t("journey.import"), () => importRecording(importBtn), "secondary");
    const list = mine.length
      ? h(
          "ul",
          { class: "plain-list journey-list" },
          mine.map((m) =>
            h(
              "li",
              null,
              h(
                "button",
                { type: "button", class: "linklike grow", onclick: () => ((openId = m.id), void renderMain()) },
                h("strong", null, journeyTitle(m)),
                h(
                  "span",
                  { class: "muted" },
                  ` · ${distanceText(m.distanceKm)} · ${durationText(m.runningS)}`,
                  m.fuelL !== undefined ? ` · ${economyText(m.distanceKm >= 1 && m.fuelL >= 0.05 ? m.distanceKm / m.fuelL : undefined)}` : "",
                  m.source === "recording" ? ` · ${t("journey.recordingTag")}` : "",
                ),
              ),
              button(
                deleting === m.id ? t("history.deleteConfirm") : t("history.delete"),
                async () => {
                  if (deleting !== m.id) {
                    deleting = m.id;
                    return renderList();
                  }
                  await deleteJourney(m.id);
                  deleting = null;
                  await renderList();
                },
                deleting === m.id ? "danger" : "ghost",
                { class: `btn btn-sm btn-${deleting === m.id ? "danger" : "ghost"}` },
              ),
            ),
          ),
        )
      : h("p", { class: "muted" }, t("journey.listEmpty"));
    mainBox.append(
      section(
        t("journey.listTitle"),
        list,
        h("div", { class: "option" }, importBtn, h("p", { class: "muted small" }, t("journey.importHelp"))),
      ),
    );
  };

  const renderAnalysis = (m: JourneyMeta, log: JourneyLog) => {
    clear(mainBox);
    const a = analysisOf(m, log);
    const saveMeta = () => void saveJourney(m);
    const nameIn = h("input", {
      type: "text",
      value: m.name,
      placeholder: t("journey.namePlaceholder"),
      "aria-label": t("journey.name"),
      onchange: (ev: Event) => {
        m.name = (ev.target as HTMLInputElement).value;
        saveMeta();
      },
    });
    const noteIn = h("textarea", {
      rows: 2,
      placeholder: t("journey.notePlaceholder"),
      "aria-label": t("journey.note"),
      onchange: (ev: Event) => {
        m.note = (ev.target as HTMLTextAreaElement).value;
        saveMeta();
      },
    });
    noteIn.value = m.note;
    const when = `${new Date(m.startedAt).toLocaleString(getLang(), { dateStyle: "long", timeStyle: "short" })}${m.endedAt ? ` – ${new Date(m.endedAt).toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit" })}` : ""}`;

    const report = () => openReport(buildJourneyReportHtml(m, a, log, state.appVersion), "obd2-viagem");
    const csv = async () => {
      const path = await save({ defaultPath: `obd2-viagem-${timestampForFile()}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (!path) return;
      try {
        await api.saveText(path, buildJourneyCsv(m, log));
        toast(t("common.saved", { path }), "ok");
      } catch (e) {
        toast(errorText(e), "error");
      }
    };
    const image = () => {
      const c = cardLines(m, a);
      void copyCard(drawCard(c.title, c.lines), "obd2-viagem");
    };

    const bands = bandRows(a);
    const head = ["", "time", "distance", "fuel", "economy"].map((c) => (c ? t(`journey.split.col.${c}`) : ""));
    const charts = chartsHtml(log);
    const cost = journeyCost(m, a);
    mainBox.append(
      h(
        "section",
        { class: "card" },
        h(
          "div",
          { class: "page-head" },
          h("h2", null, t("journey.analysisTitle")),
          button(t("journey.back"), () => ((openId = null), void renderMain()), "ghost"),
        ),
        h("p", { class: "muted" }, when),
        h("div", { class: "row" }, h("label", { class: "field grow" }, h("span", null, t("journey.name")), nameIn)),
        h("label", { class: "field" }, h("span", null, t("journey.note")), noteIn),
        trustNotes(m, a).map((n) => h("div", { class: "alert alert-warning" }, n)),
        h("div", { class: "row wrap journey-actions" },
          button(t("journey.report"), report, "primary", { title: t("journey.reportHelp") }),
          button(t("journey.csv.button"), csv, "secondary", { title: t("journey.csv.help") }),
          button(t("share.copy"), image, "secondary", { title: t("share.help") }),
        ),
      ),
      h(
        "div",
        { class: "two-col" },
        section(t("journey.mainTitle"), kv(mainRows(m, a)), cost?.cost === undefined && a.fuelL !== undefined ? h("p", { class: "muted small" }, t("journey.setPrices")) : ""),
        section(
          t("journey.tipsTitle"),
          a.tips.length
            ? h("ul", { class: "journey-tips" }, a.tips.map((x) => h("li", { class: `tip-${x.level}` }, tipText(x))))
            : h("p", { class: "muted" }, t("journey.noTips")),
        ),
      ),
      section(
        t("journey.splitTitle"),
        h("p", { class: "muted small" }, t("journey.splitHelp")),
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "table" },
            h("thead", null, h("tr", null, head.map((c) => h("th", null, c)))),
            h("tbody", null, splitRows(a).map((r) => h("tr", null, h("th", null, r[0]), r.slice(1).map((c) => h("td", null, c))))),
          ),
        ),
      ),
      bands.length
        ? section(
            t("journey.bandsTitle"),
            h("p", { class: "muted small" }, t("journey.bandsHelp", { kmh: 10 })),
            h(
              "div",
              { class: "journey-bands" },
              bands.map((b) =>
                h(
                  "div",
                  { class: `journey-band${b.best ? " best" : ""}` },
                  h("span", { class: "journey-band-label" }, b.label),
                  h("span", { class: "journey-band-bar" }, h("span", { style: `width:${Math.round(b.share * 100)}%` })),
                  h("strong", null, b.economy),
                  h("span", { class: "muted small" }, b.distance),
                ),
              ),
            ),
          )
        : "",
      h("div", { class: "two-col" }, section(t("journey.drivingTitle"), kv(drivingRows(a))), section(t("journey.engineTitle"), kv(engineRows(a)))),
      charts ? section(t("journey.chartsTitle"), h("div", { class: "journey-charts", html: charts })) : "",
      h("p", { class: "muted small" }, t("journey.reportNote")),
    );
  };

  async function renderMain(meta?: JourneyMeta, log?: JourneyLog) {
    if (openId && (!meta || !log)) {
      const m = (await listJourneys()).find((x) => x.id === openId);
      const l = m && (await loadLog(m.id));
      if (m && l) return renderAnalysis(m, l);
      openId = null;
    }
    if (meta && log) return renderAnalysis(meta, log);
    return renderList();
  }

  renderNow();
  void renderMain();
  let lastLive = 0;
  const offs = [
    on("connection", renderNow),
    on("journey", () => {
      if (!active !== !liveEl) return renderNow();
      const now = Date.now();
      if (now - lastLive >= 2000) {
        lastLive = now;
        renderLive();
      }
    }),
    on("profile", () => {
      openId = null;
      void renderMain();
    }),
  ];
  return () => offs.forEach((f) => f());
}
