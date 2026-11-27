// Settings: language, theme, vehicle profiles, units, connection, alerts, about.
import { fmtNum, getLang, LANGS, setLang, t } from "../i18n";
import { openSafetyNotice } from "./safety";
import { emit, on, state } from "../store";
import { applyTheme, getTheme, THEME_SWATCH, THEMES, type Theme } from "../theme";
import { baseUnitOf, button, clear, h, infoTip, section, toast, unitOf } from "../ui";
import { DEFAULT_ALERTS, newProfile, prefs, profile, savePrefs, saveProfile, setActiveProfile, type AlertRule, type FuelType, type Profile } from "../prefs";
import { calibratedFills, resetCalibration } from "../trip";
import { fromDisplay, saveUnits, toDisplay, UNIT_CHOICES, UNIT_PRESETS, units, type UnitPrefs } from "../units";
import { pidText } from "../i18n";
import type { PriceKey } from "../cost";
import { openUrl } from "@tauri-apps/plugin-opener";

const REPO_URL = "https://github.com/samuvieceli/obd2-scanner";
const FUELS: FuelType[] = ["auto", "gasoline", "gasoline_premium", "ethanol", "diesel", "gasoline_pure"];

type NumField = (label: string, help: string, value: number, step: number, min: number, max: number, set: (v: number) => void) => HTMLElement;

/**
 * How this car's consumption is calculated, and only the engine data that
 * calculation uses: displacement and volumetric efficiency for MAP-only cars,
 * the MAF correction factor for cars with a MAF sensor.
 */
function engineFields(p: Profile, num: NumField): HTMLElement[] {
  const m = p.fuelMethod;
  const out: HTMLElement[] = [
    h("div", { class: "kv-row" }, h("span", { class: "muted" }, t("profiles.method.label"), " ", infoTip(t("profiles.method.help"))), h("strong", null, t(`profiles.method.${m ?? "unknown"}`))),
  ];
  if (m === null) out.push(h("p", { class: "muted small" }, t("profiles.method.unknownHint")));
  if (m === "map" || m === null) {
    out.push(
      h(
        "div",
        { class: "row" },
        num(t("settings.displacement"), t("settings.displacementHelp"), p.displacementL, 0.1, 0.6, 8, (v) => saveProfile({ displacementL: v })),
        m === "map" ? num(t("settings.efficiency"), t("settings.efficiencyHelp"), Math.round(p.volumetricEff * 100), 1, 50, 120, (v) => saveProfile({ volumetricEff: v / 100 })) : null,
      ),
    );
  }
  if (m === "map" || m === "maf") {
    const n = calibratedFills(m);
    out.push(
      h(
        "div",
        { class: "row wrap calibration-row" },
        h("span", { class: "muted" }, t(`profiles.correction.${m}`), " ", infoTip(t(`profiles.correction.${m}Help`))),
        m === "maf" ? h("strong", null, `${fmtNum(p.mafFactor * 100, 0)}%`) : null,
        h("span", { class: `badge ${n ? "badge-ok" : ""}` }, n ? t("refuel.calibrated", { n }) : t("refuel.notCalibrated")),
        button(t("profiles.correction.reset"), () => resetCalibration(m), "ghost"),
      ),
    );
  }
  return out;
}

