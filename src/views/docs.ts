// Documentation: a start page (what the program knows, shortcuts) and the
// project's documents (how to use, Brazilian cars, diagrams, credits and
// licenses...), read inside the program. Diagrams are drawn by Mermaid,
// loaded only when a document with diagrams is opened.
import { marked } from "marked";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, type DataInfo } from "../api";
import { fmtNum, getLang, LANGS, msgs, t } from "../i18n";
import { state } from "../store";
import { THEMES } from "../theme";
import { button, clear, escapeHtml, h } from "../ui";
import { REPO_URL, docById, docsFor, resolveLink, slugger, type Doc } from "../docs";
import { openSafetyNotice } from "./safety";

/** Document open last time (kept while the program runs). */
let current = "home";
/** Set by the global search or a link: document and section to show. */
let pending: { doc: string; anchor?: string } | null = null;

export function openDocs(doc: string, anchor?: string) {
  pending = { doc, anchor };
  if (location.hash === "#/docs") window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = "#/docs";
}

// Raw HTML inside the documents is shown as text, never run.
marked.use({ gfm: true, renderer: { html: ({ text }) => escapeHtml(text) } });

export function mount(root: HTMLElement) {
  const offs: (() => void)[] = [];
  const page = h("div", { class: "page" });
  root.append(page);
  const side = h("nav", { class: "docs-list", "aria-label": t("docs.title") });
  const body = h("article", { class: "card docs-body" });
  page.append(h("h1", null, t("docs.title")), h("p", { class: "lead" }, t("docs.intro")));
  page.append(h("div", { class: "docs-layout" }, side, body));

  const show = (id: string, anchor?: string) => {
    current = docById(id, getLang()) ? id : "home";
    clear(side);
    for (const d of ["home", ...docsFor(getLang()).map((x) => x.id)]) {
      side.append(
        h(
          "button",
          { type: "button", class: `docs-item ${d === current ? "on" : ""}`, "aria-current": d === current ? "page" : false, onclick: () => show(d) },
          h("strong", null, t(`docs.list.${d}.title`)),
          h("span", { class: "muted small" }, t(`docs.list.${d}.desc`)),
        ),
      );
    }
    clear(body);
    const doc = docById(current, getLang());
    if (doc) renderDoc(body, doc, show, offs);
    else renderHome(body, show);
    if (anchor) scrollToAnchor(body, anchor);
    else body.scrollIntoView({ block: "nearest" });
  };

  const want = pending;
  pending = null;
  show(want?.doc ?? current, want?.anchor);
  return () => offs.forEach((f) => f());
}

function scrollToAnchor(body: HTMLElement, id: string) {
  const el = id ? body.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) : null;
  if (!el) return;
  el.classList.add("flash");
  requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
}

function external(url: string) {
  openUrl(url).catch(() => window.open(url, "_blank", "noopener"));
}

function renderDoc(body: HTMLElement, doc: Doc, show: (id: string, anchor?: string) => void, offs: (() => void)[]) {
  const md = h("div", { class: "md" });
  md.innerHTML = marked.parse(doc.text, { async: false });

  // Heading ids follow GitHub's rule, so links between sections work.
  const id = slugger();
  const toc: { id: string; text: string }[] = [];
  md.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6").forEach((el) => {
    el.id = id(el.textContent ?? "");
    if (el.tagName === "H2") toc.push({ id: el.id, text: el.textContent ?? "" });
  });
  // Tables of numbered rules: keep the number ("T10") on one line.
  md.querySelectorAll("table").forEach((tb) => tb.querySelector("th")?.textContent === "#" && tb.classList.add("numbered"));

  // Links: sections and other documents open here, the rest in the browser.
  md.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!a || href === null || href === undefined) return;
    e.preventDefault();
    const to = resolveLink(href, doc.file, getLang());
    if (to.kind === "anchor") scrollToAnchor(body, to.id);
    else if (to.kind === "doc") show(to.id, to.anchor);
    else external(to.url);
  });

  const jump = h(
    "select",
    { "aria-label": t("docs.jump"), onchange: () => jump.value && scrollToAnchor(body, jump.value) },
    h("option", { value: "" }, t("docs.jump")),
    toc.map((x) => h("option", { value: x.id }, x.text)),
  );
  body.append(
    h(
      "div",
      { class: "docs-bar" },
      toc.length > 1 ? jump : null,
      button(t("docs.github"), () => external(`${REPO_URL}/blob/main/${doc.file}`), "ghost"),
    ),
    md,
  );

  const diagrams = [...md.querySelectorAll<HTMLElement>("pre > code.language-mermaid")].map((code) => {
    const box = h("div", { class: "diagram", "data-src": code.textContent ?? "" }, h("p", { class: "muted small" }, t("docs.drawing")));
    code.parentElement!.replaceWith(box);
    return box;
  });
  if (!diagrams.length) return;
  const draw = () => void drawDiagrams(diagrams);
  draw();
  window.addEventListener("themechange", draw);
  offs.push(() => window.removeEventListener("themechange", draw));
}

let seq = 0;

