// SYNTHETIC DESIGN FIXTURE. These are not historical laps, results, gaps, or weather.
// This module is frontend-only and cannot be ingested by the ML pipeline.
import type { Driver, Lap, Race, Replay, Stint } from "./types";
const drivers: Driver[] = [
  [1, "VER", "Max Verstappen", "Red Bull Racing", "6691ff"],
  [4, "NOR", "Lando Norris", "McLaren", "ff9c48"],
  [16, "LEC", "Charles Leclerc", "Ferrari", "e75263"],
  [81, "PIA", "Oscar Piastri", "McLaren", "ff9c48"],
  [55, "SAI", "Carlos Sainz", "Ferrari", "e75263"],
  [63, "RUS", "George Russell", "Mercedes", "57d4c1"],
  [44, "HAM", "Lewis Hamilton", "Mercedes", "57d4c1"],
  [11, "PER", "Sergio Perez", "Red Bull Racing", "6691ff"],
  [14, "ALO", "Fernando Alonso", "Aston Martin", "67bc9b"],
  [18, "STR", "Lance Stroll", "Aston Martin", "67bc9b"],
  [22, "TSU", "Yuki Tsunoda", "RB", "9c9df4"],
  [3, "RIC", "Daniel Ricciardo", "RB", "9c9df4"],
  [27, "HUL", "Nico Hulkenberg", "Haas", "b8c4d3"],
  [20, "MAG", "Kevin Magnussen", "Haas", "b8c4d3"],
  [23, "ALB", "Alexander Albon", "Williams", "55b6f7"],
  [2, "SAR", "Logan Sargeant", "Williams", "55b6f7"],
  [31, "OCO", "Esteban Ocon", "Alpine", "db8cca"],
  [10, "GAS", "Pierre Gasly", "Alpine", "db8cca"],
  [77, "BOT", "Valtteri Bottas", "Kick Sauber", "7ed772"],
  [24, "ZHO", "Zhou Guanyu", "Kick Sauber", "7ed772"],
].map(([driver_number, name_acronym, full_name, team_name, team_colour]) => ({
  driver_number: Number(driver_number),
  name_acronym: String(name_acronym),
  full_name: String(full_name),
  team_name: String(team_name),
  team_colour: String(team_colour),
}));
export const fixtureRaces: Race[] = [
  {
    session_key: -1,
    year: 2024,
    location: "Bahrain",
    country_name: "Bahrain",
    circuit_short_name: "Sakhir",
    session_name: "Race",
    date_start: "2024-03-02T15:00:00Z",
    total_laps: 57,
    source: "Synthetic UI fixture",
    is_fixture: true,
  },
  {
    session_key: -2,
    year: 2024,
    location: "Jeddah",
    country_name: "Saudi Arabia",
    circuit_short_name: "Jeddah",
    session_name: "Race",
    date_start: "2024-03-09T17:00:00Z",
    total_laps: 50,
    source: "Synthetic UI fixture",
    is_fixture: true,
  },
  {
    session_key: -3,
    year: 2024,
    location: "Melbourne",
    country_name: "Australia",
    circuit_short_name: "Melbourne",
    session_name: "Race",
    date_start: "2024-03-24T04:00:00Z",
    total_laps: 58,
    source: "Synthetic UI fixture",
    is_fixture: true,
  },
];
export function fixtureReplay(race: Race): Replay {
  const laps: Lap[] = [],
    stints: Stint[] = [];
  const base = race.session_key === -2 ? 91 : race.session_key === -3 ? 81 : 95;
  drivers.forEach((d, i) => {
    const pit1 = 15 + (i % 6),
      pit2 = 35 + (i % 5);
    const plan = [
      { start: 1, end: pit1, compound: i % 3 === 0 ? "SOFT" : "MEDIUM" },
      { start: pit1 + 1, end: pit2, compound: "HARD" },
      {
        start: pit2 + 1,
        end: race.total_laps,
        compound: i % 2 === 0 ? "HARD" : "MEDIUM",
      },
    ];
    plan.forEach((s, j) =>
      stints.push({
        driver_number: d.driver_number,
        stint_number: j + 1,
        lap_start: s.start,
        lap_end: s.end,
        compound: s.compound,
        tyre_age_at_start: 0,
      }),
    );
    let elapsed = 0;
    for (let n = 1; n <= race.total_laps; n++) {
      const s = plan.find((s) => n >= s.start && n <= s.end)!;
      const age = n - s.start;
      const pit = n === pit1 || n === pit2 || n === pit1 + 1 || n === pit2 + 1;
      const duration =
        base +
        i * 0.18 -
        n * 0.056 +
        age * 0.072 +
        Math.sin(n * 0.8 + i) * 0.38 +
        (pit ? 19 : 0) +
        (n === 1 ? 6 : 0) +
        (s.compound === "SOFT" ? -0.65 : s.compound === "HARD" ? 0.5 : 0);
      elapsed += duration;
      laps.push({
        driver_number: d.driver_number,
        race_lap: n,
        lap_duration: Math.round(duration * 1000) / 1000,
        compound: s.compound,
        tyre_age: age,
        date_end: new Date(
          Date.parse(race.date_start) + elapsed * 1000,
        ).toISOString(),
        is_pit_lap: pit,
        exclusions: pit ? ["pit_lap"] : n === 1 ? ["standing_start"] : [],
        eligible: !pit && n > 1,
      });
    }
  });
  const snapshots = Array.from({ length: race.total_laps }, (_, index) => {
    const n = index + 1;
    return {
      lap: n,
      date: null,
      weather: {
        track_temperature: 34.2 + Math.sin(n / 15) * 2,
        air_temperature: 24.6,
        rainfall: 0,
      },
      drivers: drivers.map((d, i) => {
        const lap = laps.find(
          (l) => l.driver_number === d.driver_number && l.race_lap === n,
        )!;
        return {
          ...d,
          position: i + 1,
          gap_to_leader:
            i === 0 ? 0 : Number((i * 1.4 + n * i * 0.075).toFixed(3)),
          completed_lap: n,
          lap_duration: lap.lap_duration,
          compound: lap.compound,
          tyre_age: lap.tyre_age,
          stint: stints.find(
            (s) =>
              s.driver_number === d.driver_number &&
              n >= s.lap_start! &&
              n <= s.lap_end!,
          )!,
          exclusions: lap.exclusions,
        };
      }),
    };
  });
  return { race, drivers, laps, stints, snapshots };
}