/** Vehicle profiles: one per car, with the data used by the calculations. */
function profilesSection(offs: (() => void)[]): HTMLElement {
  const box = h("div");
  const render = () => {
    clear(box);
    const p = profile();
    const all = prefs().profiles;
    const num = (label: string, help: string, value: number, step: number, min: number, max: number, set: (v: number) => void) =>
      h(
        "label",
        { class: "field" },
        h("span", null, label, " ", infoTip(help)),
        h("input", {
          type: "number",
          step,
          min,
          max,
          value: String(value),
          onchange: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(v) && v >= min && v <= max) set(v);
          },
        }),
      );
    const picker = h(
      "select",
      {
        id: "profile-pick",
        onchange: (e: Event) => {
          // Another car: a half-confirmed removal must not carry over to it.
          removeArmed = false;
          setActiveProfile((e.target as HTMLSelectElement).value);
          render();
        },
      },
      all.map((x) => h("option", { value: x.id, selected: x.id === p.id }, x.name)),
    );
    box.append(
      h("p", { class: "muted small" }, t("profiles.intro")),
      h(
        "div",
        { class: "row" },
        h("label", { class: "field grow", for: "profile-pick" }, h("span", null, t("profiles.active")), picker),
        button(t("profiles.add"), () => {
          const created = newProfile(t("profiles.newName", { n: all.length + 1 }));
          savePrefs({ profiles: [...all, created] });
          setActiveProfile(created.id);
          render();
        }, "secondary"),
        all.length > 1
          ? button(t("profiles.remove"), () => {
              // A plain confirm() would block the app window: ask by double click instead.
              if (!removeArmed) {
                removeArmed = true;
                toast(t("profiles.removeConfirm", { name: p.name }), "info");
                setTimeout(() => (removeArmed = false), 4000);
                return;
              }
              removeArmed = false;
              const rest = all.filter((x) => x.id !== p.id);
              savePrefs({ profiles: rest });
              setActiveProfile(rest[0].id);
              render();
            }, "ghost")
          : null,
      ),
      h(
        "label",
        { class: "field" },
        h("span", null, t("profiles.name")),
        h("input", {
          type: "text",
          value: p.name,
          maxlength: 40,
          onchange: (e: Event) => {
            const name = (e.target as HTMLInputElement).value.trim();
            if (name) {
              saveProfile({ name });
              emit("profile");
              render();
            }
          },
        }),
      ),
      h(
        "div",
        { class: "kv-row vin-row" },
        h("span", { class: "muted" }, t("profiles.vin"), " ", infoTip(t("profiles.vinHelp"))),
        h("span", { class: "mono" }, p.vin ?? t("profiles.vinUnknown")),
        p.vin
          ? button(t("profiles.vinForget"), () => {
              saveProfile({ vin: null });
              render();
            }, "ghost")
          : null,
      ),
      h(
        "label",
        { class: "field" },
        h("span", null, t("settings.fuel")),
        h(
          "select",
          { onchange: (e: Event) => saveProfile({ fuel: (e.target as HTMLSelectElement).value as FuelType }) },
          FUELS.map((f) => h("option", { value: f, selected: f === p.fuel }, t(`settings.fuels.${f}`))),
        ),
      ),
      ...engineFields(p, num),
    );
  };
  let removeArmed = false;
  render();
  offs.push(on("profile", render));
  return section(t("profiles.title"), box);
}

function unitsSection(): HTMLElement {
  const box = h("div");
  const render = () => {
    clear(box);
    const u = units();
    const presetOf = (Object.keys(UNIT_PRESETS) as (keyof typeof UNIT_PRESETS)[]).find((k) =>
      (Object.keys(u) as (keyof UnitPrefs)[]).every((q) => UNIT_PRESETS[k][q] === u[q]),
    );
    box.append(
      h("p", { class: "muted small" }, t("units.intro")),
      h(
        "div",
        { class: "row wrap", role: "radiogroup", "aria-label": t("units.presets") },
        (Object.keys(UNIT_PRESETS) as (keyof typeof UNIT_PRESETS)[]).map((k) =>
          h(
            "button",
            {
              type: "button",
              role: "radio",
              "aria-checked": String(presetOf === k),
              class: `btn ${presetOf === k ? "btn-primary" : "btn-secondary"}`,
              onclick: () => {
                saveUnits(UNIT_PRESETS[k]);
                render();
              },
            },
            t(`units.preset.${k}`),
          ),
        ),
      ),
      h(
        "div",
        { class: "unit-grid" },
        (Object.keys(UNIT_CHOICES) as (keyof UnitPrefs)[]).map((q) =>
          h(
            "label",
            { class: "field" },
            h("span", null, t(`units.${q}`)),
            h(
              "select",
              {
                onchange: (e: Event) => {
                  saveUnits({ [q]: (e.target as HTMLSelectElement).value } as Partial<UnitPrefs>);
                  render();
                },
              },
              (UNIT_CHOICES[q] as string[]).map((c) => h("option", { value: c, selected: c === u[q] }, t(`units.names.${c}`))),
            ),
          ),
        ),
      ),
      h("p", { class: "muted small" }, t("units.note")),
    );
  };
  render();
  return section(t("units.title"), box);
}