/** Draws the Mermaid diagrams with the colors of the current theme. */
async function drawDiagrams(boxes: HTMLElement[]) {
  const mine = ++seq;
  let mermaid: typeof import("mermaid").default;
  try {
    mermaid = (await import("mermaid")).default;
  } catch {
    boxes.forEach((b) => showSource(b, t("docs.diagramError")));
    return;
  }
  const color = (name: string, fallback: string) => {
    // Computed colors are always rgb(): Mermaid needs a color it can parse.
    const probe = h("span", { style: `color: var(${name}, ${fallback})` });
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c || fallback;
  };
  const bg = color("--surface", "#111a2c");
  const dark = luminance(bg) < 0.4;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: getComputedStyle(document.body).fontFamily,
    themeVariables: {
      darkMode: dark,
      background: bg,
      primaryColor: color("--surface-2", bg),
      primaryTextColor: color("--text", "#e6edf7"),
      primaryBorderColor: color("--accent", "#22d3ee"),
      secondaryColor: bg,
      tertiaryColor: color("--bg", "#0b1220"),
      lineColor: color("--muted", "#8ea0bd"),
      textColor: color("--text", "#e6edf7"),
      clusterBkg: bg,
      clusterBorder: color("--border", "#243352"),
      noteBkgColor: color("--surface-2", bg),
      noteTextColor: color("--text", "#e6edf7"),
      edgeLabelBackground: bg,
      fontSize: "14px",
    },
  });
  for (const [i, box] of boxes.entries()) {
    if (mine !== seq || !box.isConnected) return;
    try {
      const { svg } = await mermaid.render(`diagram-${mine}-${i}`, box.dataset.src ?? "");
      if (mine !== seq) return;
      box.innerHTML = svg;
      fitDiagram(box);
    } catch {
      showSource(box, t("docs.diagramError"));
    }
  }
}

/**
 * Wide diagrams are shrunk to fit; a click shows them at real size (with a
 * scroll bar) and another click shrinks them back.
 */
function fitDiagram(box: HTMLElement) {
  const svg = box.querySelector("svg");
  const width = svg?.viewBox.baseVal?.width ?? 0;
  if (!svg || !width) return;
  svg.style.width = `${width}px`;
  const wide = width > box.clientWidth;
  box.classList.toggle("zoomable", wide);
  box.title = wide ? t("docs.zoom") : "";
  box.onclick = wide ? () => box.classList.toggle("zoomed") : null;
}

function showSource(box: HTMLElement, message: string) {
  clear(box);
  box.append(h("p", { class: "muted small" }, message), h("pre", null, h("code", null, box.dataset.src ?? "")));
}

/** 0 (black) to 1 (white), from "rgb(r, g, b)". */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"]).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Start page: what is in this screen, the program's data and shortcuts. */
function renderHome(body: HTMLElement, show: (id: string) => void) {
  const data = h("dl", { class: "docs-data" });
  const row = (label: string, value: string, help: string) =>
    data.append(h("dt", null, label), h("dd", null, h("strong", null, value), h("span", { class: "muted small" }, help)));
  const n = (x: number) => fmtNum(x, 0);

  const fill = (info: DataInfo | null) => {
    clear(data);
    row(t("docs.data.pids"), state.catalog.length ? n(state.catalog.length) : "—", t("docs.data.pidsHelp"));
    if (info) {
      row(t("docs.data.dtcs"), n(info.dtc.codes), t("docs.data.dtcsHelp", { pt: n(info.dtc.translatedPt) }));
      const brands = info.dtc.brands.reduce((s, [, c]) => s + c, 0);
      row(
        t("docs.data.brands"),
        n(info.dtc.brands.length),
        t("docs.data.brandsHelp", {
          codes: n(brands),
          list: info.dtc.brands.map(([b]) => (b.length <= 3 ? b.toUpperCase() : b.charAt(0).toUpperCase() + b.slice(1))).join(", "),
        }),
      );
      row(t("docs.data.wmis"), n(info.wmis), t("docs.data.wmisHelp"));
    }
    row(t("docs.data.standards"), n(Object.keys(msgs().obdStandards).length), t("docs.data.standardsHelp"));
    row(t("docs.data.glossary"), n(msgs().terms.length + Object.keys(msgs().monitors).length), t("docs.data.glossaryHelp"));
    row(t("docs.data.languages"), n(LANGS.length), LANGS.map((l) => l.label).join(", "));
    row(t("docs.data.themes"), n(THEMES.length), t("docs.data.themesHelp"));
  };
  fill(null);
  api.dataInfo().then(fill, () => undefined);

  body.append(
    h("h2", null, t("docs.home.title")),
    h("p", null, t("docs.home.text")),
    h(
      "div",
      { class: "docs-shortcuts" },
      button(t("docs.home.howto"), () => show("howto"), "primary"),
      h("a", { class: "btn btn-secondary", href: "#/glossary" }, t("nav.glossary")),
      button(t("docs.home.diagrams"), () => show("diagrams")),
      button(t("safety.review"), () => openSafetyNotice(true)),
    ),
    h("h2", null, t("docs.data.title")),
    h("p", { class: "muted" }, t("docs.data.intro")),
    data,
    h(
      "p",
      { class: "muted small" },
      t("docs.data.sources"),
      " ",
      h("a", { href: "#", onclick: (e: Event) => (e.preventDefault(), show("credits")) }, t("docs.list.credits.title")),
      ".",
    ),
    h("h2", null, t("docs.home.openSource")),
    h("p", null, t("docs.home.openSourceText")),
    h("p", null, h("a", { href: REPO_URL, onclick: (e: Event) => (e.preventDefault(), external(REPO_URL)) }, "github.com/samuvieceli/obd2-scanner")),
  );
}
