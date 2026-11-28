// "Checagem antes da estrada" (Viagem screen): a quick look at what the
// OBD2 port can tell before a long drive. Pure logic, no DOM: it grades the
// trouble codes, the warning light, the battery or alternator voltage and the
// engine temperature, each as ok / attention / problem / not read.
//
// Battery limits (12 V lead-acid): engine off, 12.4 V or more is charged,
// 12.0–12.4 V low, below 12.0 V discharged. Engine running, the alternator
// should give 13.2–14.8 V; 12.8–13.2 V can be "smart charging" (cars that
// charge the battery only when needed) but is worth a look; below that the
// battery is not charging; above 15 V it overcharges.

export type CheckStatus = "ok" | "warn" | "bad" | "unknown";

export interface CheckItem {
  id: "codes" | "mil" | "battery" | "alternator" | "coolant";
  status: CheckStatus;
  params: Record<string, number>;
  /** Text variant (e.g. "pending" for codes that are only pending). */
  variant?: string;
}

export interface CheckInput {
  /** Trouble codes, when they could be read. */
  codes?: { stored: number; pending: number; permanent: number };
  /** Check engine light on (from readiness), when read. */
  mil?: boolean;
  rpm?: number;
  voltage?: number;
  coolant?: number;
}

export const ENGINE_RUNNING_RPM = 400;
export const HOT_C = 105;

export function evaluate(x: CheckInput): CheckItem[] {
  const items: CheckItem[] = [];
  const c = x.codes;
  if (!c) items.push({ id: "codes", status: "unknown", params: {} });
  else if (c.stored + c.permanent > 0) items.push({ id: "codes", status: "bad", params: { n: c.stored + c.permanent }, variant: "stored" });
  else if (c.pending > 0) items.push({ id: "codes", status: "warn", params: { n: c.pending }, variant: "pending" });
  else items.push({ id: "codes", status: "ok", params: {} });

  if (x.mil !== undefined) items.push({ id: "mil", status: x.mil ? "bad" : "ok", params: {} });

  const running = x.rpm !== undefined && x.rpm >= ENGINE_RUNNING_RPM;
  const v = x.voltage;
  if (v === undefined) items.push({ id: running ? "alternator" : "battery", status: "unknown", params: {} });
  else if (running) {
    const status: CheckStatus = v > 15 ? "bad" : v >= 13.2 ? "ok" : v >= 12.8 ? "warn" : "bad";
    items.push({ id: "alternator", status, params: { v }, variant: v > 15 ? "high" : v < 12.8 ? "low" : v < 13.2 ? "smart" : undefined });
  } else {
    const status: CheckStatus = v >= 12.4 ? "ok" : v >= 12.0 ? "warn" : "bad";
    items.push({ id: "battery", status, params: { v } });
  }

  if (x.coolant === undefined) items.push({ id: "coolant", status: "unknown", params: {} });
  else if (x.coolant >= HOT_C) items.push({ id: "coolant", status: "bad", params: { c: Math.round(x.coolant) }, variant: "hot" });
  else items.push({ id: "coolant", status: "ok", params: { c: Math.round(x.coolant) }, variant: running ? undefined : "off" });
  return items;
}

/** The worst status of all items, ignoring what could not be read. */
export function overall(items: CheckItem[]): CheckStatus {
  const order: CheckStatus[] = ["bad", "warn", "ok"];
  for (const s of order) if (items.some((i) => i.status === s)) return s;
  return "unknown";
}
