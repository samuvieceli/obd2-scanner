// AT terminal: send raw commands to the adapter.
import { api } from "../api";
import { t } from "../i18n";
import { on, state } from "../store";
import { button, errorText, h, notConnected } from "../ui";

const history: string[] = [];
const output: { kind: "tx" | "rx" | "err"; text: string }[] = [];

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  page.append(h("h1", null, t("terminal.title")), h("p", { class: "lead" }, t("terminal.intro")));
  if (state.connection !== "connected") {
    page.append(notConnected());
    return;
  }
  let showAll = false;
  let histPos = history.length;
  const screen = h("pre", { class: "terminal", "aria-live": "polite" });
  const render = () => {
    screen.textContent = showAll
      ? state.logs.slice(-400).map((l) => (l.dir === "tx" ? "> " : l.dir === "rx" ? "" : "# ") + l.text).join("\n")
      : output.map((o) => (o.kind === "tx" ? "> " : o.kind === "err" ? "! " : "") + o.text).join("\n");
    screen.scrollTop = screen.scrollHeight;
  };
  const input = h("input", { type: "text", class: "mono grow", placeholder: t("terminal.placeholder"), autocomplete: "off", spellcheck: false, "aria-label": t("terminal.placeholder") });
  const send = async (cmd: string) => {
    cmd = cmd.trim();
    if (!cmd) return;
    history.push(cmd);
    histPos = history.length;
    output.push({ kind: "tx", text: cmd });
    render();
    try {
      const r = await api.sendRaw(cmd);
      output.push({ kind: "rx", text: r || "—" });
    } catch (e) {
      output.push({ kind: "err", text: errorText(e) });
    }
    if (output.length > 500) output.splice(0, output.length - 500);
    render();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      send(input.value);
      input.value = "";
    } else if (e.key === "ArrowUp" && histPos > 0) {
      input.value = history[--histPos];
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      histPos = Math.min(history.length, histPos + 1);
      input.value = history[histPos] ?? "";
    }
  });
  const quick = ["ATI", "ATRV", "ATDP", "ATDPN", "0100", "010C", "03", "0902"];
  page.append(
    h(
      "div",
      { class: "row" },
      h("span", { class: "muted small" }, t("terminal.quick")),
      quick.map((q) => button(q, () => send(q), "ghost", { class: "btn btn-ghost btn-sm mono" })),
    ),
    screen,
    h(
      "div",
      { class: "row" },
      input,
      button(t("terminal.send"), () => {
        send(input.value);
        input.value = "";
      }, "primary"),
      button(t("terminal.clear"), () => {
        output.length = 0;
        render();
      }, "ghost"),
    ),
    h(
      "label",
      { class: "check" },
      h("input", {
        type: "checkbox",
        onchange: (e: Event) => {
          showAll = (e.target as HTMLInputElement).checked;
          render();
        },
      }),
      h("span", null, t("terminal.showLive")),
    ),
  );
  if (state.polling) page.append(h("p", { class: "muted small" }, t("terminal.pauseNote")));
  render();
  input.focus();
  const off = on("log", () => showAll && render());
  return off;
}
