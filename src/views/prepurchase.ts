// Pre-purchase check screen: a five-step assistant for looking at a used car
// before buying it, ending in a traffic light and a printable report.
//
// 1. Car data   – name, VIN from the document, dashboard distance (typed).
// 2. Engine off – VIN, codes, readiness, "since codes were cleared"
//                 counters, odometer, battery at rest, ECU scan.
// 3. Start/idle – cranking voltage, then 3 minutes of idle: charging, fuel
//                 trims, live findings; Mode 06 and the codes again after.
// 4. Test drive – optional recording, analysed like any recording.
// 5. Result     – lights per item (prepurchase.ts), history, report.
//
// Only reads: nothing is written to the car. The grading rules live in
// ../prepurchase.ts; this file gathers the reads and draws the screen.
import { api, type DtcInfo, type FreezeFrame } from "../api";
import { fmtNum, getLang, pidText, t } from "../i18n";
import { freshValue, isSupported, on, state } from "../store";
import { BatteryTest } from "../battery";
import {
  IdleCollector,
  SECTIONS,
  compareChecks,
  deleteCheck,
  evaluate,
  loadChecks,
  missingKeyItems,
  normalizeVin,
  overall,
  saveCheck,
  type CheckData,
  type CheckItem,
  type Light,
  type SavedCheck,
} from "../prepurchase";
import { fromDisplay, displayUnit } from "../units";
import { diagnosticsSaved } from "../recording-diagnostics";
import { busy, button, clear, errorText, fmtValue, h, infoTip, notConnected, toast, unitOf } from "../ui";
import { focusPolling } from "./guided";
import { toggleRecording } from "./dashboard";
import { openReport } from "./sessions";
import { buildPrepurchaseHtml, itemDetails, itemText } from "./prepurchase-report";

type Step = "info" | "off" | "idle" | "drive" | "result";
const STEPS: Step[] = ["info", "off", "idle", "drive", "result"];

/** Seconds of idle the check waits for, and the least before "finish now". */
export const IDLE_S = 180;
const IDLE_MIN_S = 60;

const COUNTERS = ["distance_mil", "time_with_mil", "warmups_since_clear", "distance_since_clear", "time_since_clear", "odometer"];
const IDLE_KEYS = ["rpm", "coolant_temp", "stft_b1", "ltft_b1", "stft_b2", "ltft_b2", "closed_loop_b1"];

interface Run {
  id: string;
  name: string;
  step: Step;
  data: CheckData;
  /** Code descriptions for the report, by code. */
  dtcText: Record<string, string>;
  freeze?: FreezeFrame;
  /** Steps already done (or skipped). */
  done: Set<Step>;
}

/** The check in progress survives leaving the screen (not closing the app). */
let run: Run | null = null;
/** A saved check opened from the history. */
let viewing: SavedCheck | null = null;

const newRun = (): Run => ({ id: String(Date.now()), name: "", step: "info", data: {}, dtcText: {}, done: new Set() });

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  let cleanup: (() => void) | void;
  const draw = () => {
    cleanup?.();
    cleanup = undefined;
    clear(page);
    page.append(h("h1", null, t("prepurchase.title")));
    if (viewing) cleanup = savedView(page, viewing, draw);
    else if (!run) cleanup = startView(page, draw);
    else cleanup = stepView(page, run, draw);
  };
  draw();
  const offConn = on("connection", () => {
    // Steps that read the car show "not connected" when the link ends.
    if (run && run.step !== "info" && run.step !== "result" && state.connection !== "connected" && !state.link) draw();
  });
  return () => {
    offConn();
    cleanup?.();
  };
}

// ---------------------------------------------------------------------------
// Shared pieces

const LIGHT_CLASS: Record<Light, string> = { ok: "badge-ok", warn: "badge-warn", bad: "badge-danger", unknown: "" };

function lightBadge(l: Light): HTMLElement {
  return h("span", { class: `badge ${LIGHT_CLASS[l]}` }, t(`prepurchase.light.${l}`));
}