function connectionSection(): HTMLElement {
  const p = prefs();
  return section(
    t("settings.connection"),
    h(
      "label",
      { class: "check" },
      h("input", { type: "checkbox", checked: p.autoReconnect, onchange: (e: Event) => savePrefs({ autoReconnect: (e.target as HTMLInputElement).checked }) }),
      h("span", null, t("link.autoReconnect")),
      infoTip(t("link.autoReconnectHelp")),
    ),
  );
}

/** Pump prices, for the trip cost and the gasoline × ethanol comparison. */
function pricesSection(): HTMLElement {
  const keys: PriceKey[] = ["gasoline", "gasoline_premium", "ethanol", "diesel"];
  const box = h("div", { class: "row wrap" });
  for (const k of keys) {
    const cur = prefs().fuelPrices[k];
    box.append(
      h(
        "label",
        { class: "field" },
        h("span", null, t(`cost.price.${k}`)),
        h("input", {
          type: "number",
          step: 0.01,
          min: 0,
          max: 100,
          inputmode: "decimal",
          placeholder: t("cost.pricePlaceholder"),
          value: cur ? String(cur) : "",
          onchange: (e: Event) => {
            const raw = (e.target as HTMLInputElement).value.replace(",", ".");
            const v = raw === "" ? null : Number(raw);
            if (v !== null && !(Number.isFinite(v) && v >= 0 && v <= 100)) return;
            savePrefs({ fuelPrices: { ...prefs().fuelPrices, [k]: v } });
            emit("trip");
          },
        }),
      ),
    );
  }
  return section(t("cost.title"), h("p", { class: "muted small" }, t("cost.help")), box);
}

function alertsSection(offs: (() => void)[]): HTMLElement {
  const list = h("div", { class: "alert-rules" });
  const render = () => {
    clear(list);
    const rules = profile().alerts;
    const update = (i: number, change: Partial<AlertRule>) => {
      const next = rules.map((r, j) => (j === i ? { ...r, ...change } : r));
      saveProfile({ alerts: next });
    };
    // Limits are stored in metric units and shown in the user's units.
    const limit = (i: number, which: "below" | "above", v: number | null) => {
      const base = baseUnitOf(rules[i].key);
      return h("input", {
        type: "number",
        step: "any",
        value: v === null ? "" : String(Number(toDisplay(base, v).toFixed(2))),
        placeholder: "—",
        "aria-label": t(`settings.alert${which === "below" ? "Below" : "Above"}`),
        onchange: (e: Event) => {
          const raw = (e.target as HTMLInputElement).value.trim().replace(",", ".");
          const n = Number(raw);
          // Ignore what is not a number instead of saving it as a limit.
          if (raw !== "" && !Number.isFinite(n)) return;
          update(i, { [which]: raw === "" ? null : fromDisplay(base, n) });
        },
      });
    };
    list.append(
      h(
        "div",
        { class: "table-wrap" },
        h(
        "table",
        { class: "table" },
        h(
          "thead",
          null,
          h("tr", null, h("th", null, t("settings.alertParam")), h("th", null, t("settings.alertBelow")), h("th", null, t("settings.alertAbove")), h("th", null, t("settings.alertOn")), h("th", null, "")),
        ),
        h(
          "tbody",
          null,
          rules.map((r, i) =>
            h(
              "tr",
              null,
              h("td", null, pidText(r.key).name, unitOf(r.key) ? h("span", { class: "muted small" }, ` (${unitOf(r.key)})`) : null),
              h("td", null, limit(i, "below", r.below)),
              h("td", null, limit(i, "above", r.above)),
              h(
                "td",
                null,
                h("input", {
                  type: "checkbox",
                  checked: r.enabled,
                  "aria-label": t("settings.alertOn"),
                  onchange: (e: Event) => update(i, { enabled: (e.target as HTMLInputElement).checked }),
                }),
              ),
              h(
                "td",
                null,
                button(t("settings.alertRemove"), () => {
                  saveProfile({ alerts: rules.filter((_, j) => j !== i) });
                  render();
                }, "ghost"),
              ),
            ),
          ),
        ),
      ),
      ),
    );
    const used = new Set(rules.map((r) => r.key));
    const add = h(
      "select",
      { "aria-label": t("settings.alertAdd") },
      state.catalog.filter((m) => !used.has(m.key)).map((m) => h("option", { value: m.key }, pidText(m.key).name)),
    );
    list.append(
      h(
        "div",
        { class: "row" },
        add,
        button(t("settings.alertAdd"), () => {
          if (!add.value) return;
          saveProfile({ alerts: [...profile().alerts, { key: add.value, below: null, above: null, enabled: true }] });
          render();
        }, "secondary"),
        button(t("settings.alertDefaults"), () => {
          saveProfile({ alerts: structuredClone(DEFAULT_ALERTS) });
          render();
        }, "ghost"),
      ),
    );
  };
  render();
  offs.push(on("profile", render), on("units", render));
  const p = prefs();
  const check = (label: string, value: boolean, set: (v: boolean) => void) =>
    h(
      "label",
      { class: "check" },
      h("input", { type: "checkbox", checked: value, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }),
      h("span", null, label),
    );
  return section(
    t("settings.alerts"),
    h("p", { class: "muted small" }, t("settings.alertsIntro")),
    check(t("settings.alertsEnabled"), p.alertsEnabled, (v) => savePrefs({ alertsEnabled: v })),
    check(t("settings.alertSound"), p.alertSound, (v) => savePrefs({ alertSound: v })),
    list,
  );
}

