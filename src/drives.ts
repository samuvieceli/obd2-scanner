// Trip history: the summaries of past drives, kept between sessions so real
// averages can be compared, mostly gasoline against ethanol on flex cars.
//
// Pure logic plus browser storage, no DOM. Each car (profile) keeps its own
// drives; the newest MAX_DRIVES of all cars together are stored.
import type { FuelType } from "./fuels";
import type { DriveSummary } from "./summary";

export const MAX_DRIVES = 100;
const KEY = "driveHistory";

export interface StoredDrive extends DriveSummary {
  profileId: string;
  /** Fuel chosen in the car's settings when the drive ended. */
  fuel: FuelType;
  /** Ethanol share the car reported (flex "auto"), if any. */
  ethanolPercent?: number;
  /** Fuel cost with the pump prices of that day (missing in older drives). */
  cost?: number;
}

export type FuelGroup = "gasoline" | "ethanol" | "mixed" | "other";

/** Which column of the comparison a drive belongs to. */
export function fuelGroup(d: Pick<StoredDrive, "fuel" | "ethanolPercent">): FuelGroup {
  switch (d.fuel) {
    case "gasoline":
    case "gasoline_premium":
    case "gasoline_pure":
      return "gasoline";
    case "ethanol":
      return "ethanol";
    case "auto":
      // Brazilian gasoline already has ~30% ethanol: up to 40% counts as gasoline.
      if (d.ethanolPercent === undefined) return "other";
      return d.ethanolPercent <= 40 ? "gasoline" : d.ethanolPercent >= 70 ? "ethanol" : "mixed";
    default:
      return "other";
  }
}

export interface GroupStats {
  group: FuelGroup;
  drives: number;
  distanceKm: number;
  fuelL: number;
  /** Distance divided by fuel over all drives (long drives weigh more). */
  kmPerL?: number;
  /** Share of running time spent idling. */
  idleShare?: number;
  maxCoolant?: number;
}

/** Totals per fuel group, in a fixed order, only groups with drives. */
export function compareByFuel(drives: StoredDrive[]): GroupStats[] {
  const order: FuelGroup[] = ["gasoline", "ethanol", "mixed", "other"];
  return order
    .map((group) => {
      const list = drives.filter((d) => fuelGroup(d) === group);
      const distanceKm = list.reduce((a, d) => a + d.distanceKm, 0);
      const fuelL = list.reduce((a, d) => a + d.fuelL, 0);
      const running = list.reduce((a, d) => a + d.runningS, 0);
      const idle = list.reduce((a, d) => a + d.idleS, 0);
      const coolants = list.map((d) => d.maxCoolant).filter((v): v is number => v !== undefined);
      return {
        group,
        drives: list.length,
        distanceKm,
        fuelL,
        // Too little fuel or distance gives a meaningless average.
        kmPerL: distanceKm >= 1 && fuelL >= 0.05 ? distanceKm / fuelL : undefined,
        idleShare: running > 0 ? idle / running : undefined,
        maxCoolant: coolants.length ? Math.max(...coolants) : undefined,
      };
    })
    .filter((g) => g.drives > 0);
}

export function loadDrives(): StoredDrive[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? (v as StoredDrive[]) : [];
  } catch {
    return [];
  }
}

function saveDrives(list: StoredDrive[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_DRIVES)));
  } catch {
    /* storage full or blocked: kept for this session only */
  }
}

export function addDrive(d: StoredDrive) {
  saveDrives([...loadDrives(), d]);
}

/** Drives of one car, oldest first. */
export function drivesOf(profileId: string): StoredDrive[] {
  return loadDrives().filter((d) => d.profileId === profileId);
}

/** Forgets one drive of a car (identified by when it ended). */
export function removeDrive(profileId: string, endedAt: number) {
  saveDrives(loadDrives().filter((d) => d.profileId !== profileId || d.endedAt !== endedAt));
}

export interface MonthTotals {
  /** "2026-11" */
  month: string;
  drives: number;
  distanceKm: number;
  fuelL: number;
  /** Sum of the drives that have a cost (undefined when none has). */
  cost?: number;
  /** Drives without a cost (older ones, or no price set). */
  noCost: number;
  kmPerL?: number;
}

/** Totals per calendar month (local time), newest month first. */
export function monthlyTotals(drives: StoredDrive[]): MonthTotals[] {
  const by = new Map<string, MonthTotals>();
  for (const d of drives) {
    const at = new Date(d.endedAt);
    const month = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
    let m = by.get(month);
    if (!m) by.set(month, (m = { month, drives: 0, distanceKm: 0, fuelL: 0, noCost: 0 }));
    m.drives++;
    m.distanceKm += d.distanceKm;
    m.fuelL += d.fuelL;
    if (d.cost !== undefined) m.cost = (m.cost ?? 0) + d.cost;
    else m.noCost++;
  }
  const out = [...by.values()].sort((a, b) => b.month.localeCompare(a.month));
  for (const m of out) m.kmPerL = m.distanceKm >= 1 && m.fuelL >= 0.05 ? m.distanceKm / m.fuelL : undefined;
  return out;
}

/** Usual economy of this car with a fuel group, from the history (≥ 3 drives, ≥ 20 km). */
export function usualKmPerL(drives: StoredDrive[], group: FuelGroup): number | undefined {
  const g = compareByFuel(drives).find((s) => s.group === group);
  return g && g.drives >= 3 && g.distanceKm >= 20 ? g.kmPerL : undefined;
}

/** Forgets one car's drives; the other cars keep theirs. */
export function clearDrives(profileId: string) {
  saveDrives(loadDrives().filter((d) => d.profileId !== profileId));
}
