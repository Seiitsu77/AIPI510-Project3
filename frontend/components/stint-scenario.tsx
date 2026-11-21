"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { estimateBatch, type Parameters } from "@/lib/api";
import { compounds, lapTime, type ModelInfo, type Replay } from "@/lib/types";
import { Button } from "@/components/ui/button";

const TYRES = ["SOFT", "MEDIUM", "HARD"] as const;
type Row = { lap: number; age: number } & Record<string, number>;
type Result = {
  rows: Row[];
  tyres: string[];
  version: string;
  dataset: string;
  offset: number;
};

export default function StintScenario({
  model,
  replay,
  selectedDriver,
  selectedLap,
  loading = false,
}: {
  loading?: boolean;
  model: ModelInfo;
  replay: Replay | null;
  selectedDriver?: number;
  selectedLap?: number;
}) {
  const [driver, setDriver] = useState<number>(selectedDriver ?? 0);
  const [stintNumber, setStintNumber] = useState<number>(0);
  const [laps, setLaps] = useState(5);
  const [age, setAge] = useState(1);
  const [temperature, setTemperature] = useState(30);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    setDriver(
      selectedDriver &&
        replay?.drivers.some((d) => d.driver_number === selectedDriver)
        ? selectedDriver
        : (replay?.drivers[0]?.driver_number ?? 0),
    );
  }, [replay?.race.session_key, selectedDriver]);
  const stints = useMemo(
    () =>
      (replay?.stints || [])
        .filter(
          (s) =>
            s.driver_number === driver &&
            s.lap_start != null &&
            s.lap_end != null,
        )
        .sort((a, b) => a.stint_number - b.stint_number),
    [replay, driver],
  );
  useEffect(() => {
    const match = stints.find(
      (s) =>
        selectedLap != null &&
        s.lap_start != null &&
        s.lap_end != null &&
        selectedLap >= s.lap_start &&
        selectedLap <= s.lap_end,
    );
    const candidate = match
      ? stints.indexOf(match) < stints.length - 1
        ? match
        : stints[stints.length - 2]
      : stints[0];
    setStintNumber(candidate?.stint_number ?? 0);
  }, [stints, selectedLap]);
  const index = stints.findIndex((s) => s.stint_number === stintNumber);
  const before = stints[index];
  const after = stints[index + 1];
  const person = replay?.drivers.find((d) => d.driver_number === driver);
  const circuit = replay?.race.circuit_short_name || "";
  const start = after?.lap_start != null ? after.lap_start + 1 : 0;
  const historical = (s: typeof before) => {
    if (!s || !replay) return null;
    const rows = replay.laps.filter(
      (l) =>
        l.driver_number === driver &&
        l.race_lap >= s.lap_start! &&
        l.race_lap <= s.lap_end! &&
        l.eligible &&
        l.lap_duration != null,
    );
    return {
      count: rows.length,
      mean: rows.length
        ? rows.reduce((sum, row) => sum + row.lap_duration!, 0) / rows.length
        : null,
    };
  };
  const pre = historical(before),
    post = historical(after);
  const supported = TYRES.filter((compound) =>
    model.combinations?.some(
      (c) =>
        c.circuit === circuit &&
        c.driver === person?.name_acronym &&
        c.team === person?.team_name &&
        c.compound === compound,
    ),
  );
  useEffect(() => {
    sequence.current++;
    setResult(null);
    setError("");
    setPending(false);
  }, [
    driver,
    stintNumber,
    laps,
    age,
    temperature,
    offset,
    replay?.race.session_key,
    model.version,
    start,
  ]);
  async function run() {
    const id = ++sequence.current;
    setError("");
    setResult(null);
    const ranges = model.ranges;
    const validRange = (name: string, value: number) =>
      !!ranges?.[name] &&
      Number.isFinite(value) &&
      value >= ranges[name][0] &&
      value <= ranges[name][1];
    if (
      !replay ||
      replay.race.is_fixture ||
      !person ||
      !before ||
      !after ||
      before.lap_end == null ||
      after.lap_start !== before.lap_end + 1 ||
      !model.available
    ) {
      setError(
        "Select a real, consecutive historical transition and connect a trained model.",
      );
      return;
    }
    if (
      !Number.isInteger(laps) ||
      laps < 1 ||
      laps > 20 ||
      !Number.isInteger(age) ||
      age < 0 ||
      !Number.isFinite(offset) ||
      offset < -5 ||
      offset > 5
    ) {
      setError(
        "Enter 1–20 laps, a non-negative whole tyre age, and an adjustment between -5 and 5 seconds.",
      );
      return;
    }
    if (!supported.length) {
      setError(
        "No dry tyre combinations are supported for this circuit, driver and team.",
      );
      return;
    }
    if (
      start + laps - 1 > replay.race.total_laps ||
      !validRange("race_lap", start) ||
      !validRange("race_lap", start + laps - 1) ||
      !validRange("tyre_age", age) ||
      !validRange("tyre_age", age + laps - 1) ||
      !validRange("track_temperature", temperature)
    ) {
      setError(
        "The requested stint exceeds the race or model's supported lap, tyre-age or temperature range. Shorten it or change the inputs.",
      );
      return;
    }
    const items: Parameters[] = supported.flatMap((compound) =>
      Array.from({ length: laps }, (_, i) => ({
        circuit,
        driver: person.name_acronym,
        team: person.team_name,
        compound,
        tyre_age: age + i,
        race_lap: start + i,
        track_temperature: temperature,
        rainfall: 0,
      })),
    );
    setPending(true);
    try {
      const response = await estimateBatch(items);
      if (
        response.predictions.length !== items.length ||
        response.predictions.some(
          (p) =>
            p.model_version !== model.version ||
            p.dataset_version !== model.dataset_version ||
            !Number.isFinite(p.lap_duration),
        )
      )
        throw new Error(
          "Model version changed or an incomplete response was returned. Refresh and try again.",
        );
      if (id !== sequence.current) return;
      const rows = Array.from({ length: laps }, (_, i) => ({
        lap: start + i,
        age: age + i,
        ...Object.fromEntries(
          supported.map((c, j) => [
            c,
            response.predictions[j * laps + i].lap_duration + offset,
          ]),
        ),
      }));
      setResult({
        rows,
        tyres: supported,
        version: response.predictions[0].model_version,
        dataset: response.predictions[0].dataset_version,
        offset,
      });
    } catch (e) {
      if (id === sequence.current)
        setError(e instanceof Error ? e.message : "Scenario request failed.");
    } finally {
      if (id === sequence.current) setPending(false);
    }
  }
  return (
    <section className="panel scenario-panel" aria-label="Stint scenario lab">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            HISTORICAL TRANSITION → MODEL SCENARIO
          </span>
          <h2>Stint Scenario Lab</h2>
        </div>
        <span className="panel-tag">DRY LAPS ONLY</span>
      </div>
      <p>
        Review an observed stint transition, then compare supported tyre
        scenarios over the same future laps. Stint boundaries indicate an
        inferred pit transition, not a measured pit entry.
      </p>
      {loading && !replay ? (
        <p>Connecting to the historical replay and model…</p>
      ) : !replay || replay.race.is_fixture ? (
        <p className="error-text">
          A real historical replay is required. Synthetic fixtures cannot be
          used for scenarios.
        </p>
      ) : (
        <>
          <div className="scenario-controls">
            <label className="lab-field">
              Historical driver
              <select
                aria-label="Scenario historical driver"
                value={driver}
                onChange={(e) => setDriver(Number(e.target.value))}
              >
                {replay.drivers.map((d) => (
                  <option key={d.driver_number} value={d.driver_number}>
                    {d.name_acronym} · {d.team_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="lab-field">
              Transition after stint
              <select
                aria-label="Transition after stint"
                value={stintNumber}
                onChange={(e) => setStintNumber(Number(e.target.value))}
              >
                {stints.slice(0, -1).map((s) => (
                  <option key={s.stint_number} value={s.stint_number}>
                    Stint {s.stint_number} · {s.compound || "Unknown"} · L
                    {s.lap_start}–{s.lap_end}
                  </option>
                ))}
                {stints.length < 2 && (
                  <option value={0}>No transition available</option>
                )}
              </select>
            </label>
          </div>
          {before && after ? (
            <>
              <div className="scenario-history">
                <div>
                  <span className="eyebrow">OBSERVED BEFORE</span>
                  <b>
                    Stint {before.stint_number} · {before.compound || "Unknown"}
                  </b>
                  <small>
                    L{before.lap_start}–{before.lap_end} · {pre?.count} eligible
                    laps · mean {lapTime(pre?.mean)}
                  </small>
                </div>
                <div>
                  <span className="eyebrow">OBSERVED AFTER</span>
                  <b>
                    Stint {after.stint_number} · {after.compound || "Unknown"}
                  </b>
                  <small>
                    L{after.lap_start}–{after.lap_end} · {post?.count} eligible
                    laps · mean {lapTime(post?.mean)}
                  </small>
                </div>
              </div>
              <p>
                These are observed full-stint averages, not controlled
                comparisons. Pit and caution laps are excluded; traffic, fuel
                and other conditions may differ. Same compound can mean a
                different tyre set.
              </p>
              <div className="scenario-controls">
                <label className="lab-field">
                  Forecast length{" "}
                  <input
                    aria-label="Scenario length"
                    type="number"
                    min="1"
                    max="20"
                    value={laps}
                    onChange={(e) => setLaps(Number(e.target.value))}
                  />
                  <small>1–20 laps, beginning at race lap {start}; transition lap omitted</small>
                </label>
                <label className="lab-field">
                  Starting tyre age{" "}
                  <input
                    aria-label="Scenario starting tyre age"
                    type="number"
                    min="0"
                    value={age}
                    onChange={(e) => setAge(Number(e.target.value))}
                  />
                  <small>Laps already used at the first estimated lap</small>
                </label>
                <label className="lab-field">
                  Track temperature °C{" "}
                  <input
                    aria-label="Scenario track temperature"
                    type="number"
                    step="0.5"
                    value={temperature}
                    onChange={(e) => setTemperature(Number(e.target.value))}
                  />
                  <small>
                    Held constant · range{" "}
                    {model.ranges?.track_temperature?.join("–") ||
                      "unavailable"}
                  </small>
                </label>
                <label className="lab-field">
                  User adjustment sec/lap{" "}
                  <input
                    aria-label="User adjustment seconds per lap"
                    type="number"
                    step="0.1"
                    min="-5"
                    max="5"
                    value={offset}
                    onChange={(e) => setOffset(Number(e.target.value))}
                  />
                  <small>
                    Optional assumption, not a fuel or damage prediction
                  </small>
                </label>
              </div>
              <p>
                Supported: {supported.join(", ") || "none"}. Unsupported
                compounds are omitted. Temperature and the user adjustment stay
                constant; race lap and tyre age advance together.
              </p>
              <Button disabled={!model.available || pending} onClick={run}>
                {pending ? "Estimating scenarios…" : "Compare stint scenarios"}
              </Button>
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
              {result && (
                <div aria-live="polite">
                  <div
                    className="scenario-chart"
                    aria-label="Estimated stint scenario chart"
                  >
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart
                        data={result.rows}
                        margin={{ left: 10, right: 20, top: 20, bottom: 10 }}
                      >
                        <CartesianGrid stroke="#26303f" strokeDasharray="3 5" />
                        <XAxis
                          dataKey="lap"
                          tick={{ fill: "#8190a5" }}
                          label={{
                            value: "Race lap",
                            position: "insideBottom",
                            offset: -5,
                            fill: "#8190a5",
                          }}
                        />
                        <YAxis
                          domain={["auto", "auto"]}
                          width={70}
                          tick={{ fill: "#8190a5" }}
                          tickFormatter={(v) => lapTime(Number(v)).slice(0, -1)}
                        />
                        <Tooltip
                          formatter={(v) => lapTime(Number(v))}
                          contentStyle={{
                            background: "#151c27",
                            border: "1px solid #344154",
                          }}
                        />
                        <Legend verticalAlign="top" />
                        {result.tyres.map((c) => (
                          <Line
                            key={c}
                            dataKey={c}
                            stroke={compounds[c]}
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="scenario-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Scenario</th>
                          <th>Mean estimated lap</th>
                          <th>Sum of estimated laps</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.tyres.map((c) => {
                          const sum = result.rows.reduce((s, r) => s + r[c], 0);
                          return (
                            <tr key={c}>
                              <th>{c}</th>
                              <td>{lapTime(sum / result.rows.length)}</td>
                              <td>{lapTime(sum)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p>
                    Model {result.version} · Dataset {result.dataset} · User
                    adjustment {result.offset >= 0 ? "+" : ""}
                    {result.offset.toFixed(1)} sec/lap applied equally. Sums
                    exclude pit loss and other race events; errors can
                    accumulate. Not a tyre-life, causal or strategy
                    recommendation.
                  </p>
                </div>
              )}
            </>
          ) : (
            <p>
              No pair of consecutive recorded stints is available for this
              driver.
            </p>
          )}
        </>
      )}
      <div className="panel-foot">
        Historical model trained on filtered dry/clean laps. Fuel, damage,
        traffic and setup are not modeled. Not for live race decisions.
      </div>
    </section>
  );
}