function stepper(current: Step, done: Set<Step>): HTMLElement {
  return h(
    "ol",
    { class: "pp-stepper", "aria-label": t("prepurchase.stepsLabel") },
    STEPS.map((s) =>
      h(
        "li",
        { class: s === current ? "current" : done.has(s) ? "done" : "todo", "aria-current": s === current ? "step" : undefined },
        t(`prepurchase.steps.${s}.short`),
      ),
    ),
  );
}

function itemList(items: CheckItem[], dtcText: Record<string, string>): HTMLElement {
  const box = h("div", { class: "pp-sections" });
  for (const sec of SECTIONS) {
    const list = items.filter((i) => i.section === sec);
    if (!list.length) continue;
    box.append(
      h(
        "section",
        { class: "card" },
        h("h2", null, t(`prepurchase.sections.${sec}`)),
        h(
          "ul",
          { class: "pp-items" },
          list.map((i) => {
            const details = itemDetails(i, dtcText);
            return h(
              "li",
              { class: `pp-item pp-${i.light}` },
              h("div", { class: "pp-item-head" }, lightBadge(i.light), " ", h("strong", null, t(`prepurchase.items.${i.id}.title`)), " ", infoTip(t(`prepurchase.items.${i.id}.help`))),
              h("p", null, itemText(i)),
              details.length ? h("ul", { class: "muted small" }, details.map((d) => h("li", null, d))) : null,
            );
          }),
        ),
      ),
    );
  }
  return box;
}

function summaryCard(items: CheckItem[]): HTMLElement {
  const l = overall(items);
  const missing = missingKeyItems(items);
  const counts = (["bad", "warn", "ok", "unknown"] as Light[]).map((x) => [x, items.filter((i) => i.light === x).length] as const);
  return h(
    "section",
    { class: `card pp-summary pp-${l}` },
    h("div", { class: "pp-light", "aria-hidden": "true" }, h("span", { class: "red" }), h("span", { class: "yellow" }), h("span", { class: "green" })),
    h(
      "div",
      null,
      h("h2", null, t(`prepurchase.overall.${l}.title`)),
      h("p", null, t(`prepurchase.overall.${l}.text`)),
      h("p", { class: "muted small" }, counts.filter(([, n]) => n).map(([x, n]) => `${t(`prepurchase.light.${x}`)}: ${n}`).join(" · ")),
      missing.length ? h("p", { class: "warn-text small" }, t("prepurchase.missing", { items: missing.map((id) => t(`prepurchase.items.${id}.title`)).join(", ") })) : null,
    ),
  );
}

function limitsCard(): HTMLElement {
  return h(
    "section",
    { class: "card" },
    h("h2", null, t("prepurchase.limits.title")),
    h("ul", null, ["odometer", "systems", "history", "notAll", "prepared"].map((k) => h("li", null, t(`prepurchase.limits.${k}`)))),
    h("p", null, h("strong", null, t("prepurchase.limits.next"))),
  );
}

const fmtDate = (ms: number) => new Date(ms).toLocaleString(getLang(), { dateStyle: "short", timeStyle: "short" });

// ---------------------------------------------------------------------------
// Start: what the check does, its limits and the saved checks

function startView(page: HTMLElement, draw: () => void) {
  page.append(
    h("p", { class: "lead" }, t("prepurchase.intro")),
    h(
      "section",
      { class: "card" },
      h("h2", null, t("prepurchase.howTitle")),
      h("ol", null, STEPS.map((s) => h("li", null, h("strong", null, t(`prepurchase.steps.${s}.short`)), " — ", t(`prepurchase.steps.${s}.summary`)))),
      h("p", { class: "muted small" }, t("prepurchase.needs")),
      h(
        "div",
        { class: "actions" },
        button(t("prepurchase.start"), () => {
          run = newRun();
          draw();
        }, "primary"),
      ),
    ),
    limitsCard(),
    historyCard(draw),
  );
}

let compareIds: string[] = [];

