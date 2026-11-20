export type Race = {
  session_key: number;
  year: number;
  location: string;
  country_name: string;
  circuit_short_name: string;
  session_name: string;
  date_start: string;
  total_laps: number;
  source: string;
  is_fixture: boolean;
  data_warnings?: string[];
  missing_lap_records?: number;
};
export type Driver = {
  driver_number: number;
  name_acronym: string;
  full_name: string;
  team_name: string;
  team_colour: string | null;
};
export type Stint = {
  driver_number: number;
  stint_number: number;
  compound: string | null;
  lap_start: number | null;
  lap_end: number | null;
  tyre_age_at_start: number | null;
};
export type Lap = {
  driver_number: number;
  race_lap: number;
  lap_duration: number | null;
  compound: string | null;
  tyre_age: number | null;
  date_end: string | null;
  is_pit_lap: boolean;
  exclusions: string[];
  eligible: boolean;
};
export type Timing = Driver & {
  position: number | null;
  gap_to_leader: number | string | null;
  completed_lap: number;
  lap_duration: number | null;
  compound: string | null;
  tyre_age: number | null;
  stint: Stint | null;
  exclusions: string[];
};
export type Weather = {
  track_temperature: number | null;
  air_temperature: number | null;
  rainfall: number | null;
};
export type Snapshot = {
  lap: number;
  date: string | null;
  drivers: Timing[];
  weather: Weather | null;
};
export type Replay = {
  race: Race;
  drivers: Driver[];
  laps: Lap[];
  stints: Stint[];
  snapshots: Snapshot[];
};
export type Prediction = {
  lap_duration: number;
  model_version: string;
  dataset_version: string;
};
export type HistoricalReference = {
  source: string;
  lap_count: number;
  mean_lap_duration: number | null;
  session_keys: number[];
  observations: {
    session_key: number;
    race_lap: number;
    tyre_age: number;
    lap_duration: number;
  }[];
};
export type ModelInfo = {
  available: boolean;
  detail?: string;
  version?: string;
  model?: string;
  dataset_version?: string;
  trained_at?: string;
  test_metrics?: { mae: number; rmse: number };
  validation_metrics?: { mae: number; rmse: number };
  support?: Record<string, string[]>;
  ranges?: Record<string, [number, number]>;
  combinations?: {
    circuit: string;
    driver: string;
    team: string;
    compound: string;
  }[];
  evaluation?: {
    session_key: number;
    lap_duration: number;
    predicted: number;
  }[];
  split?: Record<string, number[]>;
  rows?: Record<string, number>;
  limitations?: string;
  example_input?: {
    circuit: string;
    driver: string;
    team: string;
    compound: string;
    tyre_age: number;
    race_lap: number;
    track_temperature: number;
    rainfall: number;
  };
};
export const compounds: Record<string, string> = {
  SOFT: "#e64b59",
  MEDIUM: "#efce58",
  HARD: "#e0e6ee",
  INTERMEDIATE: "#54c790",
  WET: "#5d9ef2",
};
export function lapTime(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const ms = Math.round(seconds * 1000);
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
}
export const color = (driver: Driver) => `#${driver.team_colour || "7b8a9f"}`;
