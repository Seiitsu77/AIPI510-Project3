import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import StintScenario from "@/components/stint-scenario";
import { estimateBatch } from "@/lib/api";
import { fixtureRaces, fixtureReplay } from "@/lib/fixture";
import type { ModelInfo } from "@/lib/types";
vi.mock("@/lib/api", () => ({ estimateBatch: vi.fn() }));
const replay = fixtureReplay(fixtureRaces[0]);
replay.race = { ...replay.race, is_fixture: false, circuit_short_name: "TEST" };
const driver = replay.drivers[0];
const model: ModelInfo = {
  available: true,
  version: "model-1",
  dataset_version: "data-1",
  combinations: ["SOFT", "HARD"].map((compound) => ({
    circuit: "TEST",
    driver: driver.name_acronym,
    team: driver.team_name,
    compound,
  })),
  ranges: {
    race_lap: [1, 57],
    tyre_age: [0, 40],
    track_temperature: [15, 50],
    rainfall: [0, 0],
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(estimateBatch).mockImplementation(async (items) => ({
    predictions: items.map((item) => ({
      lap_duration: 90 + item.tyre_age * 0.1,
      model_version: "model-1",
      dataset_version: "data-1",
    })),
  }));
});
describe("stint scenario", () => {
  it("compares only supported tyres across advancing lap and tyre age, and applies an explicit adjustment", async () => {
    render(
      <StintScenario
        model={model}
        replay={replay}
        selectedDriver={driver.driver_number}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Lap times around the transition" }),
    ).toBeInTheDocument();
    const flagged = screen.getByRole("checkbox", {
      name: /Include flagged laps/,
    });
    expect(flagged).not.toBeChecked();
    fireEvent.click(flagged);
    expect(flagged).toBeChecked();
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Scenario length" }),
      { target: { value: "3" } },
    );
    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "User adjustment seconds per lap",
      }),
      { target: { value: "0.5" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Compare stint scenarios" }),
    );
    await screen.findByText(/User adjustment \+0.5 sec\/lap/);
    const items = vi.mocked(estimateBatch).mock.calls[0][0];
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.compound)).toEqual([
      "SOFT",
      "SOFT",
      "SOFT",
      "HARD",
      "HARD",
      "HARD",
    ]);
    expect(items.slice(0, 3).map((i) => i.race_lap)).toEqual([17, 18, 19]);
    expect(items.slice(0, 3).map((i) => i.tyre_age)).toEqual([1, 2, 3]);
    expect(screen.getAllByText("1:30.700").length).toBeGreaterThan(0);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Scenario starting tyre age" }),
      { target: { value: "40" } },
    );
    expect(
      screen.queryByText(/User adjustment \+0.5 sec\/lap/),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Compare stint scenarios" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("exceeds");
    expect(estimateBatch).toHaveBeenCalledTimes(1);
  });
  it("rejects incomplete or changed model responses", async () => {
    vi.mocked(estimateBatch).mockResolvedValue({ predictions: [] });
    render(
      <StintScenario
        model={model}
        replay={replay}
        selectedDriver={driver.driver_number}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Compare stint scenarios" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("incomplete"),
    );
    expect(screen.queryByText("Sum of estimated laps")).not.toBeInTheDocument();
  });
  it("never estimates from a synthetic fixture", () => {
    render(
      <StintScenario model={model} replay={fixtureReplay(fixtureRaces[0])} />,
    );
    expect(
      screen.getByText(/Synthetic fixtures cannot be used/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Compare stint scenarios" }),
    ).not.toBeInTheDocument();
  });
});
