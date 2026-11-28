// "Viagem" screen: start and end a trip with one button, then see what it
// cost and why (consumption and efficiency only), with a report (PDF),
// spreadsheet (CSV) and image card. Saved recordings can be analysed the
// same way. The automatic trip history (every drive) is at the bottom.
import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { drivesOf, fuelGroup, usualKmPerL } from "../drives";
import { fmtNum, getLang, pidText, t } from "../i18n";
import { advantage, analyze, applyCuts, compare, keepOnly, logFromFrames, seriesOf, winner, type CompareRow, type Cut, type JourneyAnalysis, type JourneyLog } from "../journey";
import { evaluate, overall, type CheckItem } from "../precheck";
import { active, activeTotals, endJourney, startJourney } from "../journey-live";
import { deleteJourney, listJourneys, loadLog, saveJourney, type JourneyMeta } from "../journey-store";
import { prefs, profile } from "../prefs";
import { copyCard, drawCard } from "../share";
import { emit, isSupported, on, readKeys, recentValues, state } from "../store";
import { calibratedFills, fuelFlow } from "../trip";
import { busy, button, clear, displayValue, errorText, fmtValue, h, infoTip, section, timestampForFile, toast, unitOf } from "../ui";
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
import { clock, seriesSvg } from "./report";
import { consumption } from "../units";
import { tripCost } from "../cost";

/** Trip open in the analysis view; kept while the user visits other screens. */
let openId: string | null = null;
/** Two trips shown side by side (instead of one analysis). */
let compareIds: [string, string] | null = null;
/** Trips ticked in the list for comparing (at most two). */
let picked: string[] = [];
/** Result of the last pre-trip check, until the program closes. */
let lastCheck: { at: number; items: CheckItem[] } | null = null;
/** The pre-trip check is running (reading changes meanwhile: keep the screen still). */
let checking = false;

/** Seconds to wait for fresh values during the pre-trip check. */
const CHECK_WAIT_MS = 4000;

/**
 * Pre-trip check: reads trouble codes, the warning light and, for a few
 * seconds, engine speed, battery voltage and coolant temperature. Reading
 * goes back to how it was afterwards.
 */
async function runCheck(): Promise<CheckItem[]> {
  const wasPolling = state.polling;
  state.extraKeys = ["rpm", "coolant_temp", "battery_voltage"];
  let values: Record<string, number> = {};
  try {
    await api.setLive(readKeys(), true);
    state.polling = true;
    emit("connection");
    const since = state.lastFrameT;
    const until = Date.now() + CHECK_WAIT_MS;
    // Wait for a frame newer than the ones before the check (or give up).
    while (Date.now() < until && (state.lastFrameT === since || recentValues().battery_voltage === undefined)) await new Promise((r) => setTimeout(r, 250));
    values = recentValues();
  } finally {
    state.extraKeys = [];
    await api.setLive(readKeys(), wasPolling).catch(() => undefined);
    state.polling = wasPolling;
    emit("connection");
  }
  const dtcs = await api.readDtcs(getLang()).catch(() => null);
  if (dtcs) {
    state.dtcs = dtcs;
    emit("dtcs");
  }
  const readiness = await api.readReadiness().catch(() => null);
  return evaluate({
    codes: dtcs ? { stored: dtcs.stored.length, pending: dtcs.pending.length, permanent: dtcs.permanent.length } : undefined,
    mil: readiness?.mil_on,
    rpm: isSupported("rpm") ? values.rpm : undefined,
    voltage: values.battery_voltage,
    coolant: isSupported("coolant_temp") ? values.coolant_temp : undefined,
  });
}

const CHECK_ICON = { ok: "✓", warn: "!", bad: "✗", unknown: "?" } as const;

