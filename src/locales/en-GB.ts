// English (Europe): British spelling and words, for metric countries.
// Built from en-US.ts so a new text needs writing only once: `british()`
// turns American spelling and words into British ones, and `OVERRIDES`
// replaces the few texts that need different wording. Default units for this
// language (km/h, °C, L/100 km, bar) are in ../unit-presets.ts.
import type { Messages } from "./pt-BR";
import enUS from "./en-US";

/** American → British, applied as whole words; capitalised forms follow. */
const WORDS: [RegExp, string][] = [
  [/"check engine" light/g, "engine warning light"],
  [/\bcheck engine light\b/g, "engine warning light"],
  [/\bCheck engine light\b/g, "Engine warning light"],
  [/\bgasoline\b/g, "petrol"],
  [/\bGasoline\b/g, "Petrol"],
  [/\b([Ll])iter(s?)\b/g, "$1itre$2"],
  [/\b([Kk])ilometer(s?)\b/g, "$1ilometre$2"],
  [/\b([Rr])efuel(ed|ing)\b/g, "$1efuell$2"],
  [/\baging\b/g, "ageing"],
  [/\b([Vv])apor(s?)\b/g, "$1apour$2"],
  [/\b([Cc])enter\b/g, "$1entre"],
  [/\b([Cc])olor(s?)\b/g, "$1olour$2"],
  [/\bwindshield\b/g, "windscreen"],
  [/\bgas station(s?)\b/g, "petrol station$1"],
  [/\b([Mm])aneuver(s?)\b/g, "$1anoeuvre$2"],
  [/\bgray(ed)?\b/g, "grey$1"],
  [/\b([Tt])ire(s?)\b/g, "$1yre$2"],
  [/\bcatalog\b/g, "catalogue"],
  [/\blicense\b/g, "licence"],
  [/\bparking brake set\b/g, "handbrake on"],
  [/\bhighway\b/g, "motorway"],
  [/\bpassing\b/g, "overtaking"],
  [/\b(recogni|standardi|normali|harmoni|speciali|organi|minimi|maximi|summari|customi|prioriti|optimi)z(e|ed|es|ing|ation)\b/g, "$1s$2"],
  [/\b([Aa])nalyz(e|ed|es|ing)\b/g, "$1nalys$2"],
];

export function british(text: string): string {
  return WORDS.reduce((s, [re, to]) => s.replace(re, to), text);
}

type Tree = { [k: string]: string | Tree };

function mapTree(node: Tree, f: (s: string) => string): Tree {
  const out: Tree = {};
  for (const [k, v] of Object.entries(node)) out[k] = typeof v === "string" ? f(v) : mapTree(v, f);
  return out;
}

/** Deep merge: `extra` replaces single texts of `base`. */
function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = typeof v === "string" ? v : merge((base[k] as Tree) ?? {}, v);
  return out;
}

/** Texts whose wording (not only spelling) differs from American English. */
const OVERRIDES: Tree = {
  cost: {
    pricePlaceholder: "e.g. 1.79",
  },
  refuel: {
    badLitres: "Enter the amount the pump showed, for example 38.5.",
  },
};

const enGB = merge(mapTree(enUS as unknown as Tree, british), OVERRIDES) as unknown as Messages;

export default enGB;
