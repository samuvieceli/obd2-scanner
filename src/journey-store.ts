// Saved trips of the "Viagem" screen, kept in the app window's IndexedDB
// (inside the app data folder, or the portable folder). A long trip has
// thousands of rows, too much for localStorage, so the list (small) and the
// rows (big) live in two stores and the rows are loaded only when a trip is
// opened. Every call fails soft: without storage the trip lives in memory.
import type { FuelType } from "./fuels";
import type { Cut, JourneyLog } from "./journey";

export interface JourneyMeta {
  id: string;
  profileId: string;
  /** Name chosen by the user ("Ida para a praia"); empty = date only. */
  name: string;
  note: string;
  /** ms since 1970. */
  startedAt: number;
  endedAt?: number;
  /** Fuel chosen in the car's settings when the trip started. */
  fuel: FuelType;
  /** Average ethanol % the car reported (flex), if any. */
  ethanolPercent?: number;
  source: "live" | "recording";
  /** How the fuel was calculated, and whether the pump calibration was done. */
  method: "pid" | "maf" | "map" | null;
  calibrated: boolean;
  /** Parts left out of the analysis by the user (seconds since the start). */
  cuts?: Cut[];
  /** Still being recorded. */
  active?: boolean;
  /** Totals for the list, filled when the trip ends. */
  distanceKm: number;
  fuelL?: number;
  runningS: number;
}

const DB = "obd2";
const VERSION = 1;
const META = "journeys";
const LOGS = "journeyLogs";

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("no IndexedDB"));
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: "id" });
        if (!d.objectStoreNames.contains(LOGS)) d.createObjectStore(LOGS, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = d.transaction(stores, mode);
        const req = work(tx);
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** All saved trips (every car), newest first. */
export async function listJourneys(): Promise<JourneyMeta[]> {
  try {
    const all = (await run<JourneyMeta[]>([META], "readonly", (tx) => tx.objectStore(META).getAll())) ?? [];
    return all.sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

export async function loadLog(id: string): Promise<JourneyLog | null> {
  try {
    const rec = await run<{ id: string; log: JourneyLog }>([LOGS], "readonly", (tx) => tx.objectStore(LOGS).get(id));
    return rec?.log ?? null;
  } catch {
    return null;
  }
}

/** Saves the list entry and, when given, the rows. Returns false when storage failed. */
export async function saveJourney(meta: JourneyMeta, log?: JourneyLog): Promise<boolean> {
  try {
    await run([META, LOGS], "readwrite", (tx) => {
      tx.objectStore(META).put(meta);
      if (log) tx.objectStore(LOGS).put({ id: meta.id, log });
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteJourney(id: string): Promise<void> {
  try {
    await run([META, LOGS], "readwrite", (tx) => {
      tx.objectStore(META).delete(id);
      tx.objectStore(LOGS).delete(id);
    });
  } catch {
    /* nothing to delete */
  }
}
