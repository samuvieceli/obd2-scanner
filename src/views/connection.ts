// Connection screen: choose transport, connect, show adapter information.
import { api, type ConnectionTarget, type ElmConfig, type PortInfo } from "../api";
import { t } from "../i18n";
import { emit, on, resetLiveData, state } from "../store";
import { busy, button, clear, errorText, h, infoTip, section, toast } from "../ui";

type Kind = "demo" | "serial" | "tcp" | "ble";

interface Form {
  kind: Kind;
  port: string;
  baud: number;
  host: string;
  tcpPort: number;
  quirky: boolean;
  config: ElmConfig;
}

const DEFAULT_FORM: Form = {
  kind: "demo",
  port: "",
  baud: 0,
  host: "192.168.0.10",
  tcpPort: 35000,
  quirky: false,
  config: { command_timeout_ms: 2000, reset_timeout_ms: 5000, search_timeout_ms: 15000, protocol: "0", elm_timeout_hex: "" },
};

const PROTOCOLS: [string, string][] = [
  ["1", "SAE J1850 PWM (41.6 kbaud)"],
  ["2", "SAE J1850 VPW (10.4 kbaud)"],
  ["3", "ISO 9141-2"],
  ["4", "ISO 14230-4 KWP (5 baud init)"],
  ["5", "ISO 14230-4 KWP (fast init)"],
  ["6", "ISO 15765-4 CAN (11 bit, 500 kbaud)"],
  ["7", "ISO 15765-4 CAN (29 bit, 500 kbaud)"],
  ["8", "ISO 15765-4 CAN (11 bit, 250 kbaud)"],
  ["9", "ISO 15765-4 CAN (29 bit, 250 kbaud)"],
];

function loadForm(): Form {
  try {
    const v = localStorage.getItem("connectionForm");
    if (v) {
      const f = JSON.parse(v) as Partial<Form>;
      return { ...DEFAULT_FORM, ...f, config: { ...DEFAULT_FORM.config, ...(f.config ?? {}) } };
    }
  } catch {
    /* ignore */
  }
  return structuredClone(DEFAULT_FORM);
}

function saveForm(f: Form) {
  try {
    localStorage.setItem("connectionForm", JSON.stringify(f));
  } catch {
    /* ignore */
  }
}

