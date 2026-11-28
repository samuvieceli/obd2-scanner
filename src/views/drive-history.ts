// Trip history section ("Viagem" screen): every drive of 2 minutes or more
// is kept by itself (see drive-summary.ts). Shows this car's real averages
// per fuel, totals per month (distance, fuel, cost) and the drives one by
// one, each of which can be deleted.
import { clearDrives, compareByFuel, drivesOf, fuelGroup, monthlyTotals, removeDrive, type StoredDrive } from "../drives";
import { fmtNum, getLang, t } from "../i18n";
import { profile } from "../prefs";
import { button, clear, fmtValue, h, section, unitOf } from "../ui";
import { consumption, displayUnit, toDisplay } from "../units";

const LATEST = 10;

export const economyText = (kmPerL: number | undefined) => {
  if (kmPerL === undefined) return "—";
  const [v, unit] = consumption(kmPerL);
  return `${fmtNum(v, 1)} ${unit}`;
};
export const distanceText = (km: number) => `${fmtNum(toDisplay("km", km), 1)} ${displayUnit("km")}`;
export const volumeText = (l: number) => `${fmtNum(toDisplay("L", l), 1)} ${displayUnit("L")}`;
export const moneyText = (x: number | undefined) => (x === undefined ? "—" : `${t("cost.currency")} ${fmtNum(x, 2)}`);
const percent = (x: number | undefined) => (x === undefined ? "—" : `${fmtNum(x * 100, 0)}%`);

function table(head: string[], rows: (string | Node)[][]): HTMLElement {
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      { class: "table" },
      h("thead", null, h("tr", null, head.map((c) => h("th", null, c)))),
      h("tbody", null, rows.map((r) => h("tr", null, r.map((c) => h("td", null, c))))),
    ),
  );
}

export function driveHistorySection(): HTMLElement {
  const body = h("div");
  let confirming = false;
  let showAll = false;
  /** Drive waiting for the second click on its delete button. */
  let deleting: number | null = null;

  const render = () => {
    clear(body);
    const me = profile();
    const drives = drivesOf(me.id);
    if (!drives.length) {
      body.append(h("p", { class: "muted" }, t("history.empty")));
      return;
    }
    const monthName = (m: string) => {
      const [y, mo] = m.split("-").map(Number);
      return new Date(y, mo - 1, 1).toLocaleDateString(getLang(), { month: "long", year: "numeric" });
    };
    const months = monthlyTotals(drives);
    const latest = [...drives].reverse();
    const shown = showAll ? latest : latest.slice(0, LATEST);
    body.append(
      h("h3", null, t("history.byFuel")),
      table(
        ["fuel", "drives", "distance", "economy", "idle", "maxCoolant"].map((c) => t(`history.col.${c}`)),
        compareByFuel(drives).map((s) => [
          t(`history.group.${s.group}`),
          String(s.drives),
          distanceText(s.distanceKm),
          h("strong", null, economyText(s.kmPerL)),
          percent(s.idleShare),
          s.maxCoolant === undefined ? "—" : `${fmtValue("coolant_temp", s.maxCoolant)} ${unitOf("coolant_temp")}`,
        ]),
      ),
      h("p", { class: "muted small" }, t("history.note")),
      h("h3", null, t("history.byMonth")),
      table(
        ["month", "drives", "distance", "fuelUsed", "economy", "cost"].map((c) => t(`history.col.${c}`)),
        months.map((m) => [
          monthName(m.month),
          String(m.drives),
          distanceText(m.distanceKm),
          volumeText(m.fuelL),
          economyText(m.kmPerL),
          m.cost === undefined ? "—" : moneyText(m.cost) + (m.noCost ? " *" : ""),
        ]),
      ),
      months.some((m) => m.noCost && m.cost !== undefined) ? h("p", { class: "muted small" }, t("history.costPartial")) : "",
      h("h3", null, t("history.latest")),
      h(
        "ul",
        { class: "plain-list history-list" },
        shown.map((d: StoredDrive) =>
          h(
            "li",
            null,
            h(
              "span",
              { class: "grow" },
              h("span", { class: "muted" }, new Date(d.endedAt).toLocaleString(getLang(), { dateStyle: "short", timeStyle: "short" })),
              " · ",
              distanceText(d.distanceKm),
              " · ",
              economyText(d.distanceKm >= 1 && d.fuelL >= 0.05 ? d.distanceKm / d.fuelL : undefined),
              d.cost !== undefined ? ` · ${moneyText(d.cost)}` : "",
              " · ",
              t(`history.group.${fuelGroup(d)}`),
            ),
            button(
              deleting === d.endedAt ? t("history.deleteConfirm") : t("history.delete"),
              () => {
                if (deleting !== d.endedAt) {
                  deleting = d.endedAt;
                  render();
                  return;
                }
                removeDrive(me.id, d.endedAt);
                deleting = null;
                render();
              },
              deleting === d.endedAt ? "danger" : "ghost",
              { class: `btn btn-sm btn-${deleting === d.endedAt ? "danger" : "ghost"}` },
            ),
          ),
        ),
      ),
      latest.length > LATEST
        ? button(t(showAll ? "history.showLess" : "history.showAll", { n: latest.length }), () => {
            showAll = !showAll;
            render();
          }, "secondary")
        : "",
      " ",
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
