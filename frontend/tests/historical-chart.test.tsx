import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StintScenario from "@/components/stint-scenario";
import { fixtureRaces, fixtureReplay } from "@/lib/fixture";
import type { ModelInfo, Lap } from "@/lib/types";

vi.mock("@/lib/api", () => ({ estimateBatch: vi.fn() }));
// JSDOM has no layout engine; keep the real Recharts chart with fixed dimensions.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(
        children as React.ReactElement<{ width?: number; height?: number }>,
        { width: 800, height: 260 },
      ),
  };
});

const source = fixtureReplay(fixtureRaces[0]);
const driver = source.drivers[0];
const base = source.laps.find((l) => l.driver_number === driver.driver_number)!;
const lap = (n: number, eligible = true): Lap => ({
  ...base,
  race_lap: n,
  lap_duration: 90 + n / 10,
  eligible,
  exclusions: eligible ? [] : ["pit_lap"],
});
const replay = {
  ...source,
  race: { ...source.race, is_fixture: false },
  stints: [
    {
      driver_number: driver.driver_number,
      stint_number: 1,
      compound: "SOFT",
      lap_start: 1,
      lap_end: 25,
      tyre_age_at_start: 0,
    },
    {
      driver_number: driver.driver_number,
      stint_number: 2,
      compound: "HARD",
      lap_start: 26,
      lap_end: 30,
      tyre_age_at_start: 0,
    },
  ],
  laps: [
    lap(1),
    lap(25),
    lap(26),
    lap(27, false),
    lap(28, false),
    lap(29),
    lap(30),
  ],
};
const model: ModelInfo = { available: false };

function renderChart() {
  render(
    <StintScenario
      model={model}
      replay={replay}
      selectedDriver={driver.driver_number}
    />,
  );
  return screen.getByLabelText("Observed historical lap time chart");
}

describe("historical stint chart", () => {
  it("renders flagged dots only while the toggle is enabled", async () => {
    const chart = renderChart();
    await waitFor(() =>
      expect(
        chart.querySelectorAll(".recharts-line-dots .recharts-dot").length,
      ).toBeGreaterThan(0),
    );
    const flaggedDots = () =>
      chart.querySelectorAll(".recharts-dot[stroke='#e8bf60']");
    expect(flaggedDots()).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Include flagged laps/ }),
    );
    await waitFor(() => expect(flaggedDots()).toHaveLength(2));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Include flagged laps/ }),
    );
    expect(flaggedDots()).toHaveLength(0);
  });
  it("preserves missing laps and breaks the eligible line instead of connecting laps 1 and 25", async () => {
    const chart = renderChart();
    await waitFor(() =>
      expect(chart.querySelector(".recharts-line-curve")).not.toBeNull(),
    );
    const path = chart
      .querySelector(".recharts-line-curve")!
      .getAttribute("d")!;
    expect((path.match(/M/g) || []).length).toBeGreaterThanOrEqual(2);
    const dots = Array.from(
      chart.querySelectorAll(".recharts-line-dots .recharts-dot"),
    );
    expect(dots.length).toBe(5);
    const xs = dots.map((dot) => Number(dot.getAttribute("cx")));
    expect(xs[1] - xs[0]).toBeGreaterThan((xs[2] - xs[1]) * 20);
    expect(within(chart).getByText("Race lap")).toBeInTheDocument();
  });
});
