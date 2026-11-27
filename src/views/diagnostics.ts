// Trouble codes: read / clear DTCs, freeze frame and code lookup.
import { ask } from "@tauri-apps/plugin-dialog";
import { api, type DtcInfo } from "../api";
import { getLang, pidText, t } from "../i18n";
import { state } from "../store";
import { busy, button, clear, fmtValue, h, infoTip, notConnected, pidTip, section, toast, unitOf } from "../ui";

function dtcItem(d: DtcInfo): HTMLElement {
  return h(
    "li",
    { class: "dtc" },
    h("span", { class: `code code-${d.code[0]}` }, d.code),
    h(
      "div",
      null,
      h("p", { class: "dtc-desc" }, d.description),
      h(
        "p",
        { class: "muted small" },
        `${t("dtc.system")}: ${d.system} · `,
        h("span", { class: `badge ${d.generic ? "" : "badge-warn"}` }, d.generic ? t("dtc.generic") : t("dtc.specific")),
      ),
    ),
  );
}

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  page.append(h("h1", null, t("dtc.title")), h("p", { class: "lead" }, t("dtc.intro")));

  // Lookup works offline, even without a connection.
  const lookupResult = h("div");
  const lookupInput = h("input", { type: "text", placeholder: t("dtc.lookupPlaceholder"), maxlength: 5, "aria-label": t("dtc.lookup") });
  const doLookup = async () => {
    clear(lookupResult);
    const code = lookupInput.value.trim().toUpperCase();
    if (!/^[PCBU][0-3][0-9A-F]{3}$/.test(code)) {
      lookupResult.append(h("p", { class: "muted" }, t("dtc.lookupInvalid")));
      return;
    }
    const d = await api.describeDtc(code, getLang());
    lookupResult.append(h("ul", { class: "dtc-list" }, dtcItem(d)));
  };
  lookupInput.addEventListener("keydown", (e) => e.key === "Enter" && doLookup());
  const lookupCard = section(
    t("dtc.lookup"),
    h("div", { class: "row" }, lookupInput, button(t("common.search"), doLookup, "secondary")),
    lookupResult,
  );

  if (state.connection !== "connected") {
    page.append(notConnected(), lookupCard);
    return;
  }

  const lists = h("div", { class: "dtc-columns" });
  const freezeBox = h("div");

  const renderLists = () => {
    clear(lists);
    const r = state.dtcs;
    const col = (title: string, desc: string, items: DtcInfo[] | undefined) =>
      h(
        "section",
        { class: "card" },
        h("h2", null, title, " ", infoTip(desc), items ? h("span", { class: "count" }, String(items.length)) : null),
        !items
          ? h("p", { class: "muted" }, t("dtc.notRead"))
          : items.length
            ? h("ul", { class: "dtc-list" }, items.map(dtcItem))
            : h("p", { class: "ok-text" }, t("dtc.noCodes")),
      );
    lists.append(
      col(t("dtc.stored"), t("dtc.storedDesc"), r?.stored),
      col(t("dtc.pending"), t("dtc.pendingDesc"), r?.pending),
      col(t("dtc.permanent"), t("dtc.permanentDesc"), r?.permanent),
    );
  };

  const renderFreeze = () => {
    clear(freezeBox);
    const f = state.freeze;
    if (!f) return;
    if (!f.dtc) {
      freezeBox.append(h("p", { class: "muted" }, t("dtc.freezeFrameNone")));
      return;
    }
    freezeBox.append(
      h("p", null, `${t("dtc.causedBy")}: `, h("strong", null, f.dtc.code), ` — ${f.dtc.description}`),
      h(
        "table",
        { class: "table" },
        h(
          "tbody",
          null,
          f.values.map((v) =>
            h("tr", null, h("th", null, pidText(v.key).name, " ", pidTip(v.key)), h("td", { class: "num" }, `${fmtValue(v.key, v.value)} ${unitOf(v.key)}`)),
          ),
        ),
      ),
    );
  };

  const readBtn = button(t("dtc.readCodes"), async () => {
    const r = await busy(readBtn, () => api.readDtcs(getLang()));
    if (r) {
      state.dtcs = r;
      renderLists();
    }
  }, "primary");
  const clearBtn = button(t("dtc.clearCodes"), async () => {
    const ok = await ask(t("dtc.clearConfirm"), { title: t("dtc.clearConfirmTitle"), kind: "warning", okLabel: t("dtc.clearCodes"), cancelLabel: t("common.cancel") });
    if (!ok) return;
    const res = await busy(clearBtn, async () => {
      await api.clearDtcs();
      return true;
    });
    if (res) {
      toast(t("dtc.cleared"), "ok");
      state.dtcs = null;
      state.freeze = null;
      renderLists();
      renderFreeze();
    }
  }, "danger");
  const ffBtn = button(t("dtc.readFreezeFrame"), async () => {
    const f = await busy(ffBtn, () => api.readFreezeFrame(getLang()));
    if (f) {
      state.freeze = f;
      renderFreeze();
    }
  }, "secondary");

  page.append(
    h("div", { class: "toolbar" }, readBtn, clearBtn),
    lists,
    section(t("dtc.freezeFrame"), h("p", { class: "muted small" }, t("dtc.freezeFrameDesc")), ffBtn, freezeBox),
    lookupCard,
  );
  renderLists();
  renderFreeze();
}
