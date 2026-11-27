// Glossary: every parameter, readiness monitor and technical term explained.
import { msgs, pidText, t } from "../i18n";
import { state } from "../store";
import { clear, h, section, unitOf } from "../ui";
import type { Category } from "../api";

const CATS: Category[] = ["engine", "fuel", "air", "temperature", "emissions", "electrical", "vehicle"];

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  const body = h("div");
  const search = h("input", { type: "search", placeholder: t("common.search"), "aria-label": t("common.search"), class: "grow" });
  page.append(h("h1", null, t("glossary.title")), h("p", { class: "lead" }, t("glossary.intro")), h("div", { class: "row" }, search), body);

  const match = (q: string, ...texts: string[]) => !q || texts.some((x) => x.toLowerCase().includes(q));

  const render = () => {
    clear(body);
    const q = search.value.trim().toLowerCase();

    const terms = msgs().terms.filter((x) => match(q, x.term, x.desc));
    if (terms.length) {
      body.append(section(t("glossary.terms"), h("dl", { class: "glossary" }, terms.flatMap((x) => [h("dt", null, x.term), h("dd", null, x.desc)]))));
    }

    const catalog = [...state.catalog];
    const pidSection = section(t("glossary.parameters"));
    let anyPid = false;
    for (const cat of CATS) {
      const items = catalog.filter((m) => m.category === cat).filter((m) => {
        const p = pidText(m.key);
        return match(q, p.name, p.short, p.desc, m.key);
      });
      if (!items.length) continue;
      anyPid = true;
      pidSection.append(
        h("h3", null, t(`categories.${cat}`)),
        h(
          "dl",
          { class: "glossary" },
          items.flatMap((m) => {
            const p = pidText(m.key);
            const unit = unitOf(m.key);
            return [
              h("dt", { id: `pid-${m.key}` }, p.name, h("span", { class: "muted small" }, ` · ${p.short}${unit ? ` · ${unit}` : ""}${m.pid ? ` · PID ${m.pid.toString(16).toUpperCase().padStart(2, "0")}` : ""}`)),
              h("dd", null, p.desc, p.typical && p.typical !== "—" ? h("span", { class: "typical" }, `${t("glossary.typical")}: ${p.typical}`) : null),
            ];
          }),
        ),
      );
    }
    if (anyPid) body.append(pidSection);

    const mons = Object.entries(msgs().monitors).filter(([, m]) => match(q, m.name, m.desc));
    if (mons.length) {
      body.append(section(t("glossary.monitorsTitle"), h("dl", { class: "glossary" }, mons.flatMap(([, m]) => [h("dt", null, m.name), h("dd", null, m.desc)]))));
    }
  };
  search.addEventListener("input", render);
  render();
}
