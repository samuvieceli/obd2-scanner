// Replays a saved recording as if it were live data: the dashboard, HUD and
// charts show it exactly like a real connection, with play/pause, speed and
// a position slider. Everything runs in the UI; the adapter is not used.
import { api, type Session } from "./api";
import { emit, pushFrame, resetLiveData, state } from "./store";

const TICK_MS = 50;
const FINDINGS_WINDOW_MS = 30_000;
export const SPEEDS = [0.5, 1, 2, 4, 8];

export interface Playback {
  name: string;
  session: Session;
  /** Next frame to emit. */
  idx: number;
  /** Current position in milliseconds since the start of the recording. */
  posMs: number;
  durationMs: number;
  playing: boolean;
  speed: number;
  keys: string[];
}

let timer = 0;
let seeking = false;

/** True while a jump re-sends the frames up to the new position. */
export function isSeeking(): boolean {
  return seeking;
}
let lastFindingsAt = 0;

function rateOf(s: Session): number {
  const n = s.frames.length;
  if (n < 2) return 0;
  const span = (s.frames[n - 1].t_ms - s.frames[0].t_ms) / 1000;
  return span > 0 ? Math.round(((n - 1) / span) * 10) / 10 : 0;
}

function emitUpTo(p: Playback, ms: number, rate: number) {
  const frames = p.session.frames;
  while (p.idx < frames.length && frames[p.idx].t_ms <= ms) {
    const f = frames[p.idx++];
    pushFrame({ t_ms: f.t_ms, values: f.values, dropped: [], rate_hz: rate });
  }
}

let findingsSeq = 0;

async function refreshFindings(p: Playback) {
  const frames = p.session.frames;
  const end = p.idx;
  let start = end;
  while (start > 0 && frames[end - 1].t_ms - frames[start - 1].t_ms <= FINDINGS_WINDOW_MS) start--;
  const seq = ++findingsSeq;
  try {
    const found = await api.interpretFrames(frames.slice(start, end));
    // A later request (a jump while dragging) or the end of playback wins.
    if (seq !== findingsSeq || state.playback !== p) return;
    state.findings = found;
    emit("findings");
  } catch {
    /* findings are optional during playback */
  }
}

function tick() {
  const p = state.playback;
  if (!p || !p.playing) return;
  p.posMs = Math.min(p.durationMs, p.posMs + TICK_MS * p.speed);
  emitUpTo(p, p.posMs, rateOf(p.session));
  if (p.posMs >= p.durationMs) p.playing = false;
  const now = performance.now();
  if (now - lastFindingsAt > 1000 || !p.playing) {
    lastFindingsAt = now;
    void refreshFindings(p);
  }
  emit("playback");
}

export function startPlayback(name: string, session: Session) {
  stopPlayback(false);
  resetLiveData();
  const frames = session.frames;
  const keys = [...new Set(frames.flatMap((f) => Object.keys(f.values)))];
  state.playback = {
    name,
    session,
    idx: 0,
    posMs: 0,
    durationMs: frames.length ? frames[frames.length - 1].t_ms : 0,
    playing: true,
    speed: 1,
    keys,
  };
  emitUpTo(state.playback, 0, rateOf(session));
  timer = window.setInterval(tick, TICK_MS);
  emit("playback");
  emit("live-keys");
}

export function stopPlayback(notify = true) {
  if (timer) clearInterval(timer);
  timer = 0;
  if (!state.playback) return;
  state.playback = null;
  resetLiveData();
  state.rateHz = 0;
  if (notify) {
    emit("playback");
    emit("live-keys");
    emit("findings");
    emit("frame");
  }
}

export function togglePlay() {
  const p = state.playback;
  if (!p) return;
  if (!p.playing && p.posMs >= p.durationMs) seek(0);
  p.playing = !p.playing;
  emit("playback");
}

export function setSpeed(speed: number) {
  if (!state.playback) return;
  state.playback.speed = speed;
  emit("playback");
}

/** Jumps to a position: rebuilds history up to that point. */
export function seek(ms: number) {
  const p = state.playback;
  if (!p) return;
  const keepFindings = state.findings;
  resetLiveData();
  state.findings = keepFindings;
  p.idx = 0;
  p.posMs = Math.max(0, Math.min(p.durationMs, ms));
  // Totals (trip, fuel trim map, drive summary) are rebuilt from the start.
  emit("seek");
  seeking = true;
  try {
    emitUpTo(p, p.posMs, rateOf(p.session));
  } finally {
    seeking = false;
  }
  void refreshFindings(p);
  emit("playback");
}