function historyCard(draw: () => void): HTMLElement {
  const checks = loadChecks().reverse();
  const card = h("section", { class: "card" }, h("h2", null, t("prepurchase.history.title")));
  if (!checks.length) {
    card.append(h("p", { class: "muted" }, t("prepurchase.history.empty")));
    return card;
  }
  compareIds = compareIds.filter((id) => checks.some((c) => c.id === id));
  const compareBox = h("div");
  const renderCompare = () => {
    clear(compareBox);
    const chosen = compareIds.map((id) => checks.find((c) => c.id === id)!).filter(Boolean);
    if (chosen.length < 2) {
      compareBox.append(h("p", { class: "muted small" }, t("prepurchase.history.compareHint")));
      return;
    }
    compareBox.append(
      h("h3", null, t("prepurchase.history.compareTitle")),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "table" },
          h("thead", null, h("tr", null, h("th", null, t("prepurchase.history.item")), chosen.map((c) => h("th", null, c.name || fmtDate(c.at))))),
          h(
            "tbody",
            null,
            h("tr", null, h("th", { scope: "row" }, t("prepurchase.history.overall")), chosen.map((c) => h("td", null, lightBadge(c.light)))),
            compareChecks(chosen).map((r) =>
              h("tr", null, h("th", { scope: "row" }, t(`prepurchase.items.${r.id}.title`)), r.lights.map((l) => h("td", null, lightBadge(l)))),
            ),
          ),
        ),
      ),
    );
  };
  card.append(
    h("p", { class: "muted small" }, t("prepurchase.history.intro")),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table" },
        h(
          "thead",
          null,
          h("tr", null, [t("prepurchase.history.compare"), t("prepurchase.history.date"), t("prepurchase.history.name"), t("prepurchase.history.overall"), ""].map((c) => h("th", null, c))),
        ),
        h(
          "tbody",
          null,
          checks.map((c) =>
            h(
              "tr",
              null,
              h(
                "td",
                null,
                h("input", {
                  type: "checkbox",
                  "aria-label": t("prepurchase.history.compare"),
                  checked: compareIds.includes(c.id),
                  onchange: (ev: Event) => {
                    const on_ = (ev.target as HTMLInputElement).checked;
                    compareIds = on_ ? [...compareIds, c.id].slice(-3) : compareIds.filter((x) => x !== c.id);
                    draw();
                  },
                }),
              ),
              h("td", null, fmtDate(c.at)),
              h("td", null, h("strong", null, c.name || "—"), c.vin ? h("div", { class: "muted small mono" }, c.vin) : null),
              h("td", null, lightBadge(c.light)),
              h(
                "td",
                { class: "actions" },
                button(t("prepurchase.history.open"), () => {
                  viewing = c;
                  draw();
                }, "ghost"),
                button(t("prepurchase.history.delete"), () => {
                  if (!confirm(t("prepurchase.history.deleteConfirm", { name: c.name || fmtDate(c.at) }))) return;
                  deleteCheck(c.id);
                  draw();
                }, "ghost"),
              ),
            ),
          ),
        ),
      ),
    ),
    compareBox,
  );
  renderCompare();
  return card;
}

function savedView(page: HTMLElement, c: SavedCheck, draw: () => void) {
  page.append(
    h("p", { class: "lead" }, t("prepurchase.savedLead", { name: c.name || "—", date: fmtDate(c.at) })),
    h(
      "div",
      { class: "actions" },
      button(t("prepurchase.reportButton"), () => openReport(buildPrepurchaseHtml(c, state.appVersion), "obd2-pre-compra"), "primary"),
      button(t("prepurchase.back"), () => {
        viewing = null;
        draw();
      }, "ghost"),
    ),
    summaryCard(c.items),
    itemList(c.items, c.dtcText ?? {}),
    limitsCard(),
  );
}

// ---------------------------------------------------------------------------
// Steps