export function mount(root: HTMLElement) {
  const form = loadForm();
  let ports: PortInfo[] = [];

  const page = h("div", { class: "page" });
  root.append(page);

  const render = () => {
    clear(page);
    page.append(h("h1", null, t("connection.title")), h("p", { class: "lead" }, t("connection.intro")));
    if (state.connection === "connected") {
      page.append(connectedCard());
    } else {
      page.append(typePicker(), formCard());
    }
    page.append(logCard());
  };

  const typePicker = () => {
    const kinds: Kind[] = ["demo", "serial", "tcp", "ble"];
    return h(
      "div",
      { class: "type-grid", role: "radiogroup", "aria-label": t("connection.title") },
      kinds.map((k) =>
        h(
          "button",
          {
            type: "button",
            role: "radio",
            "aria-checked": form.kind === k ? "true" : "false",
            class: `type-card ${form.kind === k ? "selected" : ""}`,
            disabled: k === "ble",
            onclick: () => {
              form.kind = k;
              saveForm(form);
              render();
              if (k === "serial") refreshPorts();
            },
          },
          h("strong", null, t(`connection.types.${k}`)),
          h("span", null, t(`connection.types.${k}Desc`)),
        ),
      ),
    );
  };

  const portSelect = h("select", { id: "port" });
  const fillPorts = () => {
    clear(portSelect);
    for (const p of ports) {
      const kind = t(`connection.portKind.${p.kind}`);
      const label = `${p.name} — ${kind}${p.description ? ` (${p.description})` : ""}`;
      portSelect.append(h("option", { value: p.name, selected: p.name === form.port }, label));
    }
    if (!form.port || !ports.some((p) => p.name === form.port)) form.port = ports[0]?.name ?? "";
  };
  const refreshPorts = async () => {
    try {
      ports = await api.listPorts();
    } catch (e) {
      toast(errorText(e), "error");
      ports = [];
    }
    if (form.kind === "serial") render();
  };

  const numberField = (label: string, value: number, set: (v: number) => void, min = 100, max = 60000) =>
    h(
      "label",
      { class: "field" },
      h("span", null, label),
      h("input", {
        type: "number",
        min,
        max,
        step: 100,
        value: String(value),
        onchange: (e: Event) => {
          set(Number((e.target as HTMLInputElement).value));
          saveForm(form);
        },
      }),
    );

  const formCard = () => {
    const card = h("section", { class: "card" });
    if (form.kind === "demo") {
      card.append(
        h(
          "label",
          { class: "check" },
          h("input", {
            type: "checkbox",
            checked: form.quirky,
            onchange: (e: Event) => {
              form.quirky = (e.target as HTMLInputElement).checked;
              saveForm(form);
            },
          }),
          h("span", null, t("connection.quirky")),
        ),
      );
    } else if (form.kind === "serial") {
      fillPorts();
      portSelect.onchange = () => {
        form.port = portSelect.value;
        saveForm(form);
      };
      const baud = h(
        "select",
        {
          id: "baud",
          onchange: (e: Event) => {
            form.baud = Number((e.target as HTMLSelectElement).value);
            saveForm(form);
          },
        },
        h("option", { value: "0", selected: form.baud === 0 }, t("connection.baudAuto")),
        [38400, 9600, 115200, 57600, 230400, 500000].map((b) =>
          h("option", { value: String(b), selected: form.baud === b }, String(b)),
        ),
      );
      card.append(
        h(
          "div",
          { class: "row" },
          h("label", { class: "field grow", for: "port" }, h("span", null, t("connection.port")), ports.length ? portSelect : h("p", { class: "muted" }, t("connection.noPorts"))),
          button(t("common.refresh"), () => refreshPorts(), "ghost"),
        ),
        h("label", { class: "field", for: "baud" }, h("span", null, t("connection.baud")), baud),
        h("details", { class: "help" }, h("summary", null, t("connection.btHelpTitle")), h("p", null, t("connection.btHelp"))),
      );
    } else if (form.kind === "tcp") {
      card.append(
        h(
          "div",
          { class: "row" },
          h(
            "label",
            { class: "field grow" },
            h("span", null, t("connection.host")),
            h("input", {
              type: "text",
              value: form.host,
              onchange: (e: Event) => {
                form.host = (e.target as HTMLInputElement).value.trim();
                saveForm(form);
              },
            }),
          ),
          numberField(t("connection.tcpPort"), form.tcpPort, (v) => (form.tcpPort = v), 1, 65535),
        ),
      );
    }

    // Advanced options (timeouts and protocol).
    const proto = h(
      "select",
      {
        onchange: (e: Event) => {
          form.config.protocol = (e.target as HTMLSelectElement).value;
          saveForm(form);
        },
      },
      h("option", { value: "0", selected: form.config.protocol === "0" }, t("connection.protocolAuto")),
      PROTOCOLS.map(([v, label]) => h("option", { value: v, selected: form.config.protocol === v }, `${v} — ${label}`)),
    );
    card.append(
      h(
        "details",
        { class: "advanced" },
        h("summary", null, t("connection.advanced")),
        h("p", { class: "muted small" }, t("connection.advancedHelp")),
        h("label", { class: "field" }, h("span", null, t("connection.protocol")), proto),
        h(
          "div",
          { class: "row" },
          numberField(t("connection.commandTimeout"), form.config.command_timeout_ms, (v) => (form.config.command_timeout_ms = v)),
          numberField(t("connection.resetTimeout"), form.config.reset_timeout_ms, (v) => (form.config.reset_timeout_ms = v)),
          numberField(t("connection.searchTimeout"), form.config.search_timeout_ms, (v) => (form.config.search_timeout_ms = v)),
        ),
      ),
    );

    const connectBtn = button(t("common.connect"), () => doConnect(connectBtn), "primary", { class: "btn btn-primary btn-lg" });
    connectBtn.disabled = (form.kind === "serial" && !form.port) || state.connection === "connecting";
    if (state.connection === "connecting") connectBtn.textContent = t("status.connecting");
    card.append(h("div", { class: "actions" }, connectBtn));
    return card;
  };

  const doConnect = async (btn: HTMLButtonElement) => {
    let target: ConnectionTarget;
    if (form.kind === "serial") target = { kind: "serial", port: form.port, baud_rate: form.baud };
    else if (form.kind === "tcp") target = { kind: "tcp", host: form.host, port: form.tcpPort };
    else target = { kind: "demo" };
    state.connection = "connecting";
    emit("connection");
    const res = await busy(btn, () => api.connect(target, form.config, form.quirky));
    if (res) {
      resetLiveData();
      state.connection = "connected";
      state.adapter = res.adapter;
      state.vehicleError = res.vehicleError;
      toast(t("connection.connected", { transport: res.adapter.transport }), "ok");
    } else {
      state.connection = "disconnected";
    }
    emit("connection");
  };

  const connectedCard = () => {
    const a = state.adapter!;
    const card = section(
      t("connection.connected", { transport: a.transport }),
      h(
        "dl",
        { class: "kv" },
        h("dt", null, t("connection.adapterVersion")),
        h("dd", null, a.version || t("common.unknown")),
        h("dt", null, t("connection.protocolDetected")),
        h("dd", null, a.protocol || "—"),
        h("dt", null, t("connection.supportedPids"), " ", infoTip(t("dashboard.chooseHelp"))),
        h("dd", null, String(a.supported_pids.length)),
      ),
    );
    if (state.vehicleError) {
      const retry = button(t("connection.retryVehicle"), async () => {
        const info = await busy(retry, () => api.retryVehicle());
        if (info) {
          state.adapter = info;
          state.vehicleError = null;
          emit("connection");
        }
      }, "primary");
      card.append(
        h("div", { class: "alert alert-warning" }, h("p", null, t("connection.vehicleNoResponse")), h("p", { class: "small muted" }, errorText(state.vehicleError)), retry),
      );
    }
    const disc = button(t("common.disconnect"), async () => {
      await busy(disc, () => api.disconnect());
      state.connection = "disconnected";
      state.adapter = null;
      state.polling = false;
      state.vehicleError = null;
      emit("connection");
    }, "danger");
    card.append(h("div", { class: "actions" }, h("a", { class: "btn btn-primary", href: "#/dashboard" }, t("nav.dashboard")), disc));
    return card;
  };

  const logBox = h("pre", { class: "log", "aria-live": "off" });
  const renderLog = () => {
    const lines = state.logs.slice(-200).map((l) => {
      const prefix = l.dir === "tx" ? "→ " : l.dir === "rx" ? "← " : "· ";
      return prefix + l.text.replace(/\n/g, " | ");
    });
    logBox.textContent = lines.join("\n");
    logBox.scrollTop = logBox.scrollHeight;
  };
  const logCard = () => {
    renderLog();
    return h("details", { class: "card log-card" }, h("summary", null, t("connection.log")), logBox);
  };

  render();
  if (form.kind === "serial") refreshPorts();
  const offs = [on("connection", render), on("log", renderLog)];
  return () => offs.forEach((f) => f());
}
