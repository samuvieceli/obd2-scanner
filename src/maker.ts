// Manufacturer parameters: extra readings some car models give beyond the
// standard ones (oil temperature, engaged gear...), read with service 21/22
// from one control unit. The data comes from the open project OBDb and is
// built into the program (crates/obd-core/src/maker.rs). The user picks the
// car model in the profile; the VIN suggests the make. Parameters nobody
// confirmed on a real car are "experimental" and hidden unless asked for.
import { api, isTauri, type MakerModel, type MakerParam } from "./api";
import { getLang, onLangChange, setExtraPidTexts, t } from "./i18n";
import { profile, saveProfile } from "./prefs";
import { emit, isMakerKey, on, readKeys, setLiveKeys, state } from "./store";

let models: MakerModel[] = [];
/** model|year|language of the parameters in state.maker. */
let loadedFor = "";

export function makerModels(): MakerModel[] {
  return models;
}

/** Model year from the VIN, when the car told it. */
export function makerYear(): number | null {
  return state.vehicle?.vinInfo?.model_year ?? null;
}

/** Models of the make the VIN points to ("Toyota (Brasil)" → Toyota models). */
export function suggestedModels(): MakerModel[] {
  const maker = (state.vehicle?.vinInfo?.manufacturer ?? "").toLowerCase();
  if (!maker) return [];
  return models.filter((m) => maker.includes(m.make.toLowerCase()));
}

export function makerExperimental(): boolean {
  return profile().makerExperimental ?? false;
}

/** Whether a parameter is offered: confirmed, or experimental ones shown. */
export function makerOffered(p: MakerParam): boolean {
  return p.verified || makerExperimental();
}

/** Loads the parameters of the profile's model (again when the model, the
 *  model year or the language changed). */
export async function loadMaker(): Promise<void> {
  if (!isTauri()) return;
  try {
    if (!models.length) models = await api.makerModels();
    const id = profile().makerModel ?? null;
    const year = makerYear();
    const lang = getLang();
    const wanted = `${id}|${year}|${lang}`;
    if (wanted === loadedFor) return;
    loadedFor = wanted;
    const params = id ? await api.makerParams(id, year, lang) : [];
    state.maker = new Map(params.map((p) => [p.key, p]));
  } catch (e) {
    console.error(e);
    state.maker = new Map();
  }
  emit("maker");
}

export async function chooseMakerModel(id: string | null) {
  saveProfile({ makerModel: id });
  await loadMaker();
  // Parameters of the previous model are not read any more.
  const keys = state.liveKeys.filter((k) => !isMakerKey(k) || state.maker.has(k));
  if (keys.length === state.liveKeys.length) return;
  setLiveKeys(keys);
  if (state.connection === "connected") await api.setLive(readKeys(), state.polling).catch(() => undefined);
}

export function setMakerExperimental(on_: boolean) {
  saveProfile({ makerExperimental: on_ });
  emit("maker");
}

/** Text of a value with named states (on/off, a gear...), or null. */
export function stateLabel(key: string, v: number): string | null {
  const s = state.maker.get(key)?.states?.find((x) => x.raw === Math.round(v));
  if (!s) return state.maker.get(key)?.states ? String(v) : null;
  if (s.word) return t(`maker.word.${s.word}`);
  return (getLang() === "pt-BR" ? s.pt : s.en) ?? String(v);
}

setExtraPidTexts((key) => {
  const p = state.maker.get(key);
  if (!p) return undefined;
  const desc = t(p.verified ? "maker.tipVerified" : "maker.tipExperimental");
  return { name: p.name, short: p.name, desc, typical: "" };
});

on("profile", () => void loadMaker());
on("connection", () => void loadMaker());
onLangChange(() => void loadMaker());
