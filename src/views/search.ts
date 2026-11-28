// Global search window, opened by Ctrl+F, Ctrl+K or the search button in the
// top bar. Finds screens, parameters (PIDs), glossary terms, readiness
// monitors and trouble codes; Enter or a click opens the right screen.
import { api } from "../api";
import { getLang, msgs, pidText, t } from "../i18n";
import { isDtcCode, search, type Entry, type Kind } from "../search";
import { state } from "../store";
import { clear, h } from "../ui";
import { openDtcLookup } from "./diagnostics";
import { openGlossary } from "./glossary";

let open: HTMLElement | null = null;
let screens: string[] = [];

function entries(): Entry[] {
  const out: Entry[] = screens.map((id) => ({ kind: "screen" as Kind, id, title: t(`nav.${id}`) }));
  for (const m of state.catalog) {
    const p = pidText(m.key);
    out.push({ kind: "pid", id: m.key, title: p.name, alias: p.short, detail: p.desc });
  }
  for (const x of msgs().terms) out.push({ kind: "term", id: x.term, title: x.term, detail: x.desc });
  for (const [id, m] of Object.entries(msgs().monitors)) out.push({ kind: "monitor", id, title: m.name, detail: m.desc });
  // Codes already read from the car.
  const d = state.dtcs;
  if (d) {
    for (const c of [...d.stored, ...d.pending, ...d.permanent]) {
      if (!out.some((e) => e.kind === "dtc" && e.id === c.code)) out.push({ kind: "dtc", id: c.code, title: c.code, detail: c.description });
    }
  }
  return out;
}

function go(e: Entry) {
  close();
  switch (e.kind) {
    case "screen":
      location.hash = `#/${e.id}`;
      break;
    case "pid":
      openGlossary(undefined, `pid-${e.id}`);
      break;
    case "term":
    case "monitor":
      openGlossary(e.title);
      break;
    case "dtc":
      openDtcLookup(e.id);
      break;
  }
}

export function close() {
  open?.remove();
  open = null;
}

export function openSearch() {
  if (open) {
    open.querySelector("input")?.select();
    return;
  }
  const all = entries();
  const input = h("input", {
    type: "search",
    class: "search-input",
    placeholder: t("search.placeholder"),
    "aria-label": t("search.title"),
    autocomplete: "off",
    spellcheck: "false",
  });
  const list = h("ul", { class: "search-results", role: "listbox", "aria-label": t("search.title") });
  let shown: Entry[] = [];
  let sel = 0;
  let seq = 0;

  const paint = () => {
    clear(list);
    const q = input.value.trim();
    if (!q) {
      list.append(h("li", { class: "muted small search-hint" }, t("search.hint")));
      return;
    }
    if (!shown.length) {
      list.append(h("li", { class: "muted search-hint" }, t("search.none")));
      return;
    }
    shown.forEach((e, i) =>
      list.append(
        h(
          "li",
          {
            role: "option",
            class: `search-item ${i === sel ? "on" : ""}`,
            "aria-selected": i === sel ? "true" : "false",
            onmousedown: (ev: Event) => {
              ev.preventDefault();
              go(e);
            },
            onmousemove: () => {
              if (sel !== i) {
                sel = i;
                paint();
              }
            },
          },
          h("span", { class: `search-kind kind-${e.kind}` }, t(`search.kinds.${e.kind}`)),
          h(
            "span",
            { class: "search-text" },
            h("strong", null, e.title),
            e.alias && e.alias !== e.title ? h("span", { class: "muted" }, ` · ${e.alias}`) : "",
            e.detail ? h("span", { class: "muted small search-detail" }, e.detail) : "",
          ),
        ),
      ),
    );
    list.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  };

  const update = async () => {
    const q = input.value.trim();
    const mine = ++seq;
    shown = search(q, all);
    sel = 0;
    paint();
    // A full code is looked up in the code list even when it was not read.
    if (isDtcCode(q) && !shown.some((e) => e.kind === "dtc" && e.id === q.toUpperCase())) {
      try {
        const d = await api.describeDtc(q.toUpperCase(), getLang());
        if (mine !== seq) return;
        shown = [{ kind: "dtc", id: d.code, title: d.code, detail: d.description }, ...shown];
        paint();
      } catch {
        /* offline lookup failed: keep the other results */
      }
    }
  };

  input.addEventListener("input", () => void update());
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[sel]) go(shown[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  const box = h(
    "div",
    { class: "overlay overlay-top", onmousedown: (e: Event) => e.target === box && close() },
    h(
      "div",
      { class: "card sheet search-sheet", role: "dialog", "aria-modal": "true", "aria-label": t("search.title") },
      input,
      list,
      h("p", { class: "muted small search-keys" }, t("search.keys")),
    ),
  );
  document.body.append(box);
  open = box;
  paint();
  input.focus();
}

/** Ctrl+F and Ctrl+K open the search from anywhere. */
export function initSearch(routeIds: string[]) {
  screens = routeIds;
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.key.toLowerCase() !== "f" && e.key.toLowerCase() !== "k") return;
    e.preventDefault();
    if (document.body.classList.contains("mini-mode")) return;
    openSearch();
  });
}
