// Settings: language, theme and about.
import { getLang, LANGS, setLang, t } from "../i18n";
import { state } from "../store";
import { applyTheme, getTheme, type Theme } from "../theme";
import { h, section } from "../ui";

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  const lang = h(
    "select",
    { onchange: (e: Event) => setLang((e.target as HTMLSelectElement).value as "pt-BR" | "en-US") },
    LANGS.map((l) => h("option", { value: l.id, selected: l.id === getLang() }, l.label)),
  );
  const themes: [Theme, string][] = [
    ["dark", t("settings.themeDark")],
    ["light", t("settings.themeLight")],
    ["system", t("settings.themeSystem")],
  ];
  const theme = h(
    "select",
    { onchange: (e: Event) => applyTheme((e.target as HTMLSelectElement).value as Theme) },
    themes.map(([id, label]) => h("option", { value: id, selected: id === getTheme() }, label)),
  );
  page.append(
    h("h1", null, t("settings.title")),
    section(
      t("settings.title"),
      h("label", { class: "field" }, h("span", null, t("settings.language")), lang),
      h("label", { class: "field" }, h("span", null, t("settings.theme")), theme),
    ),
    section(
      t("settings.about"),
      h("p", null, h("strong", null, t("app.name")), " — ", t("settings.version", { version: state.appVersion })),
      h("p", null, t("settings.aboutText")),
      h("p", { class: "muted small" }, `${t("settings.source")}: https://github.com/samuvieceli/obd2-scanner`),
    ),
  );
}