function checkView(c: { at: number; items: CheckItem[] }): HTMLElement {
  const all = overall(c.items);
  return h(
    "div",
    { class: `journey-check check-${all}` },
    h("p", null, h("strong", null, t(`journey.check.overall.${all}`)), " ", h("span", { class: "muted small" }, new Date(c.at).toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit" }))),
    h(
      "ul",
      { class: "plain-list" },
      c.items.map((i) =>
        h("li", { class: `check-item check-${i.status}` }, h("span", { class: "check-icon", "aria-hidden": "true" }, CHECK_ICON[i.status]), t(`journey.check.items.${i.id}.${i.status === "unknown" ? "unknown" : (i.variant ?? i.status)}`, i.params)),
      ),
    ),
    h("p", { class: "muted small" }, t("journey.check.note")),
  );
}

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
    const checkBox = h("div");
    if (lastCheck && !checking) checkBox.append(checkView(lastCheck));
    const checkBtn = button(checking ? t("journey.check.running") : t("journey.check.button"), async () => {
      checking = true;
      renderNow();
      try {
        lastCheck = { at: Date.now(), items: await runCheck() };
      } catch (e) {
        toast(errorText(e), "error");
      } finally {
        checking = false;
        renderNow();
      }
    }, "secondary", { title: t("journey.check.help"), disabled: checking || !connected || !!state.playback });
    nowBox.append(
      h("p", null, t("journey.startHelp")),
      h("div", { class: "row wrap" }, startBtn, checkBtn),
      checkBox,
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
              h("input", {
                type: "checkbox",
                checked: picked.includes(m.id),
                title: t("journey.compare.pick"),
                "aria-label": t("journey.compare.pick"),
                onchange: (ev: Event) => {
                  const on_ = (ev.target as HTMLInputElement).checked;
                  picked = on_ ? [...picked.filter((x) => x !== m.id), m.id].slice(-2) : picked.filter((x) => x !== m.id);
                  void renderList();
                },
              }),
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
    picked = picked.filter((id) => mine.some((m) => m.id === id));
    const compareBtn = button(t("journey.compare.button"), () => {
      compareIds = [picked[0], picked[1]];
      openId = null;
      void renderMain();
    }, "primary", { disabled: picked.length !== 2 });
    mainBox.append(
      section(
        t("journey.listTitle"),
        mine.length > 1 ? h("p", { class: "muted small" }, t("journey.compare.help")) : "",
        list,
        mine.length > 1 ? compareBtn : "",
        h("div", { class: "option" }, importBtn, h("p", { class: "muted small" }, t("journey.importHelp"))),
      ),
    );
  };

  const renderAnalysis = (m: JourneyMeta, fullLog: JourneyLog) => {
    clear(mainBox);
    const log = applyCuts(fullLog, m.cuts);
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
        m.cuts?.length ? h("div", { class: "alert" }, t("journey.trim.active", { n: m.cuts.length })) : "",
        h("div", { class: "row wrap journey-actions" },
          button(t("journey.report"), report, "primary", { title: t("journey.reportHelp") }),
          button(t("journey.csv.button"), csv, "secondary", { title: t("journey.csv.help") }),
          button(t("share.copy"), image, "secondary", { title: t("share.help") }),
        ),
      ),
      trimSection(m, fullLog),
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

  /** "Cortar a viagem": keep only a stretch, or take a part out (a stop at the pump). */
  const trimSection = (m: JourneyMeta, fullLog: JourneyLog): HTMLElement => {
    const end = fullLog.rows[fullLog.rows.length - 1]?.[0] ?? 0;
    let from = 0;
    let to = end;
    const sp = seriesOf(fullLog, "speed");
    const title = `${pidText("speed").name} (${unitOf("speed")})`;
    const chart = h("div", { class: "journey-charts" });
    const label = h("p", { class: "mono" });
    const draw = () => {
      const shades: { from: number; to: number; kind: "cut" | "sel" }[] = (m.cuts ?? []).map(([a, b]) => ({ from: a, to: b, kind: "cut" }));
      // Highlight only once a stretch is chosen (the whole trip is the default).
      if (from > 0 || to < end) shades.push({ from, to, kind: "sel" });
      chart.innerHTML = seriesSvg(title, sp.t, sp.v.map((x) => displayValue("speed", x)), end, [], false, shades);
      label.textContent = t("journey.trim.selection", { from: clock(from), to: clock(to), len: clock(to - from) });
    };
    const slider = (value: number, set: (v: number) => void, name: string) =>
      h("label", { class: "field grow" }, h("span", null, name), h("input", { type: "range", min: "0", max: String(Math.ceil(end)), step: "1", value: String(value), oninput: (ev: Event) => (set(Number((ev.target as HTMLInputElement).value)), draw()) }));
    const fromIn = slider(0, (v) => (from = Math.min(v, to - 10)), t("journey.trim.from"));
    const toIn = slider(end, (v) => (to = Math.max(v, from + 10)), t("journey.trim.to"));
    const apply = async (cuts: Cut[] | undefined) => {
      const before = m.cuts;
      m.cuts = cuts;
      const l = applyCuts(fullLog, cuts);
      if (l.rows.length < 30) {
        m.cuts = before;
        toast(t("journey.trim.tooShort"), "info");
        return;
      }
      const a = analysisOf(m, l);
      Object.assign(m, { distanceKm: a.distanceKm, fuelL: a.fuelL, runningS: a.runningS });
      await saveJourney(m);
      renderAnalysis(m, fullLog);
    };
    draw();
    return h(
      "details",
      { class: "card journey-trim", open: !!m.cuts?.length },
      h("summary", null, h("strong", null, t("journey.trim.title"))),
      h("p", { class: "muted small" }, t("journey.trim.help")),
      chart,
      h("div", { class: "row" }, fromIn, toIn),
      label,
      h(
        "div",
        { class: "row wrap" },
        button(t("journey.trim.keep"), () => apply([...(m.cuts ?? []), ...keepOnly(from, to, end)]), "primary"),
        button(t("journey.trim.remove"), () => apply([...(m.cuts ?? []), [from, to]]), "secondary"),
        m.cuts?.length ? button(t("journey.trim.undo"), () => apply(undefined), "ghost") : "",
      ),
    );
  };

  const compareValue = (r: CompareRow, x: number | undefined): string => {
    if (x === undefined) return "—";
    switch (r.kind) {
      case "economy":
        return economyText(x);
      case "km":
        return distanceText(x);
      case "L":
        return volumeText(x);
      case "share":
        return `${fmtNum(x * 100, 0)}%`;
      case "time":
        return durationText(x);
      case "count":
        return fmtNum(x, 1);
      case "speed":
        return `${fmtValue("speed", x)} ${unitOf("speed")}`;
      case "trim":
        return `${x > 0 ? "+" : ""}${fmtNum(x, 1)}%`;
      case "money":
        return moneyText(x);
    }
  };

  const renderCompare = (ma: JourneyMeta, la: JourneyLog, mb: JourneyMeta, lb: JourneyLog) => {
    clear(mainBox);
    const a = analysisOf(ma, applyCuts(la, ma.cuts));
    const b = analysisOf(mb, applyCuts(lb, mb.cuts));
    const rows = compare(a, b, journeyCost(ma, a)?.cost, journeyCost(mb, b)?.cost);
    const name = (m: JourneyMeta, k: string) => h("span", null, h("span", { class: "badge" }, k), " ", journeyTitle(m));
    const verdict = (r: CompareRow) => {
      const w = winner(r);
      if (!w) return h("span", { class: "muted" }, "—");
      const pct = advantage(r);
      const who = w.toUpperCase();
      return h("span", { class: "ok-text" }, pct === undefined ? t("journey.compare.betterShort", { who }) : t("journey.compare.better", { who, pct: Math.round(pct) }));
    };
    // Economy per speed band, both trips.
    const froms = [...new Set([...a.bands, ...b.bands].filter((x) => x.kmPerL !== undefined).map((x) => x.from))].sort((x, y) => x - y);
    const bandOf = (x: JourneyAnalysis, f: number) => x.bands.find((z) => z.from === f)?.kmPerL;
    mainBox.append(
      h(
        "section",
        { class: "card" },
        h(
          "div",
          { class: "page-head" },
          h("h2", null, t("journey.compare.title")),
          button(t("journey.back"), () => ((compareIds = null), void renderMain()), "ghost"),
        ),
        h("p", null, name(ma, "A")),
        h("p", null, name(mb, "B")),
        h("p", { class: "muted small" }, t("journey.compare.intro")),
        h(
          "div",
          { class: "table-wrap" },
          h(
            "table",
            { class: "table" },
            h("thead", null, h("tr", null, h("th", null, ""), h("th", null, "A"), h("th", null, "B"), h("th", null, t("journey.compare.result")))),
            h(
              "tbody",
              null,
              rows.map((r) => h("tr", null, h("th", null, t(`journey.compare.rows.${r.id}`)), h("td", null, compareValue(r, r.a)), h("td", null, compareValue(r, r.b)), h("td", null, verdict(r)))),
            ),
          ),
        ),
      ),
      froms.length
        ? section(
            t("journey.bandsTitle"),
            h("p", { class: "muted small" }, t("journey.compare.bandsHelp")),
            h(
              "div",
              { class: "table-wrap" },
              h(
                "table",
                { class: "table" },
                h("thead", null, h("tr", null, h("th", null, ""), h("th", null, `A (${consumption(1)[1]})`), h("th", null, `B (${consumption(1)[1]})`))),
                h(
                  "tbody",
                  null,
                  froms.map((f) => {
                    const band = a.bands.find((z) => z.from === f) ?? b.bands.find((z) => z.from === f)!;
                    return h(
                      "tr",
                      null,
                      h("th", null, band.to === null ? t("journey.bandTop", { from: f }) : t("journey.band", { from: f, to: band.to })),
                      h("td", null, economyText(bandOf(a, f))),
                      h("td", null, economyText(bandOf(b, f))),
                    );
                  }),
                ),
              ),
            ),
          )
        : "",
    );
  };

  async function renderMain(meta?: JourneyMeta, log?: JourneyLog) {
    if (compareIds) {
      const all = await listJourneys();
      const [ma, mb] = compareIds.map((id) => all.find((x) => x.id === id));
      const [la, lb] = await Promise.all([ma && loadLog(ma.id), mb && loadLog(mb.id)]);
      if (ma && mb && la && lb) return renderCompare(ma, la, mb, lb);
      compareIds = null;
    }
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
    on("connection", () => {
      if (!checking) renderNow();
    }),
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
      compareIds = null;
      picked = [];
      void renderMain();
    }),
  ];
  return () => offs.forEach((f) => f());
}
