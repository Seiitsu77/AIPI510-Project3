"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CircleAlert,
  FlaskConical,
  Loader2,
  RotateCcw,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import StintScenario from "./stint-scenario";
import {
  estimate,
  estimateBatch,
  getReference,
  type Parameters,
} from "@/lib/api";
import {
  compounds,
  lapTime,
  type ModelInfo,
  type Prediction,
  type Replay,
  type HistoricalReference,
} from "@/lib/types";
const initial: Parameters = {
  circuit: "",
  driver: "",
  team: "",
  compound: "MEDIUM",
  tyre_age: 12,
  race_lap: 30,
  track_temperature: 35,
  rainfall: 0,
};
export default function PaceLab({
  model,
  replay,
  onRefresh,
  selectedDriver,
  selectedLap,
  loading = false,
}: {
  loading?: boolean;
  selectedLap?: number;
  selectedDriver?: number;
  model: ModelInfo;
  replay: Replay | null;
  onRefresh: () => Promise<void>;
}) {
  const [params, setParams] = useState<Parameters>(initial),
    [prediction, setPrediction] = useState<Prediction | null>(null),
    [curve, setCurve] = useState<Record<string, number>[]>([]),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const sequence = useRef(0);
  const [reference, setReference] = useState<HistoricalReference | null>(null);
  const [referenceError, setReferenceError] = useState("");
  const [referenceLoading, setReferenceLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setReference(null);
    setReferenceError("");
    if (!model.available || !params.circuit || replay?.race.is_fixture) return;
    setReferenceLoading(true);
    getReference({
      circuit: params.circuit,
      driver: params.driver,
      team: params.team,
      compound: params.compound,
    })
      .then((data) => {
        if (active) setReference(data);
      })
      .catch((error) => {
        if (active) setReferenceError(error.message);
      })
      .finally(() => {
        if (active) setReferenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    model.available,
    params.circuit,
    params.driver,
    params.team,
    params.compound,
    replay?.race.is_fixture,
  ]);
  useEffect(() => {
    const first = model.example_input || model.combinations?.[0];
    if (first) {
      setParams({
        ...initial,
        ...first,
        ...Object.fromEntries(
          Object.entries(model.ranges || {}).map(([name, [min, max]]) => [
            name,
            Math.max(
              min,
              Math.min(
                max,
                Number(
                  model.example_input?.[name as keyof Parameters] ??
                    initial[name as keyof Parameters],
                ),
              ),
            ),
          ]),
        ),
      });
    }
  }, [model.version]);
  useEffect(() => {
    sequence.current++;
    setPrediction(null);
    setCurve([]);
    setError("");
    setPending(false);
  }, [params]);
  const combinations = model.combinations || [];
  const supportedCompounds = combinations
    .filter(
      (c) =>
        c.circuit === params.circuit &&
        c.driver === params.driver &&
        c.team === params.team,
    )
    .map((c) => c.compound);
  const circuits = [...new Set(combinations.map((c) => c.circuit))];
  const drivers = [
    ...new Set(
      combinations
        .filter((c) => c.circuit === params.circuit)
        .map((c) => c.driver),
    ),
  ];
  const observed = useMemo(
    () =>
      replay &&
      !replay.race.is_fixture &&
      replay.race.circuit_short_name === params.circuit
        ? replay.laps.filter(
            (l) =>
              replay.drivers.find((d) => d.driver_number === l.driver_number)
                ?.name_acronym === params.driver &&
              l.compound === params.compound &&
              l.eligible,
          )
        : [],
    [replay, params.circuit, params.driver, params.compound],
  );
  const mean = observed.length
    ? observed.reduce((sum, l) => sum + (l.lap_duration || 0), 0) /
      observed.length
    : null;
  async function run() {
    const id = ++sequence.current;
    setPending(true);
    setError("");
    setPrediction(null);
    setCurve([]);
    try {
      const ageRange = model.ranges?.tyre_age || [0, 50];
      const minimum = Math.ceil(ageRange[0]),
        maximum = Math.floor(Math.min(ageRange[1], 60));
      const count = Math.min(30, maximum - minimum + 1);
      const ages = Array.from({ length: count }, (_, i) =>
        Math.round(
          minimum + ((maximum - minimum) * i) / Math.max(1, count - 1),
        ),
      );
      const compare = ["SOFT", "MEDIUM", "HARD"].filter((c) =>
        supportedCompounds.includes(c),
      );
      const requests = compare.flatMap((compound) =>
        ages.map((tyre_age) => ({ ...params, compound, tyre_age })),
      );
      const single = await estimate(params);
      const batch = requests.length
        ? await estimateBatch(requests)
        : { predictions: [] };
      if (
        batch.predictions.some((p) => p.model_version !== single.model_version)
      )
        throw new Error(
          "The deployed model changed during this request. Run the estimate again.",
        );
      if (id !== sequence.current) return;
      setPrediction(single);
      setCurve(
        ages.map((age, i) => ({
          age,
          ...Object.fromEntries(
            compare.map((compound, j) => [
              compound,
              batch.predictions[j * ages.length + i].lap_duration,
            ]),
          ),
        })),
      );
    } catch (e) {
      if (id === sequence.current)
        setError(e instanceof Error ? e.message : "Prediction failed");
    } finally {
      if (id === sequence.current) setPending(false);
    }
  }
  function pickCircuit(circuit: string) {
    const next = combinations.find((c) => c.circuit === circuit);
    if (next) setParams((p) => ({ ...p, ...next }));
  }
  function pickDriver(driver: string) {
    const next = combinations.find(
      (c) => c.circuit === params.circuit && c.driver === driver,
    );
    if (next) setParams((p) => ({ ...p, ...next }));
  }
  const numeric = (
    field: "tyre_age" | "race_lap" | "track_temperature",
    label: string,
    unit: string,
  ) => (
    <label className="lab-field">
      {label}
      <div className="unit-input">
        <input
          aria-label={label}
          disabled={!model.available}
          type="number"
          step={field === "track_temperature" ? 0.5 : 1}
          min={model.ranges?.[field]?.[0] ?? 0}
          max={model.ranges?.[field]?.[1] ?? 100}
          value={params[field]}
          onChange={(e) =>
            setParams((p) => ({ ...p, [field]: Number(e.target.value) }))
          }
        />
        <span>{unit}</span>
      </div>
      <small>
        Training range: {model.ranges?.[field]?.join("–") || "unavailable"}
      </small>
    </label>
  );
  return (
    <div className="lab-workspace">
      <StintScenario
        model={model}
        replay={replay}
        selectedDriver={selectedDriver}
        selectedLap={selectedLap}
        loading={loading}
      />
      {!model.available && !loading && (
        <div className="model-warning">
          <CircleAlert size={20} />
          <div>
            <b>A trained model is required.</b>
            <p>
              {model.detail ||
                "Ingest historical races, train the pipeline, then connect the API."}{" "}
              Predictions, curves and evaluation metrics are unavailable until
              then.
            </p>
          </div>
          <Button onClick={onRefresh}>
            <RotateCcw size={13} /> Check model
          </Button>
        </div>
      )}
      <div className="lab-grid">
        <section className="panel parameter-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">MODEL INPUTS</span>
              <h2>Define a lap</h2>
            </div>
            <FlaskConical size={19} className="subtle" />
          </div>
          <div className="lab-fields">
            <label className="lab-field">
              Circuit
              <select
                aria-label="Prediction circuit"
                disabled={!model.available}
                value={params.circuit}
                onChange={(e) => pickCircuit(e.target.value)}
              >
                {!circuits.length && <option>Awaiting trained model</option>}
                {circuits.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <div className="field-pair">
              <label className="lab-field">
                Driver
                <select
                  aria-label="Prediction driver"
                  disabled={!model.available}
                  value={params.driver}
                  onChange={(e) => pickDriver(e.target.value)}
                >
                  {!drivers.length && <option>—</option>}
                  {drivers.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className="lab-field">
                Team
                <input
                  aria-label="Prediction team"
                  readOnly
                  value={params.team || "—"}
                />
              </label>
            </div>
            <label className="lab-field">Tyre compound</label>
            <div className="compound-buttons">
              {["SOFT", "MEDIUM", "HARD"].map((c) => (
                <button
                  key={c}
                  aria-pressed={params.compound === c}
                  disabled={!model.available || !supportedCompounds.includes(c)}
                  onClick={() => setParams((p) => ({ ...p, compound: c }))}
                  style={{ "--compound": compounds[c] } as React.CSSProperties}
                  className={params.compound === c ? "chosen" : ""}
                >
                  <span>{c[0]}</span>
                  {c}
                </button>
              ))}
            </div>
            <div className="field-pair">
              {numeric("tyre_age", "Tyre age", "laps")}
              {numeric("race_lap", "Race lap", "lap")}
            </div>
            {numeric("track_temperature", "Track temperature", "°C")}
            <label className="lab-field">
              Rainfall
              <select
                aria-label="Prediction rainfall"
                disabled={
                  !model.available ||
                  model.ranges?.rainfall?.[0] === model.ranges?.rainfall?.[1]
                }
                value={params.rainfall}
                onChange={(e) =>
                  setParams((p) => ({ ...p, rainfall: Number(e.target.value) }))
                }
              >
                <option value="0">No rain recorded</option>
                <option value="1">Rain recorded</option>
              </select>
              <small>Wet inputs are unavailable for a dry-only model.</small>
            </label>
            <Button
              variant="default"
              disabled={!model.available || pending}
              onClick={run}
            >
              {pending ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <FlaskConical size={15} />
              )}{" "}
              {pending ? "Estimating pace…" : "Estimate lap time"}
              <ArrowRight size={15} />
            </Button>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
        <div className="lab-results">
          <section className="prediction-panel panel">
            <div>
              <span className="eyebrow">ESTIMATED LAP TIME</span>
              <div className="predicted-time" aria-live="polite">
                {pending ? "…" : lapTime(prediction?.lap_duration)}
              </div>
              <span className="subtle">
                {prediction
                  ? "Model estimate · seconds converted to lap time"
                  : model.available
                    ? "Set the conditions and run an estimate"
                    : "No trained model connected"}
              </span>
            </div>
            <div className="model-badge">
              <FlaskConical size={17} />
              <div>
                <span className="eyebrow">MODEL VERSION</span>
                <b className="mono">
                  {prediction?.model_version ||
                    model.version ||
                    "NOT AVAILABLE"}
                </b>
                <small>
                  {model.model?.replaceAll("_", " ") ||
                    "Awaiting historical training"}
                </small>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">MODEL ESTIMATES</span>
                <h2>Tyre performance curve</h2>
              </div>
              <span className="panel-tag">CONDITIONS HELD FIXED</span>
            </div>
            {curve.length ? (
              <div className="curve-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={curve}
                    margin={{ left: 20, right: 24, top: 15, bottom: 15 }}
                  >
                    <CartesianGrid
                      stroke="#26303f"
                      vertical={false}
                      strokeDasharray="3 5"
                    />
                    <XAxis
                      dataKey="age"
                      tick={{ fill: "#8190a5", fontSize: 11 }}
                      label={{
                        value: "Tyre age at lap start",
                        fill: "#8190a5",
                        position: "insideBottom",
                        offset: -10,
                        fontSize: 11,
                      }}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fill: "#8190a5", fontSize: 11 }}
                      tickFormatter={(v) => lapTime(Number(v)).slice(0, -1)}
                      width={65}
                    />
                    <Tooltip
                      formatter={(value) => lapTime(Number(value))}
                      contentStyle={{
                        background: "#151c27",
                        border: "1px solid #344154",
                        fontSize: 12,
                      }}
                      labelFormatter={(label) => `Tyre age ${label} laps`}
                    />
                    <Legend verticalAlign="top" />
                    {["SOFT", "MEDIUM", "HARD"]
                      .filter((c) => supportedCompounds.includes(c))
                      .map((c) => (
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
            ) : (
              <div className="empty-chart">
                <div className="empty-chart-grid" />
                <FlaskConical size={24} />
                <b>
                  {pending
                    ? "Requesting model predictions…"
                    : "No predictions yet"}
                </b>
                <span>
                  {model.available
                    ? "Run an estimate to compare supported dry compounds."
                    : "Curves will appear after a real model is trained."}
                </span>
              </div>
            )}
            <div className="panel-foot">
              Observational estimates, not causal or physical simulations. Only
              trained combinations are supported.
            </div>
          </section>
          <section className="panel historical-panel">
            <div>
              <span className="eyebrow">OBSERVED / HISTORICAL REFERENCE</span>
              <h2>Context from the archive</h2>
              <p>
                {replay?.race.is_fixture
                  ? "UI fixture values are excluded from historical reference."
                  : referenceLoading
                    ? "Loading observed historical laps…"
                    : referenceError
                      ? `Historical reference unavailable: ${referenceError}`
                      : reference?.lap_count
                        ? `${params.circuit} · ${params.driver} · ${params.compound} · ${reference.session_keys.length} historical sessions · eligible laps only`
                        : observed.length
                          ? `${replay?.race.location} · ${params.driver} · ${params.compound} · eligible laps only`
                          : "No matching real session is loaded in this workspace."}
              </p>
              {reference && reference.observations.length > 0 && (
                <div className="reference-samples">
                  {reference.observations.slice(-4).map((row, index) => (
                    <span key={`${row.session_key}-${row.race_lap}-${index}`}>
                      #{row.session_key} · L{row.race_lap}{" "}
                      <b>{lapTime(row.lap_duration)}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <strong className="mono">
                {lapTime(reference ? reference.mean_lap_duration : mean)}
              </strong>
              <span>
                {reference?.lap_count ?? observed.length} observed laps · mean
              </span>
            </div>
          </section>
        </div>
      </div>
      <section className="panel diagnostics">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">HELD-OUT TEST RACES</span>
            <h2>Model diagnostics</h2>
          </div>
          <span className="panel-tag">CHRONOLOGICAL RACE SPLIT</span>
        </div>
        <div className="diagnostics-content">
          <div className="diagnostic-metrics">
            <div>
              <span className="eyebrow">MEAN ABSOLUTE ERROR</span>
              <strong>
                {model.test_metrics?.mae.toFixed(3) ?? "—"}
                <small>sec</small>
              </strong>
            </div>
            <div>
              <span className="eyebrow">ROOT MEAN SQUARED ERROR</span>
              <strong>
                {model.test_metrics?.rmse.toFixed(3) ?? "—"}
                <small>sec</small>
              </strong>
            </div>
            <div className="diagnostic-detail">
              <span>
                Dataset{" "}
                <b className="mono">{model.dataset_version || "unavailable"}</b>
              </span>
              <span>
                Test races <b>{model.split?.test?.length ?? "—"}</b>
              </span>
              <span>
                Test laps <b>{model.rows?.test ?? "—"}</b>
              </span>
              <span>
                Validation selects the model; held-out test races measure final
                performance.
              </span>
            </div>
          </div>
          <div className="diagnostic-chart">
            {model.evaluation?.length ? (
              <>
                <span className="eyebrow">ACTUAL VS PREDICTED / SECONDS</span>
                <ResponsiveContainer width="100%" height={230}>
                  <ScatterChart
                    margin={{ left: 0, right: 20, top: 20, bottom: 15 }}
                  >
                    <CartesianGrid stroke="#26303f" strokeDasharray="3 5" />
                    <XAxis
                      type="number"
                      dataKey="lap_duration"
                      name="Observed"
                      domain={["dataMin - 1", "dataMax + 1"]}
                      tick={{ fill: "#8190a5", fontSize: 10 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="predicted"
                      name="Predicted"
                      domain={["dataMin - 1", "dataMax + 1"]}
                      tick={{ fill: "#8190a5", fontSize: 10 }}
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      contentStyle={{
                        background: "#151c27",
                        border: "1px solid #344154",
                      }}
                    />
                    <Scatter
                      data={model.evaluation}
                      fill="#e65b6a"
                      isAnimationActive={false}
                    />
                    <ReferenceLine
                      segment={[
                        { x: 45, y: 45 },
                        { x: 200, y: 200 },
                      ]}
                      stroke="#758298"
                      strokeDasharray="4 4"
                      ifOverflow="hidden"
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="empty-chart">
                <b>Evaluation pending</b>
                <span>
                  No held-out metrics or predictions have been generated.
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="panel-foot">
          {model.limitations ||
            "Fuel load, traffic, damage and car setup are not modeled. Reproducibility takes priority over optimistic metrics."}
        </div>
      </section>
    </div>
  );
}
