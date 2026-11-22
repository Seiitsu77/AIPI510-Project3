import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import PitWall from "@/components/pitwall";
import PaceLab from "@/components/pace-lab";
import {
  getRaces,
  getModel,
  estimate,
  estimateBatch,
  getReference,
} from "@/lib/api";
import { lapTime, type ModelInfo } from "@/lib/types";
vi.mock("@/lib/api", () => ({
  getRaces: vi.fn(),
  getModel: vi.fn(),
  getReplay: vi.fn(),
  estimate: vi.fn(),
  estimateBatch: vi.fn(),
  getReference: vi.fn(),
}));
vi.mock("@/components/pace-chart", () => ({
  default: () => <div aria-label="Pace chart" />,
}));
vi.mock("motion/react", () => ({
  motion: {
    div: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className: string;
    }) => <div className={className}>{children}</div>,
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(getRaces).mockResolvedValue([]);
  vi.mocked(getReference).mockResolvedValue({
    source: "OpenF1",
    lap_count: 0,
    mean_lap_duration: null,
    session_keys: [],
    observations: [],
  });
  vi.mocked(getModel).mockResolvedValue({
    available: false,
    detail: "No trained historical model",
  });
});
describe("race workspace", () => {
  it("labels synthetic values and synchronizes lap selection and tyre panels", async () => {
    render(<PitWall />);
    await screen.findByRole("button", { name: "Compare Max Verstappen" });
    expect(screen.getByText("SYNTHETIC UI FIXTURE")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "NOR select lap 40" }));
    expect(screen.getByRole("spinbutton", { name: "Lap number" })).toHaveValue(
      40,
    );
    expect(screen.getAllByText("STINT 3").length).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Previous lap" }));
    expect(screen.getByRole("spinbutton", { name: "Lap number" })).toHaveValue(
      39,
    );
  });
  it("limits comparison to three drivers and supports switching sessions", async () => {
    render(<PitWall />);
    await screen.findByRole("button", { name: "Compare Max Verstappen" });
    fireEvent.click(
      screen.getByRole("button", { name: "Compare Oscar Piastri" }),
    );
    expect(screen.getByText(/Compare up to 3 drivers/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Compare Oscar Piastri" }),
    ).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove VER from comparison" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Compare Oscar Piastri" }),
    );
    expect(
      screen.getByRole("button", { name: "Compare Oscar Piastri" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("combobox", { name: "Grand Prix" }), {
      target: { value: "-2" },
    });
    await screen.findByRole("button", { name: "NOR select lap 50" });
    expect(
      screen.queryByRole("button", { name: "NOR select lap 57" }),
    ).not.toBeInTheDocument();
  });
  it("does not invent model outputs when training is unavailable", async () => {
    render(<PitWall initialPage="lab" />);
    await screen.findByText("A trained model is required.");
    expect(
      screen.getByRole("button", { name: "Estimate lap time" }),
    ).toBeDisabled();
    expect(screen.getByText("Evaluation pending")).toBeInTheDocument();
    expect(
      await screen.findByText(/UI fixture values are excluded/),
    ).toBeInTheDocument();
  });
});
it("keeps session and lap context when reopening the workspace", async () => {
  const view = render(<PitWall />);
  await screen.findByRole("button", { name: "Compare Max Verstappen" });
  fireEvent.change(screen.getByRole("combobox", { name: "Grand Prix" }), {
    target: { value: "-2" },
  });
  await screen.findByRole("button", { name: "NOR select lap 50" });
  fireEvent.click(screen.getByRole("button", { name: "NOR select lap 40" }));
  await waitFor(() =>
    expect(JSON.parse(sessionStorage.getItem("pitwall-workspace")!).lap).toBe(
      40,
    ),
  );
  view.unmount();
  render(<PitWall />);
  await screen.findByRole("button", { name: "NOR select lap 50" });
  expect(screen.getByRole("combobox", { name: "Grand Prix" })).toHaveValue(
    "-2",
  );
  expect(screen.getByRole("spinbutton", { name: "Lap number" })).toHaveValue(
    40,
  );
  fireEvent.click(screen.getByRole("button", { name: "Open data guide" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("button", { name: "Close data guide" }), {
    key: "Escape",
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

describe("prediction workflow", () => {
  const model: ModelInfo = {
    available: true,
    version: "test-only",
    support: {},
    combinations: ["SOFT", "MEDIUM", "HARD"].map((compound) => ({
      circuit: "TEST",
      driver: "TST",
      team: "Test",
      compound,
    })),
    ranges: {
      tyre_age: [0, 50],
      race_lap: [2, 60],
      track_temperature: [20, 50],
      rainfall: [0, 0],
    },
  };
  it("calls single and batch model APIs and clears stale predictions on edits", async () => {
    vi.mocked(estimate).mockResolvedValue({
      lap_duration: 93.321,
      model_version: "test-only",
      dataset_version: "test-only",
    });
    vi.mocked(estimateBatch).mockImplementation(async (items) => ({
      predictions: items.map(() => ({
        lap_duration: 94,
        model_version: "test-only",
        dataset_version: "test-only",
      })),
    }));
    render(<PaceLab model={model} replay={null} onRefresh={async () => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Estimate lap time" }));
    await screen.findByText("1:33.321");
    expect(estimate).toHaveBeenCalledWith(
      expect.objectContaining({ circuit: "TEST", driver: "TST" }),
    );
    expect(estimateBatch).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Tyre age" }), {
      target: { value: "20" },
    });
    expect(screen.queryByText("1:33.321")).not.toBeInTheDocument();
  });
  it("renders model API failures without displaying a predicted time", async () => {
    vi.mocked(estimate).mockRejectedValue(new Error("Unsupported combination"));
    render(<PaceLab model={model} replay={null} onRefresh={async () => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Estimate lap time" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unsupported combination",
    );
  });
});
it("formats rounded milliseconds across minute boundaries", () => {
  expect(lapTime(119.9996)).toBe("2:00.000");
  expect(lapTime(null)).toBe("—");
});
