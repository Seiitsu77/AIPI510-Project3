"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Database,
  Flag,
  FlaskConical,
  Gauge,
  Layers3,
  Pause,
  Play,
  Radio,
  RotateCcw,
  SlidersHorizontal,
  Thermometer,
  WifiOff,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import PaceChart from "./pace-chart";
import PaceLab from "./pace-lab";
import { fixtureRaces, fixtureReplay } from "@/lib/fixture";
import { getModel, getRaces, getReplay } from "@/lib/api";
import {
  color,
  compounds,
  lapTime,
  type ModelInfo,
  type Race,
  type Replay,
  type Timing,
} from "@/lib/types";

function PanelHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
function Tyre({
  compound,
  small = false,
}: {
  compound: string | null;
  small?: boolean;
}) {
  return (
    <span
      className={`tyre ${small ? "tyre-small" : ""}`}
      style={
        {
          "--tyre": compounds[compound || ""] || "#728095",
        } as React.CSSProperties
      }
    >
      {compound?.slice(0, 1) || "?"}
    </span>
  );
}
export { PanelHeading, Tyre };

type SavedWorkspace = { key: number; lap: number; drivers: number[] };
function readWorkspace(): SavedWorkspace | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem("pitwall-workspace") || "null",
    );
    if (
      value &&
      Number.isInteger(value.key) &&
      Number.isInteger(value.lap) &&
      value.lap >= 1 &&
      Array.isArray(value.drivers) &&
      value.drivers.length <= 3 &&
      value.drivers.every(Number.isInteger)
    )
      return value;
  } catch {
    /* Storage may be unavailable; the workspace remains usable. */
  }
  return null;
}