function stepView(page: HTMLElement, r: Run, draw: () => void): (() => void) | void {
  page.append(stepper(r.step, r.done));
  const box = h("div");
  const footer = h(
    "div",
    { class: "actions pp-cancel" },
    button(t("prepurchase.cancel"), () => {
      if (r.step !== "result" && !confirm(t("prepurchase.cancelConfirm"))) return;
      run = null;
      draw();
    }, "ghost"),
  );
  page.append(box);
  if (r.step !== "result") page.append(footer);
  const go = (next: Step, finished: Step = r.step) => {
    r.done.add(finished);
    r.step = next;
    draw();
  };
  const needsCar = r.step === "off" || r.step === "idle" || r.step === "drive";
  if (needsCar && state.playback) {
    box.append(h("div", { class: "alert" }, h("p", null, t("guided.needsLive"))));
    return;
  }
  if (needsCar && state.connection !== "connected") {
    box.append(
      notConnected(),
      h("div", { class: "actions" }, button(t("prepurchase.toResult"), () => go("result"), "ghost")),
    );
    return;
  }
  switch (r.step) {
    case "info":
      return infoStep(box, r, go);
    case "off":
      return offStep(box, r, go);
    case "idle":
      return idleStep(box, r, go);
    case "drive":
      return driveStep(box, r, go);
    case "result":
      return resultStep(box, r, draw);
  }
}

type Go = (next: Step, finished?: Step) => void;

function stepHeader(step: Step): HTMLElement[] {
  return [h("h2", null, t(`prepurchase.steps.${step}.title`)), h("p", { class: "muted" }, t(`prepurchase.steps.${step}.intro`))];
}

// 1. Car data --------------------------------------------------------------

function infoStep(box: HTMLElement, r: Run, go: Go) {
  const nameIn = h("input", { type: "text", value: r.name, maxlength: 60, placeholder: t("prepurchase.info.namePlaceholder") });
  const vinIn = h("input", { type: "text", value: r.data.docVin ?? "", maxlength: 25, class: "mono", autocomplete: "off", spellcheck: false, placeholder: "9BW…" });
  const dashUnit = displayUnit("km");
  const kmIn = h("input", { type: "number", min: 0, step: 1, inputmode: "numeric", value: r.data.dashKm === undefined ? "" : String(Math.round(r.data.dashKm * (dashUnit === "km" ? 1 : 0.621371))) });
  const vinMsg = h("p", { class: "small", "aria-live": "polite" });
  const checkVin = () => {
    const raw = vinIn.value.trim();
    if (!raw) {
      vinMsg.className = "muted small";
      vinMsg.textContent = t("prepurchase.info.vinOptional");
      return true;
    }
    const v = normalizeVin(raw);
    vinMsg.className = v ? "ok-text small" : "warn-text small";
    vinMsg.textContent = v ? t("prepurchase.info.vinOk", { vin: v }) : t("prepurchase.info.vinBad", { n: raw.replace(/[\s-]/g, "").length });
    return !!v;
  };
  vinIn.addEventListener("input", checkVin);
  checkVin();
  const field = (label: string, input: HTMLElement, help: string, extra?: HTMLElement) =>
    h("label", { class: "pp-field" }, h("span", null, label, " ", infoTip(help)), input, extra ?? null);
  box.append(
    h(
      "section",
      { class: "card" },
      ...stepHeader("info"),
      h(
        "div",
        { class: "pp-form" },
        field(t("prepurchase.info.name"), nameIn, t("prepurchase.info.nameHelp")),
        field(t("prepurchase.info.vin"), vinIn, t("prepurchase.info.vinHelp"), vinMsg),
        field(t("prepurchase.info.km", { unit: dashUnit }), kmIn, t("prepurchase.info.kmHelp")),
      ),
      h(
        "div",
        { class: "actions" },
        button(t("prepurchase.next"), () => {
          if (!checkVin()) {
            vinIn.focus();
            return;
          }
          r.name = nameIn.value.trim();
          r.data.docVin = normalizeVin(vinIn.value) ?? undefined;
          const km = Number(kmIn.value);
          r.data.dashKm = kmIn.value.trim() && Number.isFinite(km) && km >= 0 ? fromDisplay("km", km) : undefined;
          go("off");
        }, "primary"),
      ),
    ),
  );
}

// 2. Engine off --------------------------------------------------------------

const isDemo = () => !!state.adapter?.transport.startsWith("Demo");

async function demoCommand(cmd: "ATSIMOFF" | "ATSIMON") {
  try {
    await api.sendRaw(cmd, 1000);
    state.demoEngineOff = cmd === "ATSIMOFF";
  } catch (e) {
    toast(errorText(e), "error");
  }
}

