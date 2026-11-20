"use client";
import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { color, lapTime, type Replay } from "@/lib/types";
export default function PaceChart({
  data,
  drivers,
  lap,
  onLap,
  range,
  showFlagged,
}: {
  data: Replay;
  drivers: number[];
  lap: number;
  onLap: (n: number) => void;
  range: [number, number];
  showFlagged: boolean;
}) {
  const selected = data.drivers.filter((d) =>
    drivers.includes(d.driver_number),
  );
  const chart = useMemo(
    () =>
      Array.from({ length: data.race.total_laps }, (_, i) => {
        const row: Record<string, number | null> = { lap: i + 1 };
        selected.forEach((d) => {
          const found = data.laps.find(
            (l) => l.driver_number === d.driver_number && l.race_lap === i + 1,
          );
          row[d.name_acronym] =
            found && (!found.exclusions.length || showFlagged)
              ? found.lap_duration
              : null;
        });
        return row;
      }).filter((row) => row.lap! >= range[0] && row.lap! <= range[1]),
    [data, selected.map((d) => d.driver_number).join(","), range, showFlagged],
  );
  return (
    <div className="chart-area" aria-label="Lap time evolution chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chart}
          margin={{ left: 8, right: 18, top: 20, bottom: 8 }}
          onClick={(state) => {
            if (state?.activeLabel) onLap(Number(state.activeLabel));
          }}
        >
          <CartesianGrid
            vertical={false}
            stroke="#26303f"
            strokeDasharray="3 5"
          />
          <XAxis
            type="number"
            dataKey="lap"
            domain={range}
            tick={{ fill: "#7e8da2", fontSize: 10, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            tickCount={10}
            tickFormatter={(value) => `L${value}`}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fill: "#7e8da2", fontSize: 10, fontFamily: "monospace" }}
            axisLine={false}
            tickLine={false}
            width={65}
            tickFormatter={(value) => lapTime(Number(value)).slice(0, -1)}
          />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="chart-tooltip">
                  <strong>LAP {label}</strong>
                  {payload.map((p) => (
                    <div key={String(p.dataKey)}>
                      <i style={{ background: p.color }} />
                      {p.dataKey}
                      <b>{lapTime(Number(p.value))}</b>
                    </div>
                  ))}
                  <small>
                    {data.race.is_fixture
                      ? "SYNTHETIC FIXTURE"
                      : "OBSERVED · OPENF1"}
                  </small>
                </div>
              ) : null
            }
          />
          <ReferenceLine
            x={lap}
            stroke="#e85a68"
            strokeDasharray="4 4"
            label={{
              value: `L${lap}`,
              fill: "#e85a68",
              position: "insideTopRight",
              fontSize: 10,
            }}
          />
          {selected.map((d) => (
            <Line
              key={d.driver_number}
              dataKey={d.name_acronym}
              stroke={color(d)}
              strokeWidth={1.8}
              dot={false}
              activeDot={{ r: 4, stroke: "#0d131e", strokeWidth: 2 }}
              isAnimationActive={false}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
