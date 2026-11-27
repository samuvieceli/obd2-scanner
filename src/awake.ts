// Keeps the screen on and the computer awake while the program is working:
// live reading, recording or the HUD screen. Otherwise Windows may switch the
// screen off or sleep in the middle of a drive, and the adapter link drops.
import { api } from "./api";
import { on, state } from "./store";

let current = false;

function wanted(): boolean {
  if (state.connection !== "connected") return false;
  return state.polling || state.recording.recording || location.hash === "#/hud";
}

function update() {
  const want = wanted();
  if (want === current) return;
  current = want;
  api.keepAwake(want).catch(() => undefined);
}

/** Called once at start-up. */
export function initKeepAwake() {
  for (const topic of ["connection", "recording", "link"] as const) on(topic, update);
  window.addEventListener("hashchange", update);
  // Some screens switch live reading on and off without an event: check now and then.
  setInterval(update, 5_000);
}
