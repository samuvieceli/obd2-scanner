// "Manufacturer parameters" part of the dashboard's parameter picker: choose
// the car model, optionally show experimental parameters, tick parameters.
// The chosen ones join the live parameters like any other (cards, charts,
// recordings). Data and rules: ../maker.ts.
import { t } from "../i18n";
import { chooseMakerModel, makerExperimental, makerModels, makerOffered, makerYear, setMakerExperimental, suggestedModels } from "../maker";
import { profile } from "../prefs";
import { normalize } from "../search";
import { adapterIsCan, state } from "../store";
import { h } from "../ui";

/** Re-rendered by the dashboard picker; `apply` saves the live keys. */
export function makerPicker(query: string, apply: (keys: string[]) => void): HTMLElement {
  const box = h("div", { class: "maker-picker" });
  const models = makerModels();
  if (!models.length) return box;
  const chosen = profile().makerModel ?? "";
  const suggested = suggestedModels();
  const ordered = [...suggested, ...models.filter((m) => !suggested.includes(m))];

  const select = h(
    "select",
    {
      "aria-label": t("maker.model"),
      onchange: (e: Event) => void chooseMakerModel((e.target as HTMLSelectElement).value || null),
    },
    h("option", { value: "", selected: !chosen }, t("maker.none")),
    ordered.map((m) =>
      h("option", { value: m.id, selected: m.id === chosen }, `${m.make} ${m.model} (${t("maker.count", { verified: m.verified, total: m.params })})`),
    ),
  );
  box.append(
    h("h3", null, t("maker.title")),
    h("p", { class: "muted small" }, t("maker.intro")),
    h("label", { class: "row" }, h("span", null, t("maker.model")), select),
  );
  if (suggested.length) box.append(h("p", { class: "muted small" }, t("maker.suggested", { make: suggested[0].make })));
  if (!chosen) return box;

  if (state.adapter && !state.playback && !adapterIsCan()) box.append(h("p", { class: "maker-warn small" }, t("maker.needsCan")));
  box.append(
    h(
      "label",
      { class: "check" },
      h("input", {
        type: "checkbox",
        checked: makerExperimental(),
        onchange: (e: Event) => setMakerExperimental((e.target as HTMLInputElement).checked),
      }),
      h("span", null, t("maker.experimental")),
    ),
    h("p", { class: "muted small" }, t("maker.source"), " ", t("maker.slower")),
    // The model year decides which requests apply and what is confirmed.
    h("p", { class: "muted small" }, makerYear() ? t("maker.year", { year: String(makerYear()) }) : t("maker.yearUnknown")),
  );

  // Grouped like OBDb groups them; filtered by the picker's search box.
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const params = [...state.maker.values()].filter(
    (p) => (makerOffered(p) || state.liveKeys.includes(p.key)) && words.every((w) => normalize(`${p.name} ${p.key}`).includes(w)),
  );
  const groups = new Map<string, typeof params>();
  for (const p of params) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  const list = h("div", { class: "maker-list" });
  for (const [group, items] of groups) {
    const legend = t(`maker.group.${group}`);
    list.append(
      h(
        "fieldset",
        null,
        h("legend", null, legend.startsWith("maker.") ? group : legend),
        items.map((p) =>
          h(
            "label",
            { class: "check", title: t(p.verified ? "maker.tipVerified" : "maker.tipExperimental") },
            h("input", {
              type: "checkbox",
              checked: state.liveKeys.includes(p.key),
              onchange: (e: Event) => {
                const on_ = (e.target as HTMLInputElement).checked;
                apply(on_ ? [...state.liveKeys, p.key] : state.liveKeys.filter((k) => k !== p.key));
              },
            }),
            h("span", null, p.name),
            p.verified ? "" : h("span", { class: "badge badge-warn" }, t("maker.badge")),
          ),
        ),
      ),
    );
  }
  if (!params.length) box.append(h("p", { class: "muted small" }, t("maker.noneShown")));
  box.append(list);
  return box;
}
