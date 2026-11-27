// Safety notice shown when the program opens. The user confirms it once;
// it comes back only when its text changes in an important way (raise
// SAFETY_VERSION then). Kept in the window storage, like the preferences.

/** Raise when the notice gains or changes an important point. */
export const SAFETY_VERSION = 1;

/** The points of the notice, in order (texts in locales, under safety.items). */
export const SAFETY_ITEMS = ["driving", "tests", "hints", "readOnly", "cables", "warranty"] as const;

const KEY = "safetyAccepted";

/** True when the notice must be shown: never confirmed, or confirmed an older text. */
export function needsSafetyNotice(accepted: string | null): boolean {
  const v = Number(accepted);
  return !Number.isInteger(v) || v < SAFETY_VERSION;
}

export function safetyPending(): boolean {
  try {
    return needsSafetyNotice(localStorage.getItem(KEY));
  } catch {
    // No storage: show it every time rather than never.
    return true;
  }
}

export function acceptSafety() {
  try {
    localStorage.setItem(KEY, String(SAFETY_VERSION));
  } catch {
    /* shown again next time */
  }
}
