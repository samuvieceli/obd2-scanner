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
}

export type FuelGroup = "gasoline" | "ethanol" | "mixed" | "other";

/** Which column of the comparison a drive belongs to. */
export function fuelGroup(d: StoredDrive): FuelGroup {
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

/** Forgets one car's drives; the other cars keep theirs. */
export function clearDrives(profileId: string) {
  saveDrives(loadDrives().filter((d) => d.profileId !== profileId));
}
