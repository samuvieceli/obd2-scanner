// Vehicle information (VIN, ECU, adapter) and readiness monitors.
import { api } from "../api";
import { reportVin } from "./connection";
import { fmtNum, msgs, t } from "../i18n";
import { state } from "../store";
import { busy, button, clear, h, infoTip, notConnected, section } from "../ui";

const place = (name: string) => (msgs().places as Record<string, string>)[name] ?? name;

/** Name of a coded value (PID 1C or 51), with its explanation. */
const coded = (table: "obdStandards" | "fuelTypes", code: number | null | undefined, tip: string) => {
  if (code === null || code === undefined) return null;
  const name = (msgs()[table] as Record<string, string>)[code] ?? t("vehicle.unknownCode", { code });
  return h("span", null, name, " ", infoTip(tip));
};

export function mount(root: HTMLElement) {
  const page = h("div", { class: "page" });
  root.append(page);
  page.append(h("h1", null, t("vehicle.title")));
  if (state.connection !== "connected") {
    page.append(notConnected());
    return;
  }
  const infoBox = h("div");
  const readyBox = h("div");
  const ecuBox = h("div");

  const kv = (pairs: [string, string | HTMLElement | null | undefined][]) =>
    h(
      "dl",
      { class: "kv" },
      pairs.filter(([, v]) => v !== null && v !== undefined && v !== "").flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v as string | HTMLElement)]),
    );

  const renderInfo = () => {
    clear(infoBox);
    const v = state.vehicle;
    if (!v) return;
    const vi = v.vinInfo;
    infoBox.append(
      vi
        ? kv([
            [t("vehicle.vin"), h("code", { class: "vin" }, vi.vin)],
            [t("vehicle.manufacturer"), vi.manufacturer ?? t("common.unknown")],
            [t("vehicle.country"), [vi.country, vi.region].filter(Boolean).map(place).join(" · ")],
            [t("vehicle.modelYear"), vi.model_year ? String(vi.model_year) : null],
            [
              t("vehicle.checkDigit"),
              vi.check_digit_ok === null ? null : vi.check_digit_ok ? t("vehicle.checkOk") : t("vehicle.checkBad"),
            ],
          ])
        : h("p", { class: "muted" }, t("vehicle.vinUnavailable")),
      kv([
        [t("vehicle.calibration"), v.identity.calibration_id],
        [t("vehicle.ecuName"), v.identity.ecu_name],
        [t("vehicle.obdStandard"), coded("obdStandards", v.identity.obd_standard, t("vehicle.obdStandardTip"))],
        [t("vehicle.fuelType"), coded("fuelTypes", v.identity.fuel_type, t("vehicle.fuelTypeTip"))],
        [t("vehicle.adapter"), `${v.adapter.version} — ${v.adapter.transport}`],
        [t("vehicle.protocol"), v.adapter.protocol],
        [t("vehicle.voltage"), v.batteryVoltage != null ? `${fmtNum(v.batteryVoltage, 1)} V` : null],
      ]),
    );
  };

  const renderReady = () => {
    clear(readyBox);
    const r = state.readiness;
    if (!r) return;
    readyBox.append(
      kv([
        [t("vehicle.mil"), h("span", { class: r.mil_on ? "badge badge-danger" : "badge badge-ok" }, r.mil_on ? t("vehicle.milOn") : t("vehicle.milOff"))],
        [t("vehicle.dtcCount"), String(r.dtc_count)],
        [t("vehicle.engineType"), r.compression_ignition ? t("vehicle.compression") : t("vehicle.spark")],
      ]),
      h(
        "table",
        { class: "table monitors" },
        h(
          "tbody",
          null,
          r.monitors
            .slice()
            .sort((a, b) => (a.state === "not_supported" ? 1 : 0) - (b.state === "not_supported" ? 1 : 0))
            .map((m) =>
              h(
                "tr",
                { class: m.state === "not_supported" ? "dim" : "" },
                h("th", null, t(`monitors.${m.key}.name`), " ", infoTip(t(`monitors.${m.key}.desc`))),
                h("td", null, h("span", { class: `state state-${m.state}` }, t(`vehicle.state.${m.state}`))),
              ),
            ),
        ),
      ),
    );
  };

  const renderEcus = () => {
    clear(ecuBox);
    const list = state.ecus;
    if (!list) return;
    if (!list.length) {
      ecuBox.append(h("p", { class: "muted" }, t("ecus.none")));
      return;
    }
    ecuBox.append(
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "table" },
          h("thead", null, h("tr", null, [t("ecus.address"), t("ecus.unit"), t("ecus.pids"), t("ecus.identity")].map((c) => h("th", null, c)))),
          h(
            "tbody",
            null,
            list.map((e) =>
              h(
                "tr",
                null,
                h("td", { class: "mono" }, e.address),
                h("td", null, h("strong", null, t(`ecus.role.${e.role}`)), e.name ? h("div", { class: "muted small mono" }, e.name) : null),
                h("td", { class: "num" }, String(e.supported_pids)),
                h(
                  "td",
                  null,
                  e.ids.length
                    ? h("dl", { class: "kv compact" }, e.ids.flatMap((id) => [h("dt", null, t(`ecus.ids.${id.key}`)), h("dd", { class: "mono" }, id.value)]))
                    : h("span", { class: "muted small" }, t("ecus.noIds")),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  };

  const ecuBtn = button(t("ecus.scan"), async () => {
    const list = await busy(ecuBtn, () => api.scanEcus());
    if (list) {
      state.ecus = list;
      renderEcus();
    }
  }, "primary");

  const infoBtn = button(t("vehicle.readInfo"), async () => {
    const v = await busy(infoBtn, () => api.readVehicleInfo());
    if (v) {
      state.vehicle = v;
      renderInfo();
      reportVin(v.identity.vin);
    }
  }, "primary");
  const readyBtn = button(t("vehicle.readReadiness"), async () => {
    const r = await busy(readyBtn, () => api.readReadiness());
    if (r) {
      state.readiness = r;
      renderReady();
    }
  }, "primary");

  page.append(
    h(
      "div",
      { class: "two-col" },
      section(t("vehicle.vin"), infoBtn, infoBox),
      section(t("vehicle.readiness"), h("p", { class: "muted small" }, t("vehicle.readinessIntro")), readyBtn, readyBox),
    ),
    section(t("ecus.title"), h("p", { class: "muted small" }, t("ecus.intro")), ecuBtn, ecuBox),
  );
  renderInfo();
  renderReady();
  renderEcus();
}