export default function PitWall({
  initialPage = "race",
}: {
  initialPage?: "race" | "lab";
}) {
  const [races, setRaces] = useState<Race[]>([]),
    [data, setData] = useState<Replay | null>(null),
    [key, setKey] = useState(-1),
    [season, setSeason] = useState(2024);
  const [lap, setLap] = useState(32),
    [selected, setSelected] = useState<number[]>([1, 4, 16]),
    [range, setRange] = useState<[number, number]>([1, 57]);
  const [source, setSource] = useState<"loading" | "fixture" | "historical">(
      "loading",
    ),
    [apiError, setApiError] = useState(""),
    [loading, setLoading] = useState(true),
    [playing, setPlaying] = useState(false),
    [showFlagged, setShowFlagged] = useState(false),
    [help, setHelp] = useState(false),
    [notice, setNotice] = useState("");
  const [model, setModel] = useState<ModelInfo>({ available: false }),
    [revision, setRevision] = useState(0);
  const cache = useRef(new Map<number, Replay>());
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getRaces(), getModel()])
      .then(([items, info]) => {
        if (!active) return;
        setModel(info);
        if (items.length) {
          setRaces(items);
          const chosen =
            items.find((r) => r.session_key === readWorkspace()?.key) ||
            items[0];
          setKey(chosen.session_key);
          setSeason(chosen.year);
          setSource("historical");
          setApiError("");
        } else {
          setRaces(fixtureRaces);
          setKey(
            fixtureRaces.find((r) => r.session_key === readWorkspace()?.key)
              ?.session_key || -1,
          );
          setSeason(2024);
          setSource("fixture");
          setApiError("No historical sessions ingested yet.");
        }
      })
      .catch(() => {
        if (active) {
          setRaces(fixtureRaces);
          setKey(
            fixtureRaces.find((r) => r.session_key === readWorkspace()?.key)
              ?.session_key || -1,
          );
          setSeason(2024);
          setSource("fixture");
          setApiError("Historical API is unavailable.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  useEffect(() => {
    if (source === "loading") return;
    let active = true;
    setLoading(true);
    setPlaying(false);
    const race = races.find((r) => r.session_key === key);
    if (!race) return;
    const read = race.is_fixture
      ? Promise.resolve(fixtureReplay(race))
      : cache.current.has(key)
        ? Promise.resolve(cache.current.get(key)!)
        : getReplay(key);
    read
      .then((result) => {
        if (!active) return;
        cache.current.set(key, result);
        setData(result);
        const saved = readWorkspace();
        setLap((n) =>
          Math.min(
            saved?.key === result.race.session_key ? saved.lap : n,
            result.race.total_laps,
          ),
        );
        setRange([1, result.race.total_laps]);
        const restored =
          saved?.key === result.race.session_key
            ? saved.drivers.filter((number) =>
                result.drivers.some((d) => d.driver_number === number),
              )
            : [];
        setSelected(
          restored.length
            ? restored
            : result.drivers.slice(0, 3).map((d) => d.driver_number),
        );
      })
      .catch((error) => {
        if (active) {
          setApiError(error.message);
          setData(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [key, races, source]);
  useEffect(() => {
    if (!loading && data?.race.session_key === key) {
      try {
        sessionStorage.setItem(
          "pitwall-workspace",
          JSON.stringify({ key, lap, drivers: selected }),
        );
      } catch {
        /* Optional persistence only. */
      }
    }
  }, [data, key, lap, selected, loading]);
  useEffect(() => {
    if (!help) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button, a[href], input, select, [tabindex="0"]',
        ) || [],
      ).filter((el) => !el.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setHelp(false);
      }
      if (event.key !== "Tab") return;
      const items = focusable(),
        first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [help]);
  const total = data?.race.total_laps || 57;
  const changeLap = useCallback(
    (n: number) => setLap(Math.min(total, Math.max(1, n))),
    [total],
  );
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setLap((n) => {
          if (n >= total) {
            setPlaying(false);
            return total;
          }
          return n + 1;
        }),
      900,
    );
    return () => clearInterval(timer);
  }, [playing, total]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(
          (event.target as HTMLElement).tagName,
        )
      )
        return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        changeLap(lap + 1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        changeLap(lap - 1);
      }
      if (event.key === "Escape") setHelp(false);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [lap, changeLap]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  const snapshot = data?.snapshots[lap - 1];
  const compared = useMemo(
    () =>
      selected
        .map((n) => snapshot?.drivers.find((d) => d.driver_number === n))
        .filter((d): d is Timing => !!d),
    [snapshot, selected],
  );
  function toggle(number: number) {
    setSelected((current) => {
      if (current.includes(number))
        return current.length > 1
          ? current.filter((n) => n !== number)
          : current;
      if (current.length >= 3) {
        setNotice("Compare up to 3 drivers. Remove one to add another.");
        return current;
      }
      return [...current, number];
    });
  }
  function exportCSV() {
    if (!data) return;
    const rows = [
      [
        "source",
        "driver_number",
        "lap",
        "lap_seconds",
        "compound",
        "tyre_age",
        "flags",
      ],
      ...data.laps
        .filter((l) => selected.includes(l.driver_number))
        .map((l) => [
          data.race.source,
          l.driver_number,
          l.race_lap,
          l.lap_duration ?? "",
          l.compound ?? "",
          l.tyre_age ?? "",
          l.exclusions.join("|"),
        ]),
    ];
    const blob = new Blob(
      [
        rows
          .map((row) =>
            row
              .map((value) => `"${String(value).replaceAll('"', '""')}"`)
              .join(","),
          )
          .join("\n"),
      ],
      { type: "text/csv" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `pitwall-${data.race.is_fixture ? "SYNTHETIC-" : ""}${key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const years = Array.from(new Set(races.map((r) => r.year))).sort(
    (a, b) => b - a,
  );
  const visibleRaces = races.filter((r) => r.year === season);
  const race = data?.race;
  const fixture = source === "fixture";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/" className="brand-mark" aria-label="F1 PitWall home">
          P<span>W</span>
          <i />
        </Link>
        <div className="rail-label">WORKSPACE</div>
        <nav>
          <Link
            href="/"
            aria-label="Race Control"
            title="Race Control"
            className={`rail-link ${initialPage === "race" ? "active" : ""}`}
          >
            <Gauge size={21} />
            <span>Control</span>
          </Link>
          <Link
            href="/pace-lab"
            aria-label="Pace Lab"
            title="Pace Lab"
            className={`rail-link ${initialPage === "lab" ? "active" : ""}`}
          >
            <FlaskConical size={21} />
            <span>Pace Lab</span>
          </Link>
        </nav>
        <div className="rail-bottom">
          <button
            className="rail-link"
            onClick={() => setHelp(true)}
            aria-label="Open data guide"
          >
            <CircleHelp size={20} />
            <span>Guide</span>
          </button>
          <span className="avatar">RE</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <Link href="/" className="wordmark">
            F1 <strong>PITWALL</strong>
            <span>RACE ENGINEERING</span>
          </Link>
          <div className="topbar-right">
            <span className="status-dot" />
            <span className="mono subtle">
              {fixture
                ? "DESIGN PREVIEW"
                : source === "loading"
                  ? "CONNECTING"
                  : "HISTORICAL ARCHIVE"}
            </span>
            <span className="top-divider" />
            <span className="version">WORKSPACE 01</span>
          </div>
        </header>
        <main>
          <div className="page-top">
            <div>
              <div className="breadcrumb">
                WORKSPACE <span>/</span>{" "}
                {initialPage === "race"
                  ? "RACE OPERATIONS"
                  : "PERFORMANCE ANALYSIS"}
              </div>
              <h1>
                {initialPage === "race" ? "Race Control" : "Pace Lab"}
                <span className="title-slash">/</span>
              </h1>
              <p>
                {initialPage === "race"
                  ? "Every lap. Every compound. A clearer picture."
                  : "From historical evidence to estimated race pace."}
              </p>
            </div>
            <div className="page-actions">
              <Button onClick={exportCSV} disabled={!data}>
                <ArrowDownToLine size={14} /> Export laps
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setHelp(true)}
                aria-label="Data and methodology"
              >
                <CircleHelp size={18} />
              </Button>
            </div>
          </div>
          <div
            className={`source-banner ${fixture ? "fixture-banner" : ""}`}
            role="status"
          >
            <span>
              <Database size={14} />
              <b>
                {source === "loading"
                  ? "CONNECTING TO HISTORICAL API"
                  : fixture
                    ? "SYNTHETIC UI FIXTURE"
                    : "OBSERVED HISTORICAL DATA"}
              </b>
              <span>
                {fixture
                  ? `${apiError} Timing, strategy and weather below are illustrative, not race records.`
                  : "OpenF1 records · replay of completed sessions · never live telemetry"}
              </span>
            </span>
            <button
              onClick={() => {
                cache.current.clear();
                setRevision((v) => v + 1);
              }}
              disabled={loading}
            >
              <RotateCcw size={12} /> Retry API
            </button>
          </div>
          {initialPage === "race" ? (
            <>
              <section className="session-bar">
                <div className="event-icon">
                  <Flag size={23} />
                </div>
                <div className="session-identity">
                  <span className="eyebrow">
                    GRAND PRIX / {fixture ? "FIXTURE" : "HISTORICAL"}
                  </span>
                  <div className="select-wrap">
                    <select
                      aria-label="Grand Prix"
                      value={key}
                      disabled={loading || !races.length}
                      onChange={(e) => setKey(Number(e.target.value))}
                    >
                      {visibleRaces.map((r) => (
                        <option value={r.session_key} key={r.session_key}>
                          {r.location} Grand Prix
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={15} />
                  </div>
                  <span className="subtle">
                    {race?.circuit_short_name || "Loading circuit"}{" "}
                    <span className="dot-separator">·</span>{" "}
                    {race?.country_name}
                  </span>
                </div>
                <div className="season-select">
                  <label htmlFor="season">SEASON</label>
                  <select
                    id="season"
                    value={season}
                    disabled={!years.length || loading}
                    onChange={(e) => {
                      const year = Number(e.target.value);
                      setSeason(year);
                      setKey(races.find((r) => r.year === year)!.session_key);
                    }}
                  >
                    {years.map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </select>
                </div>
                <div className="session-meta">
                  <span className="eyebrow">SESSION</span>
                  <b>RACE</b>
                </div>
                <div className="replay-badge">
                  <Clock3 size={13} />
                  {fixture ? "FIXTURE PREVIEW" : "HISTORICAL REPLAY"}
                </div>
              </section>
              <section className="metrics-strip">
                <div>
                  <span className="eyebrow">SELECTED LAP</span>
                  <strong>
                    {String(lap).padStart(2, "0")}
                    <small>/ {total}</small>
                  </strong>
                  <div className="mini-progress">
                    <i style={{ width: `${(lap / total) * 100}%` }} />
                  </div>
                </div>
                <div>
                  <span className="eyebrow">
                    <Flag size={12} /> CLASSIFIED AT SNAPSHOT
                  </span>
                  <strong>
                    {snapshot?.drivers.filter((d) => d.position !== null)
                      .length ?? "—"}
                    <small>drivers</small>
                  </strong>
                  <span className="metric-caption">
                    {fixture
                      ? "Illustrative positions"
                      : "Positions available in source"}
                  </span>
                </div>
                <div>
                  <span className="eyebrow">
                    <Thermometer size={12} /> TRACK TEMPERATURE
                  </span>
                  <strong>
                    {snapshot?.weather?.track_temperature?.toFixed(1) ?? "—"}
                    <small>°C</small>
                  </strong>
                  <span className="metric-caption">
                    Air {snapshot?.weather?.air_temperature?.toFixed(1) ?? "—"}
                    °C <span className="dot-separator">·</span>{" "}
                    {snapshot?.weather?.rainfall == null
                      ? "Rain data unavailable"
                      : snapshot.weather.rainfall
                        ? "Rain recorded"
                        : "No rain recorded"}
                  </span>
                </div>
                <div>
                  <span className="eyebrow">
                    <Layers3 size={12} /> DRIVER COMPARISON
                  </span>
                  <strong>
                    {selected.length.toString().padStart(2, "0")}
                    <small>/ 03</small>
                  </strong>
                  <span className="metric-caption">
                    Select drivers in the timing tower
                  </span>
                </div>
              </section>
              <section className="replay-controls">
                <div className="transport">
                  <Button
                    size="icon"
                    variant={playing ? "default" : "outline"}
                    aria-label={playing ? "Pause replay" : "Play replay"}
                    disabled={!data || loading}
                    onClick={() => {
                      if (lap >= total) setLap(1);
                      setPlaying((v) => !v);
                    }}
                  >
                    {playing ? (
                      <Pause size={14} />
                    ) : (
                      <Play size={14} fill="currentColor" />
                    )}
                  </Button>
                  <button
                    aria-label="Previous lap"
                    onClick={() => changeLap(lap - 1)}
                    disabled={lap === 1}
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    aria-label="Next lap"
                    onClick={() => changeLap(lap + 1)}
                    disabled={lap === total}
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
                <span className="mono subtle lap-start">L01</span>
                <input
                  aria-label="Selected race lap"
                  type="range"
                  min="1"
                  max={total}
                  value={lap}
                  onChange={(e) => changeLap(Number(e.target.value))}
                  style={
                    {
                      "--progress": `${((lap - 1) / (total - 1)) * 100}%`,
                    } as React.CSSProperties
                  }
                />
                <span className="mono subtle">L{total}</span>
                <div className="lap-readout">
                  <label htmlFor="lap-number">LAP</label>
                  <input
                    id="lap-number"
                    aria-label="Lap number"
                    type="number"
                    min="1"
                    max={total}
                    value={lap}
                    onChange={(e) => changeLap(Number(e.target.value))}
                  />
                </div>
                <span className="keyboard-hint">← → TO SCRUB</span>
              </section>
              {loading ? (
                <div className="loading-state">
                  <Activity className="pulse" size={25} />
                  Loading session workspace…
                </div>
              ) : !data ? (
                <div className="empty-state">
                  <WifiOff size={30} />
                  <h2>Session unavailable</h2>
                  <p>{apiError}</p>
                  <Button onClick={() => setRevision((v) => v + 1)}>
                    Retry connection
                  </Button>
                </div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  className="dashboard-grid"
                >
                  <section className="panel timing-panel">
                    <PanelHeading
                      eyebrow="SESSION CLASSIFICATION"
                      title="Timing tower"
                    >
                      <span className="mono subtle">
                        LAP {String(lap).padStart(2, "0")}
                      </span>
                    </PanelHeading>
                    <div className="tower-labels">
                      <span>POS / DRIVER</span>
                      <span>LAST LAP</span>
                      <span>GAP</span>
                      <span>TYRE</span>
                    </div>
                    <div className="timing-rows">
                      {snapshot?.drivers.map((d) => (
                        <button
                          key={d.driver_number}
                          aria-pressed={selected.includes(d.driver_number)}
                          aria-label={`Compare ${d.full_name}`}
                          className={`timing-row ${selected.includes(d.driver_number) ? "selected" : ""}`}
                          style={{ "--team": color(d) } as React.CSSProperties}
                          onClick={() => toggle(d.driver_number)}
                        >
                          <span className="driver-cell">
                            <span className="position">
                              {d.position?.toString().padStart(2, "0") || "—"}
                            </span>
                            <i className="team-stripe" />
                            <span>
                              <b>{d.name_acronym}</b>
                              <small>{d.team_name}</small>
                            </span>
                          </span>
                          <span className="lap-cell mono">
                            {lapTime(d.lap_duration)}
                            {d.exclusions.length > 0 && (
                              <small title={d.exclusions.join(", ")}>
                                FLAGGED
                              </small>
                            )}
                          </span>
                          <span className="gap-cell mono">
                            {d.gap_to_leader === 0
                              ? "LEADER"
                              : typeof d.gap_to_leader === "number"
                                ? `+${d.gap_to_leader.toFixed(1)}`
                                : d.gap_to_leader || "—"}
                          </span>
                          <span className="tyre-cell">
                            <Tyre compound={d.compound} small />
                            <small className="mono">{d.tyre_age ?? "—"}</small>
                          </span>
                          <span className="row-check">
                            {selected.includes(d.driver_number) && (
                              <Check size={9} />
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="panel-foot">
                      <span className="status-dot" />
                      Select up to 3 drivers to compare
                    </div>
                  </section>
                  <div className="analysis-stack">
                    <section className="panel pace-panel">
                      <PanelHeading
                        eyebrow="PERFORMANCE ANALYSIS"
                        title="Lap time evolution"
                      >
                        <span className="panel-tag">
                          {fixture ? "ILLUSTRATIVE" : "OBSERVED"} / SECONDS
                        </span>
                      </PanelHeading>
                      <div className="chart-toolbar">
                        <div className="driver-chips">
                          {selected.map((number) => {
                            const d = data.drivers.find(
                              (d) => d.driver_number === number,
                            )!;
                            return (
                              <button
                                key={number}
                                className="driver-chip"
                                style={
                                  { "--team": color(d) } as React.CSSProperties
                                }
                                onClick={() => toggle(number)}
                                aria-label={`Remove ${d.name_acronym} from comparison`}
                              >
                                <i />
                                {d.name_acronym}
                                <X size={11} />
                              </button>
                            );
                          })}
                        </div>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={showFlagged}
                            onChange={(e) => setShowFlagged(e.target.checked)}
                          />{" "}
                          Include flagged laps
                        </label>
                      </div>
                      <PaceChart
                        data={data}
                        drivers={selected}
                        lap={lap}
                        onLap={changeLap}
                        range={range}
                        showFlagged={showFlagged}
                      />
                      <div className="chart-bottom">
                        <span>
                          <i className="dashed-key" /> Selected lap{" "}
                          <span className="dot-separator">·</span> Click chart
                          to inspect
                        </span>
                        <div className="range-controls">
                          <SlidersHorizontal size={12} />
                          <label>
                            From{" "}
                            <input
                              aria-label="Chart start lap"
                              type="number"
                              min="1"
                              max={range[1] - 1}
                              value={range[0]}
                              onChange={(e) =>
                                setRange([
                                  Math.max(
                                    1,
                                    Math.min(
                                      Number(e.target.value),
                                      range[1] - 1,
                                    ),
                                  ),
                                  range[1],
                                ])
                              }
                            />
                          </label>
                          <label>
                            to{" "}
                            <input
                              aria-label="Chart end lap"
                              type="number"
                              min={range[0] + 1}
                              max={total}
                              value={range[1]}
                              onChange={(e) =>
                                setRange([
                                  range[0],
                                  Math.min(
                                    total,
                                    Math.max(
                                      Number(e.target.value),
                                      range[0] + 1,
                                    ),
                                  ),
                                ])
                              }
                            />
                          </label>
                          <button
                            onClick={() => setRange([1, total])}
                            aria-label="Reset chart range"
                          >
                            <RotateCcw size={12} />
                          </button>
                        </div>
                      </div>
                    </section>
                    <section className="panel tyre-panel">
                      <PanelHeading
                        eyebrow="COMPOUND INTELLIGENCE"
                        title="Tyre status"
                      >
                        <span className="subtle tiny">
                          At each driver’s last completed lap
                        </span>
                      </PanelHeading>
                      <div className="tyre-cards">
                        {compared.map((d) => (
                          <div className="tyre-card" key={d.driver_number}>
                            <div className="tyre-driver">
                              <span>
                                <i style={{ background: color(d) }} />
                                {d.name_acronym}
                              </span>
                              <span className="subtle mono">
                                STINT {d.stint?.stint_number ?? "—"}
                              </span>
                            </div>
                            <div className="tyre-card-main">
                              <Tyre compound={d.compound} />
                              <div>
                                <span
                                  className="compound-name"
                                  style={{ color: compounds[d.compound || ""] }}
                                >
                                  {d.compound || "UNKNOWN"}
                                </span>
                                <strong>
                                  {d.tyre_age ?? "—"}
                                  <small>laps at start</small>
                                </strong>
                              </div>
                            </div>
                            <div className="stint-detail">
                              <span>STINT WINDOW</span>
                              <b className="mono">
                                L{d.stint?.lap_start ?? "—"} <span>→</span> L
                                {d.stint?.lap_end ?? "—"}
                              </b>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="panel stint-panel">
                      <PanelHeading
                        eyebrow="STRATEGY OVERVIEW"
                        title="Tyre stint timeline"
                      >
                        <div className="compound-legend">
                          {[
                            "SOFT",
                            "MEDIUM",
                            "HARD",
                            "INTERMEDIATE",
                            "WET",
                          ].map((c) => (
                            <span key={c}>
                              <i style={{ background: compounds[c] }} />
                              {c === "INTERMEDIATE" ? "INTER" : c}
                            </span>
                          ))}
                        </div>
                      </PanelHeading>
                      <div className="timeline">
                        <div className="timeline-axis">
                          <span>DRIVER</span>
                          <div>
                            {Array.from({ length: 7 }, (_, i) => (
                              <span key={i}>
                                {Math.round(1 + ((total - 1) * i) / 6)}
                              </span>
                            ))}
                          </div>
                        </div>
                        {data.drivers
                          .filter((d) => selected.includes(d.driver_number))
                          .map((d) => (
                            <div className="timeline-row" key={d.driver_number}>
                              <b>
                                <i style={{ background: color(d) }} />
                                {d.name_acronym}
                              </b>
                              <div className="timeline-track">
                                {data.stints
                                  .filter(
                                    (s) =>
                                      s.driver_number === d.driver_number &&
                                      s.lap_start != null &&
                                      s.lap_end != null,
                                  )
                                  .map((s) => (
                                    <div
                                      key={s.stint_number}
                                      className="stint-bar"
                                      style={
                                        {
                                          left: `${((s.lap_start! - 1) / total) * 100}%`,
                                          width: `${((s.lap_end! - s.lap_start! + 1) / total) * 100}%`,
                                          "--compound":
                                            compounds[s.compound || ""] ||
                                            "#738197",
                                        } as React.CSSProperties
                                      }
                                    >
                                      <span>
                                        {s.compound?.slice(0, 1)}{" "}
                                        <small>
                                          {s.lap_end! - s.lap_start! + 1} LAPS
                                        </small>
                                      </span>
                                      {s.stint_number > 1 && (
                                        <i
                                          className="pit-marker"
                                          title={`Stint starts lap ${s.lap_start}`}
                                        />
                                      )}
                                    </div>
                                  ))}
                                <div
                                  className="timeline-cursor"
                                  style={{
                                    left: `${((lap - 0.5) / total) * 100}%`,
                                  }}
                                />
                                {Array.from({ length: total }, (_, i) => (
                                  <button
                                    key={i}
                                    style={{
                                      left: `${(i / total) * 100}%`,
                                      width: `${100 / total}%`,
                                    }}
                                    aria-label={`${d.name_acronym} select lap ${i + 1}`}
                                    title={`Lap ${i + 1}`}
                                    onClick={() => changeLap(i + 1)}
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                      </div>
                      <div className="panel-foot">
                        <span className="pit-diamond" />
                        Stint boundary / inferred pit transition
                        <span className="push-right">
                          Click any segment to select a lap
                        </span>
                      </div>
                    </section>
                  </div>
                </motion.div>
              )}
              <div className="workspace-notes">
                <span>
                  <Radio size={13} /> ENGINEER’S NOTE
                </span>
                <p>
                  {fixture
                    ? "Design fixture active. All displayed race values are synthetic. Connect an ingested historical session to analyze observed laps."
                    : "Replay snapshots use the first recorded completion of the selected lap. Positions and gaps are the latest source observations at or before that timestamp; lapped or retired drivers may show an earlier completed lap."}
                </p>
                <span className="mono">
                  {fixture ? "SOURCE / FIXTURE" : "SOURCE / OPENF1"}
                </span>
              </div>
            </>
          ) : (
            <PaceLab
              model={model}
              replay={data}
              onRefresh={async () => setModel(await getModel())}
            />
          )}
          <footer>
            <span>
              <span className="status-dot" />
              {fixture ? "FIXTURE WORKSPACE" : "HISTORICAL ANALYSIS"}
              <span className="dot-separator">/</span> F1 PITWALL
            </span>
            <span>
              Independent academic project{" "}
              <span className="dot-separator">·</span> Not affiliated with
              Formula 1
            </span>
            <span className="mono">v1.0.0</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              className="modal-close"
              size="icon"
              aria-label="Close data guide"
              onClick={() => setHelp(false)}
            >
              <X size={17} />
            </Button>
            <span className="eyebrow">DATA & METHODOLOGY</span>
            <h2 id="guide-title">Know your evidence.</h2>
            <p>
              The amber banner identifies a synthetic design fixture. Its laps,
              positions, gaps, tyres and weather are illustrative. It is never
              used for model training.
            </p>
            <p>
              Historical mode reads cached OpenF1 records through FastAPI.
              Scrubbing uses a shared replay snapshot. Missing values are shown
              as a dash; flags mark pit laps, neutralization, missing fields and
              other training exclusions.
            </p>
            <p>
              Tyre age means laps on the set at the start of the displayed lap,
              including source-reported prior usage. Stint boundaries are not
              exact pit-entry timestamps.
            </p>
            <p>
              Pace Lab only displays predictions and evaluation metrics returned
              by a trained model API. Compound curves describe associations, not
              causal simulations.
            </p>
            <Button variant="default" onClick={() => setHelp(false)}>
              Back to workspace <ArrowRight size={14} />
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