export function mount(root: HTMLElement) {
  const offs: (() => void)[] = [];
  const page = h("div", { class: "page" });
  root.append(page);
  const lang = h(
    "select",
    { onchange: (e: Event) => setLang((e.target as HTMLSelectElement).value as "pt-BR" | "en-US") },
    LANGS.map((l) => h("option", { value: l.id, selected: l.id === getLang() }, l.label)),
  );
  const swatch = (id: Theme) =>
    id === "system"
      ? [THEME_SWATCH.light[0], THEME_SWATCH.light[2], THEME_SWATCH.dark[0], THEME_SWATCH.dark[2]]
      : THEME_SWATCH[id];
  const cards: HTMLButtonElement[] = [];
  const theme = h(
    "div",
    { class: "theme-grid", role: "radiogroup", "aria-label": t("settings.theme") },
    THEMES.map((id) => {
      const card = h(
        "button",
        {
          type: "button",
          role: "radio",
          class: "theme-card",
          "aria-checked": String(id === getTheme()),
          onclick: () => {
            applyTheme(id);
            cards.forEach((c) => c.setAttribute("aria-checked", String(c === card)));
          },
        },
        h("span", { class: "swatch", "aria-hidden": "true" }, swatch(id).map((c) => h("span", { style: `background:${c}` }))),
        h("strong", null, t(`settings.themes.${id}.name`)),
        h("small", null, t(`settings.themes.${id}.desc`)),
      );
      cards.push(card);
      return card;
    }),
  );
  page.append(
    h("h1", null, t("settings.title")),
    section(
      t("settings.appearance"),
      h("label", { class: "field" }, h("span", null, t("settings.language")), lang),
      h("div", { class: "field" }, h("span", { class: "label" }, t("settings.theme")), theme),
    ),
    profilesSection(offs),
    unitsSection(),
    connectionSection(),
    pricesSection(),
    alertsSection(offs),
    section(
      t("settings.about"),
      h("p", null, h("strong", null, t("app.name")), " — ", t("settings.version", { version: state.appVersion })),
      state.portableData ? h("p", null, t("settings.portable", { folder: state.portableData })) : null,
      h("p", null, t("settings.aboutText")),
      h("p", null, button(t("safety.review"), () => openSafetyNotice(true), "secondary")),
      h(
        "p",
        { class: "muted small" },
        `${t("settings.source")}: `,
        h(
          "a",
          {
            href: REPO_URL,
            onclick: (e: Event) => {
              e.preventDefault();
              openUrl(REPO_URL).catch(() => undefined);
            },
          },
          "github.com/samuvieceli/obd2-scanner",
        ),
      ),
    ),
  );
  return () => offs.forEach((f) => f());
}
