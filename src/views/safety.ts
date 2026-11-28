// "Antes de usar" window: safety notice shown at start until confirmed
// (see safety.ts), and again on request from Settings → About.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getLang, LANGS, onLangChange, t, type Lang } from "../i18n";
import { changeLanguage } from "../units";
import { button, h } from "../ui";
import { acceptSafety, SAFETY_ITEMS, safetyPending } from "../safety";

let open: HTMLElement | null = null;
let openReview = false;

function close() {
  open?.remove();
  open = null;
}

// The language can be picked right in the notice (first start), so it
// redraws itself in the new language.
onLangChange(() => {
  if (open) openSafetyNotice(openReview);
});

/**
 * `review` = opened from Settings: just a "Close" button. Otherwise the user
 * must confirm ("Li e concordo") or leave the program; Escape and clicks
 * outside do nothing, so it is not dismissed by accident.
 */
export function openSafetyNotice(review = false) {
  close();
  openReview = review;
  const lang = h(
    "select",
    { class: "lang-select", "aria-label": t("settings.language"), onchange: (e: Event) => changeLanguage((e.target as HTMLSelectElement).value as Lang) },
    LANGS.map((l) => h("option", { value: l.id, selected: l.id === getLang() }, l.label)),
  );
  const ok = button(review ? t("common.close") : t("safety.accept"), () => {
    if (!review) acceptSafety();
    close();
  }, "primary");
  const box = h(
    "div",
    {
      class: "overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "safety-title",
      onclick: (e: Event) => review && e.target === box && close(),
      onkeydown: (e: KeyboardEvent) => review && e.key === "Escape" && close(),
    },
    h(
      "div",
      { class: "card sheet safety-sheet" },
      h("div", { class: "row safety-head" }, h("h2", { id: "safety-title", class: "grow" }, t("safety.title")), lang),
      h("p", { class: "muted" }, t("safety.intro")),
      h(
        "ol",
        { class: "safety-list" },
        SAFETY_ITEMS.map((id) => h("li", null, h("strong", null, t(`safety.items.${id}.title`)), " ", t(`safety.items.${id}.text`))),
      ),
      h(
        "div",
        { class: "row" },
        ok,
        review ? null : button(t("safety.decline"), () => void getCurrentWindow().close().catch(() => undefined), "ghost"),
      ),
      review ? null : h("p", { class: "muted small" }, t("safety.reviewHint")),
    ),
  );
  document.body.append(box);
  open = box;
  ok.focus();
}

/** At start: show the notice if it was never confirmed or its text changed. */
export function initSafety() {
  if (safetyPending()) openSafetyNotice();
}
