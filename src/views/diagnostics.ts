// Trouble codes: read / clear DTCs, freeze frame and code lookup.
import { ask } from "@tauri-apps/plugin-dialog";
import { api, type DtcInfo, type TestResult } from "../api";
import { fmtNum, getLang, pidText, t } from "../i18n";
import { state } from "../store";
import { copyCard, drawCard, type Line } from "../share";
import { busy, button, clear, errorText, fmtValue, h, infoTip, notConnected, pidTip, section, toast, unitOf } from "../ui";

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
        d.brand ? h("span", { class: "badge" }, t("dtc.brandTable", { brand: d.brand.toUpperCase() })) : null,
      ),
      !d.translated && t("dtc.notTranslated") ? h("p", { class: "muted small" }, t("dtc.notTranslated")) : null,
    ),
  );
}

const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(2, "0")}`;

export function monitorName(r: TestResult): string {
  const bankSensor = { bank: Math.floor((r.index - 1) / 4) + 1, sensor: ((r.index - 1) % 4) + 1 };
  return t(`mode06.groups.${r.group}`, { n: r.index, id: hex(r.mid), ...bankSensor });
}

export function testName(r: TestResult): string {
  return r.test ? t(`mode06.tests.${r.test}`) : t("mode06.manufacturerTest", { id: hex(r.tid) });
}

function decimals(r: TestResult): number {
  const span = Math.max(Math.abs(r.min), Math.abs(r.max), Math.abs(r.value));
  if (!r.scaled || Number.isInteger(r.value) && Number.isInteger(r.min) && Number.isInteger(r.max)) return 0;
  return span >= 100 ? 1 : span >= 1 ? 2 : 3;
}

export function fmtTest(r: TestResult, v: number): string {
  return `${fmtNum(v, decimals(r))}${r.unit ? ` ${r.unit}` : ""}`;
}

/** Set by the global search: a code to look up when the screen opens. */
let pendingCode: string | null = null;
export function openDtcLookup(code: string) {
  pendingCode = code;
  location.hash = "#/diagnostics";
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
  if (pendingCode) {
    lookupInput.value = pendingCode;
    pendingCode = null;
    void doLookup();
    requestAnimationFrame(() => lookupInput.scrollIntoView({ block: "center" }));
  }
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

  // Picture of the codes (and the freeze frame, if read) for a mechanic.
  const shareBtn = button(t("share.copy"), async () => {
    const r = state.dtcs;
    if (!r) {
      toast(t("share.readFirst"), "info");
      return;
    }
    const lines: Line[] = [];
    const block = (title: string, items: DtcInfo[]) => {
      lines.push({ text: `${title}: ${items.length}`, bold: true, gap: true });
      for (const d of items) lines.push({ tag: d.code, text: d.description });
    };
    block(t("dtc.stored"), r.stored);
    block(t("dtc.pending"), r.pending);
    if (r.permanent.length) block(t("dtc.permanent"), r.permanent);
    const f = state.freeze;
    if (f?.dtc) {
      lines.push({ text: `${t("dtc.freezeFrame")} (${f.dtc.code})`, bold: true, gap: true });
      for (const v of f.values.slice(0, 8)) lines.push({ text: `${pidText(v.key).name}: ${fmtValue(v.key, v.value)} ${unitOf(v.key)}` });
    }
    lines.push({ text: t("share.dtcNote"), muted: true, gap: true });
    await copyCard(drawCard(t("dtc.title"), lines), "obd2-codigos");
  }, "ghost", { title: t("share.help") });

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
      try {
        await api.clearDtcs();
      } catch (e) {
        // Demo: say where the virtual engine is switched off.
        const demo = state.adapter?.transport.startsWith("Demo");
        if (demo && (e as { code?: string })?.code === "engine_running") throw new Error(`${errorText(e)} ${t("dtc.engineRunningDemo")}`);
        throw e;
      }
      return true;
    });
    if (res) {
      state.dtcs = null;
      state.freeze = null;
      state.mode06 = null;
      // Read again to show whether the codes are really gone. Permanent
      // codes stay by design: the ECU erases them after a few clean drives.
      const after = await api.readDtcs(getLang()).catch(() => null);
      state.dtcs = after;
      const back = after ? after.stored.length + after.pending.length : 0;
      toast(!after ? t("dtc.cleared") : back ? t("dtc.clearedSomeBack", { count: back }) : t("dtc.clearedConfirmed"), back ? "info" : "ok");
      renderLists();
      renderFreeze();
      renderMode06();
    }
  }, "danger");
  const ffBtn = button(t("dtc.readFreezeFrame"), async () => {
    const f = await busy(ffBtn, () => api.readFreezeFrame(getLang()));
    if (f) {
      state.freeze = f;
      renderFreeze();
    }
  }, "secondary");

  const m06Box = h("div");
  const renderMode06 = () => {
    clear(m06Box);
    const list = state.mode06;
    if (!list) return;
    if (!list.length) {
      m06Box.append(h("p", { class: "muted" }, t("mode06.none")));
      return;
    }
    const failed = list.filter((r) => !r.passed).length;
    const sorted = [...list].sort((a, b) => Number(a.passed) - Number(b.passed) || a.mid - b.mid || a.tid - b.tid);
    m06Box.append(
      h(
        "p",
        { class: failed ? "warn-text" : "ok-text" },
        failed ? t("mode06.summaryFailed", { failed, total: list.length }) : t("mode06.summaryOk", { total: list.length }),
      ),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "table" },
          h(
            "thead",
            null,
            h("tr", null, [t("mode06.monitor"), t("mode06.test"), t("mode06.value"), t("mode06.limits"), t("mode06.result")].map((c) => h("th", null, c))),
          ),
          h(
            "tbody",
            null,
            sorted.map((r) =>
              h(
                "tr",
                { class: r.passed ? "" : "row-fail" },
                h("td", null, monitorName(r)),
                h("td", { title: r.scaled ? "" : t("mode06.rawNote") }, testName(r), r.scaled ? null : " *"),
                h("td", { class: "num" }, fmtTest(r, r.value)),
                h("td", { class: "num muted" }, `${fmtTest(r, r.min)} … ${fmtTest(r, r.max)}`),
                h("td", null, h("span", { class: `badge ${r.passed ? "badge-ok" : "badge-danger"}` }, r.passed ? t("mode06.passed") : t("mode06.failed"))),
              ),
            ),
          ),
        ),
      ),
      h("p", { class: "muted small" }, t("mode06.note")),
    );
  };
  const isCan = (() => {
    const n = (state.adapter?.protocol_number ?? "").replace(/^A/, "");
    return ["6", "7", "8", "9"].includes(n);
  })();
  const m06Btn = button(t("mode06.read"), async () => {
    const r = await busy(m06Btn, () => api.readMode06());
    if (r) {
      state.mode06 = r;
      renderMode06();
    }
  }, "secondary");
  m06Btn.disabled = !isCan;

  page.append(
    h("div", { class: "toolbar" }, readBtn, clearBtn, shareBtn),
    lists,
    section(t("dtc.freezeFrame"), h("p", { class: "muted small" }, t("dtc.freezeFrameDesc")), ffBtn, freezeBox),
    section(
      t("mode06.title"),
      h("p", { class: "muted small" }, t("mode06.desc")),
      isCan ? null : h("p", { class: "muted small" }, t("mode06.onlyCan")),
      m06Btn,
      m06Box,
    ),
    lookupCard,
  );
  renderLists();
  renderFreeze();
  renderMode06();
}
