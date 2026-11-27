// Trip history section (Recordings & reports screen): real averages of this
// car's past drives per fuel, and the latest drives one by one.
import { clearDrives, compareByFuel, drivesOf, fuelGroup, type StoredDrive } from "../drives";
import { fmtNum, getLang, t } from "../i18n";
import { profile } from "../prefs";
import { button, clear, fmtValue, h, section, unitOf } from "../ui";
import { consumption, displayUnit, toDisplay } from "../units";

const LATEST = 10;

const economy = (kmPerL: number | undefined) => {
  if (kmPerL === undefined) return "—";
  const [v, unit] = consumption(kmPerL);
  return `${fmtNum(v, 1)} ${unit}`;
};
const distance = (km: number) => `${fmtNum(toDisplay("km", km), 1)} ${displayUnit("km")}`;
const percent = (x: number | undefined) => (x === undefined ? "—" : `${fmtNum(x * 100, 0)}%`);

export function driveHistorySection(): HTMLElement {
  const body = h("div");
  let confirming = false;

  const render = () => {
    clear(body);
    const me = profile();
    const drives = drivesOf(me.id);
    if (!drives.length) {
      body.append(h("p", { class: "muted" }, t("history.empty")));
      return;
    }
    const stats = compareByFuel(drives);
    body.append(
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "table" },
          h(
            "thead",
            null,
            h("tr", null, ["fuel", "drives", "distance", "economy", "idle", "maxCoolant"].map((c) => h("th", null, t(`history.col.${c}`)))),
          ),
          h(
            "tbody",
            null,
            stats.map((s) =>
              h(
                "tr",
                null,
                h("td", null, t(`history.group.${s.group}`)),
                h("td", null, String(s.drives)),
                h("td", null, distance(s.distanceKm)),
                h("td", null, h("strong", null, economy(s.kmPerL))),
                h("td", null, percent(s.idleShare)),
                h("td", null, s.maxCoolant === undefined ? "—" : `${fmtValue("coolant_temp", s.maxCoolant)} ${unitOf("coolant_temp")}`),
              ),
            ),
          ),
        ),
      ),
      h("p", { class: "muted small" }, t("history.note")),
      h("h3", null, t("history.latest")),
      h(
        "ul",
        { class: "plain-list" },
        [...drives]
          .reverse()
          .slice(0, LATEST)
          .map((d: StoredDrive) =>
            h(
              "li",
              null,
              h("span", { class: "muted" }, new Date(d.endedAt).toLocaleString(getLang(), { dateStyle: "short", timeStyle: "short" })),
              " · ",
              distance(d.distanceKm),
              " · ",
              economy(d.distanceKm >= 1 && d.fuelL >= 0.05 ? d.distanceKm / d.fuelL : undefined),
              " · ",
              t(`history.group.${fuelGroup(d)}`),
            ),
          ),
      ),
      button(
        t(confirming ? "history.clearConfirm" : "history.clear"),
        () => {
          if (!confirming) {
            confirming = true;
            render();
            return;
          }
          clearDrives(me.id);
          confirming = false;
          render();
        },
        confirming ? "danger" : "ghost",
      ),
    );
  };

  render();
  return section(t("history.title", { car: profile().name }), h("p", { class: "muted" }, t("history.intro")), body);
}
