// Threshold alerts: warn once when a value leaves its safe range, with an
// optional beep, and again only after it has come back (hysteresis).
import { pidText, t } from "./i18n";
import { emit, on, state } from "./store";
import { prefs, profile } from "./prefs";
import { fmtValue, toast, unitOf } from "./ui";
import { isSeeking } from "./playback";

/** Keys currently outside their limits. */
export const activeAlerts = new Set<string>();

let audio: AudioContext | null = null;

function beep() {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.35);
  } catch {
    /* no audio device */
  }
}

function check() {
  const p = prefs();
  if (!p.alertsEnabled) {
    if (activeAlerts.size) {
      activeAlerts.clear();
      emit("alerts");
    }
    return;
  }
  let changed = false;
  for (const rule of profile().alerts) {
    if (!rule.enabled) continue;
    const v = state.latest[rule.key];
    if (v === undefined) continue;
    // Battery below the limit is normal while cranking: ignore when the
    // engine is off or the starter is turning.
    if (rule.key === "battery_voltage" && rule.below !== null && v < rule.below && (state.latest.rpm ?? 0) < 500) continue;
    const out = (rule.above !== null && v > rule.above) || (rule.below !== null && v < rule.below);
    // Hysteresis: leave the alert state only 2% inside the limit.
    const margin = Math.max(Math.abs(rule.above ?? rule.below ?? 0) * 0.02, 0.1);
    const back =
      (rule.above === null || v < rule.above - margin) && (rule.below === null || v > rule.below + margin);
    if (out && !activeAlerts.has(rule.key)) {
      activeAlerts.add(rule.key);
      changed = true;
      // A jump in a replay passes over old values: no toast or beep for them.
      if (isSeeking()) continue;
      const limit = rule.above !== null && v > rule.above ? rule.above : rule.below!;
      toast(
        t("alerts.toast", { name: pidText(rule.key).name, value: `${fmtValue(rule.key, v)} ${unitOf(rule.key)}`, limit: `${fmtValue(rule.key, limit)} ${unitOf(rule.key)}` }),
        "error",
      );
      if (p.alertSound) beep();
    } else if (back && activeAlerts.has(rule.key)) {
      activeAlerts.delete(rule.key);
      changed = true;
    }
  }
  if (changed) emit("alerts");
}

export function initAlerts() {
  on("frame", check);
  on("connection", () => {
    if (state.connection !== "connected" && activeAlerts.size) {
      activeAlerts.clear();
      emit("alerts");
    }
  });
}
