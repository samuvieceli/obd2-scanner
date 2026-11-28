// The trip being recorded on the "Viagem" screen ("Iniciar viagem" until
// "Encerrar"). Takes one sample per second from the live data, with the fuel
// flow the trip computer calculates, and saves the rows every 30 seconds, so
// a trip survives the program closing: it goes on when the program opens
// again (the time in between is simply left out). Replays never feed it.
import { api } from "./api";
import { averageOf, journeyInputs, SAMPLE_EVERY_S, type JourneyLog } from "./journey";
import { deleteJourney, listJourneys, loadLog, saveJourney, type JourneyMeta } from "./journey-store";
import { profile } from "./prefs";
import { calibratedFills, fuelFlow } from "./trip";
import { emit, isSupported, on, readKeys, recentValues, state } from "./store";

const SAVE_EVERY_MS = 30_000;
/** A trip with fewer samples than this (about a minute) is not kept. */
export const MIN_SAMPLES = 60;

export let active: { meta: JourneyMeta; log: JourneyLog } | null = null;
let lastSampleMs = 0;
let lastSaveMs = 0;

/** Fuel calculation the car allows right now, and whether it was calibrated at the pump. */
function fuelSource(): Pick<JourneyMeta, "method" | "calibrated"> {
  const method = isSupported("fuel_rate") ? "pid" : isSupported("maf") ? "maf" : isSupported("intake_map") ? "map" : null;
  return { method, calibrated: method === "pid" || (method !== null && calibratedFills(method) > 0) };
}

/** Totals for the list entry, from the rows so far. */
function totals(log: JourneyLog): Pick<JourneyMeta, "distanceKm" | "fuelL" | "runningS"> {
  const iSpeed = log.keys.indexOf("speed") + 2;
  const iRpm = log.keys.indexOf("rpm") + 2;
  let km = 0;
  let l = 0;
  let run = 0;
  let hasFuel = false;
  for (let i = 1; i < log.rows.length; i++) {
    const r = log.rows[i];
    const dt = (r[0] ?? 0) - (log.rows[i - 1][0] ?? 0);
    if (!(dt > 0 && dt <= 5)) continue;
    if (iSpeed >= 2) km += ((r[iSpeed] ?? 0) * dt) / 3600;
    const running = iRpm >= 2 ? (r[iRpm] ?? 0) >= 400 : true;
    if (running) run += dt;
    if (running && r[1] !== null && r[1] !== undefined) {
      hasFuel = true;
      l += (Math.max(0, r[1]) * dt) / 3600;
    }
  }
  return { distanceKm: km, fuelL: hasFuel ? l : undefined, runningS: run };
}

async function checkpoint() {
  if (!active) return;
  lastSaveMs = Date.now();
  Object.assign(active.meta, totals(active.log));
  await saveJourney(active.meta, active.log);
}

/** Tells the adapter to read what the trip needs (and starts reading). */
async function readForTrip() {
  if (state.connection !== "connected" || state.playback) return;
  try {
    await api.setLive(readKeys(), true);
    state.polling = true;
    state.readingPaused = false;
    emit("connection");
  } catch {
    /* the next frame or connection change tries again */
  }
}

export async function startJourney(): Promise<void> {
  if (active || state.connection !== "connected") return;
  const p = profile();
  const now = Date.now();
  const keys = journeyInputs(isSupported);
  active = {
    meta: {
      id: `j${now.toString(36)}`,
      profileId: p.id,
      name: "",
      note: "",
      startedAt: now,
      fuel: p.fuel,
      source: "live",
      ...fuelSource(),
      active: true,
      distanceKm: 0,
      runningS: 0,
    },
    log: { keys, rows: [] },
  };
  state.journeyActive = true;
  lastSampleMs = 0;
  emit("journey");
  await readForTrip();
  await checkpoint();
}

/**
 * Ends the trip. Returns its id, or null when it was too short to keep (it
 * is then deleted).
 */
export async function endJourney(): Promise<string | null> {
  if (!active) return null;
  const { meta, log } = active;
  active = null;
  state.journeyActive = false;
  meta.active = false;
  meta.endedAt = Date.now();
  meta.ethanolPercent = averageOf(log, "ethanol_percent");
  Object.assign(meta, totals(log));
  emit("journey");
  // Stop reading the extra parameters (keeps reading the dashboard's).
  if (state.polling) await api.setLive(readKeys(), true).catch(() => undefined);
  if (log.rows.length < MIN_SAMPLES) {
    await deleteJourney(meta.id);
    return null;
  }
  await saveJourney(meta, log);
  return meta.id;
}

/** Live totals of the trip in progress. */
export function activeTotals() {
  return active ? totals(active.log) : null;
}

function onFrame() {
  if (!active || state.playback || state.connection !== "connected") return;
  const now = Date.now();
  if (now - lastSampleMs < SAMPLE_EVERY_S * 1000 * 0.95) return;
  lastSampleMs = now;
  const v = recentValues();
  const { meta, log } = active;
  // A parameter the trip needs that was not read when it started (the car
  // answered late): add its column.
  for (const k of journeyInputs(isSupported)) {
    if (log.keys.includes(k)) continue;
    log.keys.push(k);
    for (const r of log.rows) r.push(null);
  }
  log.rows.push([(now - meta.startedAt) / 1000, fuelFlow(v) ?? null, ...log.keys.map((k) => v[k] ?? null)]);
  if (now - lastSaveMs > SAVE_EVERY_MS) void checkpoint();
  emit("journey");
}

export async function initJourney() {
  // A trip left running when the program closed goes on.
  const open = (await listJourneys()).find((m) => m.active);
  if (open) {
    const log = await loadLog(open.id);
    if (log) {
      active = { meta: open, log };
      state.journeyActive = true;
      emit("journey");
    }
  }
  on("frame", onFrame);
  on("connection", () => {
    if (!active) return;
    if (state.connection === "connected" && !state.polling && !state.readingPaused) void readForTrip();
    if (state.connection !== "connected") void checkpoint();
  });
  window.addEventListener("beforeunload", () => void checkpoint());
}