function offStep(box: HTMLElement, r: Run, go: Go) {
  const lang = getLang();
  const progress = h("ul", { class: "pp-reads" });
  const resultEl = h("div");
  const line = (key: string) => {
    const li = h("li", { class: "pending" }, t(`prepurchase.off.reads.${key}`));
    progress.append(li);
    return (ok: boolean | "skip", note?: string) => {
      li.className = ok === true ? "done" : ok === "skip" ? "skip" : "failed";
      if (note) li.append(h("span", { class: "muted small" }, ` — ${note}`));
    };
  };
  const attempt = async <T>(key: string, read: () => Promise<T>, note?: (v: T) => string | undefined): Promise<T | undefined> => {
    const end = line(key);
    try {
      const v = await read();
      end(true, note?.(v));
      return v;
    } catch (e) {
      end(false, errorText(e));
      return undefined;
    }
  };

  const readAll = async () => {
    clear(progress);
    clear(resultEl);
    const d = r.data;
    const counters = await attempt("counters", () => api.readPids([...COUNTERS, "rpm"]), (v) => t("prepurchase.off.countersFound", { n: Object.keys(v).filter((k) => k !== "rpm").length }));
    d.counters = counters ? Object.fromEntries(Object.entries(counters).filter(([k]) => k !== "rpm")) : undefined;
    d.engineWasRunning = (counters?.rpm ?? 0) > 300;
    const vehicle = await attempt("vehicle", api.readVehicleInfo, (v) => v.identity.vin ?? t("prepurchase.off.noVin"));
    if (vehicle) {
      state.vehicle = vehicle;
      d.ecuVin = vehicle.identity.vin;
      d.restV = vehicle.batteryVoltage ?? undefined;
    }
    const dtcs = await attempt("dtcs", () => api.readDtcs(lang), (v) => t("prepurchase.off.codesFound", { n: v.stored.length + v.pending.length + v.permanent.length }));
    if (dtcs) {
      state.dtcs = dtcs;
      d.dtcs = dtcs;
      rememberCodes(r, [...dtcs.stored, ...dtcs.pending, ...dtcs.permanent]);
    }
    if (dtcs?.stored.length) {
      r.freeze = await attempt("freeze", () => api.readFreezeFrame(lang));
      if (r.freeze) state.freeze = r.freeze;
    }
    const readiness = await attempt("readiness", api.readReadiness);
    if (readiness) {
      state.readiness = readiness;
      d.readiness = readiness;
    }
    const units = await attempt("units", api.scanEcus, (v) => t("prepurchase.off.unitsFound", { n: v.length }));
    if (units) {
      state.ecus = units;
      d.units = units.map((u) => ({ address: u.address, role: u.role, vin: u.vin ?? u.ids.find((i) => i.key === "vin")?.value ?? null }));
    }
    showResult();
  };

  const showResult = () => {
    clear(resultEl);
    const d = r.data;
    if (!d.counters && !d.dtcs && !d.readiness) return;
    if (d.engineWasRunning) resultEl.append(h("div", { class: "alert alert-warning" }, h("p", null, t("prepurchase.off.engineRunning"))));
    const quick = evaluate(d).filter((i) => ["vin_match", "odometer", "recent_clear", "readiness", "mil_distance", "permanent", "stored", "pending", "battery_rest"].includes(i.id));
    resultEl.append(
      h("h3", null, t("prepurchase.off.firstLook")),
      h("ul", { class: "pp-items compact" }, quick.map((i) => h("li", { class: `pp-item pp-${i.light}` }, lightBadge(i.light), " ", h("strong", null, t(`prepurchase.items.${i.id}.title`)), ": ", itemText(i)))),
      h("p", { class: "muted small" }, t("prepurchase.off.afterLook")),
    );
  };

  const readBtn: HTMLButtonElement = button(t(r.data.dtcs ? "prepurchase.off.readAgain" : "prepurchase.off.read"), () => busy(readBtn, readAll), "primary");
  const demoEl = h("div", { class: "actions" });
  if (isDemo() && !state.demoEngineOff) {
    const b: HTMLButtonElement = button(t("battery.demo.stop"), async () => {
      await demoCommand("ATSIMOFF");
      b.remove();
    }, "ghost");
    demoEl.append(b);
  }
  box.append(
    h(
      "section",
      { class: "card" },
      ...stepHeader("off"),
      h("ol", null, ["a", "b", "c"].map((k) => h("li", null, t(`prepurchase.off.do.${k}`)))),
      demoEl,
      h("div", { class: "actions" }, readBtn),
      progress,
      resultEl,
      h(
        "div",
        { class: "actions" },
        button(t("prepurchase.back"), () => go("info", "off"), "ghost"),
        button(t("prepurchase.next"), () => {
          if (!r.data.dtcs && !r.data.counters && !confirm(t("prepurchase.off.skipConfirm"))) return;
          go("idle");
        }, "primary"),
      ),
    ),
  );
  showResult();
}

