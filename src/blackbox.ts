// Black box ("caixa-preta"): while the car is being read, the program keeps
// the last 2 minutes in memory. When a new trouble code shows up or the
// check-engine light turns on, it saves those minutes plus the 2 minutes
// after, by itself, as an automatic recording. The logic and the files live
// in Rust (crates/obd-core/src/blackbox.rs, src-tauri/src/blackbox.rs); this
// module keeps the settings, adds the essential parameters to the reading and
// tells the user what happened. Reads only: nothing is written to the car.
import { api, events, type AutoEvent, type BlackBoxNews } from "./api";
import { getLang, pidText, t } from "./i18n";
import { prefs, savePrefs } from "./prefs";
import { emit, on, readKeys, state } from "./store";
import { errorText, toast } from "./ui";

export { ESSENTIAL_KEYS } from "./store";

/** A value outside its alert limits starts a recording at most this often per parameter. */
export const ALERT_COOLDOWN_MS = 10 * 60_000;
const lastAlert = new Map<string, number>();

/** Plain-language name of an event: "Code P0301 (confirmed)", "Check-engine light turned on"... */
export function eventLabel(e: AutoEvent): string {
  switch (e.kind) {
    case "dtc_stored":
      return t("blackbox.event.stored", { code: e.code ?? "" });
    case "dtc_pending":
      return t("blackbox.event.pending", { code: e.code ?? "" });
    case "mil":
      return e.code ? t("blackbox.event.milCode", { code: e.code }) : t("blackbox.event.mil");
    case "alert":
      return t("blackbox.event.alert", { name: e.code ? pidText(e.code).name : "" });
    default:
      return t("blackbox.event.manual");
  }
}

/** Short list of the reasons, for a toast or a list row. */
export function eventsText(list: AutoEvent[]): string {
  return [...new Set(list.map(eventLabel))].join(" · ");
}

/** Tells the Rust side (on connecting and when the setting changes). */
async function sync() {
  if (state.connection !== "connected") return;
  try {
    await api.setBlackbox(state.blackbox, getLang());
  } catch {
    /* the worker may be closing */
  }
}

/** Turns the black box on or off (Settings). */
export async function setBlackboxEnabled(on_: boolean) {
  savePrefs({ blackbox: on_ });
  state.blackbox = on_;
  await sync();
  // The essential parameters join or leave the reading at once.
  if (state.polling) {
    try {
      await api.setLive(readKeys(), true);
    } catch {
      /* ignore */
    }
  }
  emit("blackbox");
}

/** "Save the last 2 minutes" button. */
export async function saveLastMinutes() {
  try {
    const r = await api.blackboxSaveNow();
    toast(t(r === "added" ? "blackbox.addedToFault" : "blackbox.savingNow"), "ok");
  } catch (e) {
    toast(errorText(e), "error");
  }
}

/** Called by alerts.ts when a value leaves its limits. */
export function alertTriggered(key: string, now = Date.now()) {
  const p = prefs();
  if (!state.blackbox || !p.blackboxAlerts || state.playback || state.connection !== "connected") return;
  const last = lastAlert.get(key);
  if (last !== undefined && now - last < ALERT_COOLDOWN_MS) return;
  lastAlert.set(key, now);
  void api.blackboxAlert(key).catch(() => undefined);
}

function news(n: BlackBoxNews) {
  const what = eventsText(n.events);
  if (n.state === "fault") {
    toast(t(n.inRecording ? "blackbox.faultInRecording" : "blackbox.fault", { what }), "error");
  } else if (n.state === "saved") {
    toast(t("blackbox.saved", { what }), "ok");
  } else {
    toast(t("blackbox.saveFailed"), "error");
  }
  emit("blackbox");
}

/** After the user stops a recording in which faults were noticed. */
export function recordingStoppedNotice(list: AutoEvent[]) {
  const faults = list.filter((e) => e.kind !== "manual");
  if (faults.length) toast(t("blackbox.stoppedWithFaults", { what: eventsText(faults) }), "info");
}

export function initBlackbox() {
  state.blackbox = prefs().blackbox;
  let wasConnected = false;
  on("connection", () => {
    const now = state.connection === "connected";
    if (now && !wasConnected) {
      lastAlert.clear();
      void sync();
    }
    wasConnected = now;
  });
  // The language of the saved code descriptions follows the program's.
  on("units", () => void sync());
  void events.blackbox(news);
}
