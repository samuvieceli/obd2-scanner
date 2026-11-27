// Settings: language, theme, vehicle (for fuel calculations), alerts, about.
import { getLang, LANGS, setLang, t } from "../i18n";
import { state } from "../store";
import { applyTheme, getTheme, THEME_SWATCH, THEMES, type Theme } from "../theme";
import { button, clear, h, infoTip, section } from "../ui";
import { DEFAULT_ALERTS, prefs, savePrefs, type AlertRule, type FuelType } from "../prefs";
import { pidText } from "../i18n";
import { openUrl } from "@tauri-apps/plugin-opener";

const REPO_URL = "https://github.com/samuvieceli/obd2-scanner";
const FUELS: FuelType[] = ["auto", "gasoline_e27", "ethanol", "gasoline_pure", "diesel"];

function vehicleSection(): HTMLElement {
  const p = prefs();
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
  return section(
    t("settings.vehicle"),
    h("p", { class: "muted small" }, t("settings.vehicleIntro")),
    h(
      "label",
      { class: "field" },
      h("span", null, t("settings.fuel")),
      h(
        "select",
        { onchange: (e: Event) => savePrefs({ fuel: (e.target as HTMLSelectElement).value as FuelType }) },
        FUELS.map((f) => h("option", { value: f, selected: f === p.fuel }, t(`settings.fuels.${f}`))),
      ),
    ),
    h(
      "div",
      { class: "row" },
      num(t("settings.displacement"), t("settings.displacementHelp"), p.displacementL, 0.1, 0.6, 8, (v) => savePrefs({ displacementL: v })),
      num(t("settings.efficiency"), t("settings.efficiencyHelp"), Math.round(p.volumetricEff * 100), 1, 50, 120, (v) => savePrefs({ volumetricEff: v / 100 })),
    ),
  );
}

function alertsSection(): HTMLElement {
  const list = h("div", { class: "alert-rules" });
  const render = () => {
    clear(list);
    const rules = prefs().alerts;
    const update = (i: number, change: Partial<AlertRule>) => {
      const next = rules.map((r, j) => (j === i ? { ...r, ...change } : r));
      savePrefs({ alerts: next });
    };
    const limit = (i: number, which: "below" | "above", v: number | null) =>
      h("input", {
        type: "number",
        step: "any",
        value: v === null ? "" : String(v),
        placeholder: "—",
        "aria-label": t(`settings.alert${which === "below" ? "Below" : "Above"}`),
        onchange: (e: Event) => {
          const raw = (e.target as HTMLInputElement).value.trim();
          update(i, { [which]: raw === "" ? null : Number(raw) });
        },
      });
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
              h("td", null, pidText(r.key).name, h("span", { class: "muted small" }, ` (${state.catalog.find((m) => m.key === r.key)?.unit ?? ""})`)),
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
                  savePrefs({ alerts: rules.filter((_, j) => j !== i) });
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
          savePrefs({ alerts: [...prefs().alerts, { key: add.value, below: null, above: null, enabled: true }] });
          render();
        }, "secondary"),
        button(t("settings.alertDefaults"), () => {
          savePrefs({ alerts: structuredClone(DEFAULT_ALERTS) });
          render();
        }, "ghost"),
      ),
    );
  };
  render();
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
    vehicleSection(),
    alertsSection(),
    section(
      t("settings.about"),
      h("p", null, h("strong", null, t("app.name")), " — ", t("settings.version", { version: state.appVersion })),
      h("p", null, t("settings.aboutText")),
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
}