function rememberCodes(r: Run, list: DtcInfo[]) {
  for (const c of list) if (c.description) r.dtcText[c.code] = c.description;
}

// 3. Start and idle --------------------------------------------------------

function idleStep(box: HTMLElement, r: Run, go: Go): () => void {
  const polling = focusPolling();
  const battery = new BatteryTest();
  const idle = new IdleCollector();
  let vKey = "battery_voltage";
  /** "start": waiting for the engine to start; "idle": counting; "reading": Mode 06 and codes. */
  let phase: "start" | "idle" | "reading" | "done" = "start";
  let steadyHigh = 0;
  let finished = false;

  const statusEl = h("div");
  const liveEl = h("p", { class: "muted small" });
  const finishBtn: HTMLButtonElement = button(t("prepurchase.idle.finishNow"), () => void finish(), "secondary");
  const demoEl = h("div", { class: "actions" });

  const keys = () => (phase === "start" ? [vKey] : [vKey, ...IDLE_KEYS.filter((k) => k === "rpm" || isSupported(k))]);

  const render = () => {
    clear(statusEl);
    const st = battery.status();
    if (phase === "start") {
      statusEl.append(
        h("h3", null, t("prepurchase.idle.waitStart")),
        h("p", null, t(st.step === "rest" ? "prepurchase.idle.measuringRest" : "prepurchase.idle.startNow")),
        st.progress > 0 && st.step === "rest" ? h("progress", { max: 1, value: st.progress }) : "",
      );
    } else if (phase === "idle") {
      const s = idle.elapsed(state.lastFrameT);
      statusEl.append(
        h("h3", null, t("prepurchase.idle.idling")),
        h("p", null, t("prepurchase.idle.keepIdling", { s: Math.max(0, Math.round(IDLE_S - s)) })),
        h("progress", { max: 1, value: Math.min(1, s / IDLE_S) }),
      );
      finishBtn.disabled = s < IDLE_MIN_S;
    } else {
      statusEl.append(h("h3", null, t("prepurchase.idle.reading")));
    }
    const crankR = battery.result.crank;
    if (crankR) statusEl.append(h("p", { class: "muted small" }, t("prepurchase.idle.crankSeen", { v: fmtNum(crankR.volts, 2) })));
    finishBtn.hidden = phase !== "idle";
    renderDemo();
  };

  let demoShown = "";
  const renderDemo = () => {
    const id = `${phase}:${battery.step}:${state.demoEngineOff}`;
    if (!isDemo() || id === demoShown) return;
    demoShown = id;
    clear(demoEl);
    if (phase === "start" && state.demoEngineOff && battery.step !== "rest")
      demoEl.append(button(t("battery.demo.start"), () => void demoCommand("ATSIMON").then(render), "ghost"));
    if (phase === "start" && !state.demoEngineOff) demoEl.append(button(t("battery.demo.stop"), () => void demoCommand("ATSIMOFF").then(render), "ghost"));
  };

  const startIdle = () => {
    phase = "idle";
    void polling.set(keys());
  };

  const finish = async () => {
    if (finished) return;
    finished = true;
    phase = "reading";
    render();
    const d = r.data;
    d.idle = idle.result(state.lastFrameT);
    d.idleV = battery.result.idle?.volts ?? battery.result.loaded?.volts ?? d.idleV;
    if (battery.result.rest && !d.engineWasRunning) d.restV = battery.result.rest.volts;
    const c = battery.result.crank;
    if (c !== undefined) d.crank = c && { volts: c.volts, samples: c.samples };
    polling.restore();
    const lang = getLang();
    try {
      d.mode06 = await api.readMode06();
      state.mode06 = d.mode06;
    } catch {
      /* not every car answers Mode 06 */
    }
    try {
      d.dtcsAfter = await api.readDtcs(lang);
      rememberCodes(r, [...d.dtcsAfter.stored, ...d.dtcsAfter.pending, ...d.dtcsAfter.permanent]);
    } catch {
      /* kept from the first read */
    }
    phase = "done";
    go("drive", "idle");
  };

  const onFrame = () => {
    const tS = state.lastFrameT;
    const v = freshValue(vKey);
    const rpm = freshValue("rpm");
    liveEl.textContent = [
      v === undefined ? null : `${fmtNum(v, 2)} V`,
      rpm === undefined ? null : `${fmtNum(rpm, 0)} rpm`,
      state.latest.coolant_temp === undefined ? null : `${pidText("coolant_temp").short} ${fmtValue("coolant_temp", state.latest.coolant_temp)} ${unitOf("coolant_temp")}`,
      t("guided.rate", { rate: fmtNum(state.rateHz, 1) }),
    ]
      .filter(Boolean)
      .join(" · ");
    if (tS === undefined || phase === "reading" || phase === "done") return;
    if (v !== undefined) {
      if (phase === "start") {
        // Engine already running when the step opened: no start to measure.
        if (battery.step === "rest" && v >= 13.0) steadyHigh++;
        else steadyHigh = 0;
        if (steadyHigh >= 6) {
          // Past the rest and the start: straight to the idle measurement.
          battery.skip();
          battery.skip();
          startIdle();
        }
      }
      battery.push(tS, v, rpm);
    }
    if (phase === "start" && (battery.step === "charge" || battery.step === "done")) startIdle();
    if (phase === "idle") {
      idle.push(tS, {
        rpm,
        coolant: freshValue("coolant_temp") ?? state.latest.coolant_temp,
        stft1: freshValue("stft_b1"),
        ltft1: freshValue("ltft_b1"),
        stft2: freshValue("stft_b2"),
        ltft2: freshValue("ltft_b2"),
        closedLoop: freshValue("closed_loop_b1"),
      });
      if (idle.elapsed(tS) >= IDLE_S) void finish();
    }
    render();
  };
  const onDropped = () => {
    if (state.lastDropped.includes(vKey) && vKey === "battery_voltage" && isSupported("module_voltage")) {
      vKey = "module_voltage";
      void polling.set(keys());
    }
  };
  const onFindings = () => {
    if (phase === "idle") idle.addFindings(state.findings);
  };
  const onLink = () => {
    if (state.link?.state === "recovering" || state.link?.state === "reconnecting") battery.adapterReset();
  };

  box.append(
    h(
      "section",
      { class: "card" },
      ...stepHeader("idle"),
      h("div", { class: "alert alert-warning" }, h("p", null, t("prepurchase.idle.safety"))),
      h("ol", null, ["a", "b", "c"].map((k) => h("li", null, t(`prepurchase.idle.do.${k}`, { min: IDLE_S / 60 })))),
      statusEl,
      liveEl,
      demoEl,
      h(
        "div",
        { class: "actions" },
        finishBtn,
        button(t("prepurchase.skipStep"), () => {
          finished = true;
          polling.restore();
          go("drive", "idle");
        }, "ghost"),
      ),
    ),
  );
  render();
  void polling.set(keys());
  const offs = [on("frame", onFrame), on("frame", onDropped), on("findings", onFindings), on("link", onLink)];
  return () => {
    offs.forEach((f) => f());
    if (!finished) polling.restore();
  };
}

