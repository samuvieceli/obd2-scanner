// "Copy image" cards: a clean picture with the car, the date and the main
// facts, ready to paste (Ctrl+V) in WhatsApp, Telegram or an e-mail. Always
// light background with dark text, whatever the app theme, so it reads well
// in any chat. If the clipboard refuses an image, the card is saved as PNG.
import { save } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import { getLang, t } from "./i18n";
import { profile } from "./prefs";
import { state } from "./store";
import { errorText, timestampForFile, toast } from "./ui";

export interface Line {
  text: string;
  bold?: boolean;
  /** Small grey text. */
  muted?: boolean;
  /** Colored code-like label in front of the text. */
  tag?: string;
  /** Extra space above (a new block). */
  gap?: boolean;
}

const W = 1080;
const PAD = 48;
const INK = "#111827";
const GREY = "#6b7280";
const ACCENT = "#0e7490";
const TAG = "#b45309";

/** "Meu carro · Volkswagen 2024 · 9BW…" */
export function vehicleLine(): string {
  const v = state.vehicle?.vinInfo;
  const parts = [profile().name];
  if (v?.manufacturer) parts.push(v.model_year ? `${v.manufacturer} ${v.model_year}` : v.manufacturer);
  const vin = state.vehicle?.identity.vin;
  if (vin) parts.push(`VIN ${vin}`);
  return parts.join(" · ");
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Draws the card: title, vehicle and date, lines, then an optional picture. */
export function drawCard(title: string, lines: Line[], picture?: HTMLCanvasElement): HTMLCanvasElement {
  const font = (size: number, bold = false) => `${bold ? "700 " : ""}${size}px "Segoe UI", system-ui, sans-serif`;
  const measure = document.createElement("canvas").getContext("2d")!;
  // First pass: layout.
  type Row = { y: number; text: string; font: string; color: string; x: number };
  const rows: Row[] = [];
  let y = PAD;
  const add = (text: string, size: number, color: string, bold = false, x = PAD, width = W - 2 * PAD) => {
    measure.font = font(size, bold);
    for (const l of wrap(measure, text, width)) {
      y += size * 1.35;
      rows.push({ y, text: l, font: font(size, bold), color, x });
    }
  };
  add(title, 44, INK, true);
  add(vehicleLine(), 26, GREY);
  add(new Date().toLocaleString(getLang(), { dateStyle: "long", timeStyle: "short" }), 26, GREY);
  y += 16;
  for (const l of lines) {
    if (l.gap) y += 18;
    if (l.tag) {
      measure.font = font(30, true);
      const tagW = measure.measureText(l.tag).width + 24;
      const top = y;
      rows.push({ y: y + 30 * 1.35, text: l.tag, font: font(30, true), color: TAG, x: PAD });
      add(l.text, 28, INK, false, PAD + tagW, W - 2 * PAD - tagW);
      y = Math.max(y, top + 30 * 1.35);
    } else add(l.text, l.muted ? 24 : 30, l.muted ? GREY : INK, l.bold);
  }
  const picTop = y + 24;
  const picH = picture ? Math.round((picture.height * (W - 2 * PAD)) / picture.width) : 0;
  const footTop = picTop + picH + (picture ? 24 : 0);
  const height = footTop + 24 * 1.35 + PAD;

  const c = document.createElement("canvas");
  c.width = W;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, height);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, 10);
  ctx.textBaseline = "alphabetic";
  for (const r of rows) {
    ctx.font = r.font;
    ctx.fillStyle = r.color;
    ctx.fillText(r.text, r.x, r.y);
  }
  if (picture) ctx.drawImage(picture, PAD, picTop, W - 2 * PAD, picH);
  ctx.font = font(22);
  ctx.fillStyle = GREY;
  ctx.fillText(`${t("app.name")} · ${t("share.footer")}`, PAD, footTop + 22);
  return c;
}

/** Puts the card on the clipboard; saves it as PNG when that is not possible. */
export async function copyCard(card: HTMLCanvasElement, fileName: string) {
  const blob = await new Promise<Blob | null>((r) => card.toBlob(r, "image/png"));
  if (!blob) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast(t("share.copied"), "ok");
    return;
  } catch {
    /* fall back to a file */
  }
  const path = await save({ defaultPath: `${fileName}-${timestampForFile()}.png`, filters: [{ name: "PNG", extensions: ["png"] }] });
  if (!path) return;
  try {
    await api.saveFile(path, Array.from(new Uint8Array(await blob.arrayBuffer())));
    toast(t("share.saved", { path }), "ok");
  } catch (e) {
    toast(errorText(e), "error");
  }
}
