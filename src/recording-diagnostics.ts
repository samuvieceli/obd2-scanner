// Diagnostic reads saved with each recording, so its report can be made
// later from the file alone: vehicle data, trouble codes with the freeze
// frame, readiness and Mode 06 at the start, and the codes and readiness
// again at the end (a code can appear during the trip). Reads only: nothing
// is written to the car.
import { api, type DiagnosticSnapshot } from "./api";
import { getLang } from "./i18n";
import { emit, state } from "./store";

let pending: Promise<void> = Promise.resolve();
let running = 0;

/** True while codes, readiness... are being read for a recording. */
export function savingDiagnostics(): boolean {
  return running > 0;
}

/** Waits for reads still being saved (the report needs them). */
export function diagnosticsSaved(): Promise<void> {
  return pending;
}

/** Each read is optional: a car or adapter that does not answer one just
 * leaves that part out. */
async function attempt<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

async function capture(moment: "start" | "end", startedAt: number) {
  const lang = getLang();
  const snap: DiagnosticSnapshot = {};
  if (moment === "start") {
    snap.vehicle = await attempt(api.readVehicleInfo);
    if (snap.vehicle) state.vehicle = snap.vehicle;
  }
  snap.dtcs = await attempt(() => api.readDtcs(lang));
  if (snap.dtcs) state.dtcs = snap.dtcs;
  if (moment === "start") {
    snap.freeze = await attempt(() => api.readFreezeFrame(lang));
    if (snap.freeze) state.freeze = snap.freeze;
  }
  snap.readiness = await attempt(api.readReadiness);
  if (snap.readiness) state.readiness = snap.readiness;
  if (moment === "start") {
    snap.mode06 = await attempt(api.readMode06);
    if (snap.mode06) state.mode06 = snap.mode06;
  }
  if (Object.keys(snap).length) await attempt(() => api.addRecordingDiagnostics(startedAt, snap));
}

/** Starts saving the reads for `moment` in the background. */
export function saveDiagnostics(moment: "start" | "end") {
  const startedAt = state.recording.startedAtUnixMs;
  if (startedAt == null || state.connection !== "connected" || state.playback) return;
  // One after the other: the start reads finish before the end ones.
  running++;
  emit("recording");
  pending = pending
    .then(() => capture(moment, startedAt))
    .finally(() => {
      running--;
      emit("recording");
    });
}