// 4. Test drive ------------------------------------------------------------

function driveStep(box: HTMLElement, r: Run, go: Go): () => void {
  const statusEl = h("div");
  const ownRecording = () => state.recording.recording && driveStartedAt !== null && state.recording.startedAtUnixMs === driveStartedAt;
  let driveStartedAt: number | null = r.data.drive ? null : (driveRecording ?? null);

  const render = () => {
    clear(statusEl);
    if (ownRecording()) {
      const s = (Date.now() - (driveStartedAt ?? Date.now())) / 1000;
      statusEl.append(
        h("p", null, h("span", { class: "pp-rec-dot", "aria-hidden": "true" }), " ", t("prepurchase.drive.recording", { min: fmtNum(s / 60, 0) })),
        button(t("prepurchase.drive.stop"), (ev) => void busy(ev.currentTarget as HTMLButtonElement, stop), "primary"),
      );
    } else if (state.recording.recording) {
      statusEl.append(h("p", { class: "warn-text" }, t("prepurchase.drive.otherRecording")));
    } else {
      statusEl.append(
        h(
          "div",
          { class: "actions" },
          button(t("prepurchase.drive.start"), (ev) => void busy(ev.currentTarget as HTMLButtonElement, start), "primary"),
          button(t("prepurchase.drive.skip"), () => {
            r.data.drive = undefined;
            go("result", "drive");
          }, "ghost"),
        ),
      );
    }
  };

  const start = async () => {
    await toggleRecording();
    driveStartedAt = state.recording.startedAtUnixMs;
    driveRecording = driveStartedAt;
    render();
  };

  const stop = async () => {
    if (ownRecording()) await toggleRecording();
    driveRecording = null;
    await diagnosticsSaved();
    const rep = await api.recordingReport();
    const end = rep.diagnostics.length > 1 ? rep.diagnostics[rep.diagnostics.length - 1] : undefined;
    const coolant = rep.stats.find((s) => s.key === "coolant_temp");
    r.data.drive = {
      seconds: Math.round(rep.duration_s),
      findings: rep.findings.map((f) => ({ id: f.id, severity: f.severity, values: f.values })),
      maxCoolant: coolant?.max,
    };
    if (end?.dtcs) {
      r.data.dtcsAfter = end.dtcs;
      rememberCodes(r, [...end.dtcs.stored, ...end.dtcs.pending, ...end.dtcs.permanent]);
    }
    if (end?.readiness) r.data.readiness = end.readiness;
    go("result", "drive");
  };

  box.append(
    h(
      "section",
      { class: "card" },
      ...stepHeader("drive"),
      h("div", { class: "alert alert-warning" }, h("p", null, t("prepurchase.drive.safety"))),
      h("ol", null, ["a", "b", "c", "d"].map((k) => h("li", null, t(`prepurchase.drive.do.${k}`)))),
      statusEl,
    ),
  );
  render();
  const tick = setInterval(render, 15_000);
  const offs = [on("recording", render)];
  return () => {
    clearInterval(tick);
    offs.forEach((f) => f());
  };
}

/** Start time of the test-drive recording, kept while the screen is left. */
let driveRecording: number | null = null;

// 5. Result ----------------------------------------------------------------

function resultStep(box: HTMLElement, r: Run, draw: () => void) {
  const items = evaluate(r.data);
  const saved: SavedCheck = {
    id: r.id,
    at: Date.now(),
    name: r.name,
    vin: r.data.docVin ?? r.data.ecuVin ?? undefined,
    dashKm: r.data.dashKm,
    light: overall(items),
    items,
    dtcText: r.dtcText,
  };
  saveCheck(saved);
  r.done.add("result");
  box.append(
    h("p", { class: "muted small" }, t("prepurchase.result.saved")),
    h(
      "div",
      { class: "actions" },
      button(t("prepurchase.reportButton"), () => openReport(buildPrepurchaseHtml(saved, state.appVersion), "obd2-pre-compra"), "primary"),
      button(t("prepurchase.result.newCheck"), () => {
        run = newRun();
        draw();
      }, "secondary"),
      button(t("prepurchase.result.backStart"), () => {
        run = null;
        draw();
      }, "ghost"),
    ),
    summaryCard(items),
    itemList(items, r.dtcText),
    limitsCard(),
  );
}
