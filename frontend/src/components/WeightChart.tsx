import React, { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type WeightPoint = {
  id?: string;
  measuredAt: string | Date;
  weightG: number | string;
};

const GRAMS_PER_UNIT: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

function convertFromGrams(value: number, unit: string): number {
  return value / (GRAMS_PER_UNIT[unit] ?? 1);
}

function formatTick(value: unknown): string {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short" }).format(date);
}

export function WeightChart({ points, unit = "g" }: { points: WeightPoint[]; unit?: string }) {
  const data = useMemo(() => points
    .map((point) => ({
      measuredAt: new Date(point.measuredAt),
      label: formatTick(point.measuredAt),
      weight: convertFromGrams(Number(point.weightG), unit),
    }))
    .filter((point) => !Number.isNaN(point.measuredAt.getTime()) && Number.isFinite(point.weight) && point.weight > 0)
    .sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime()), [points, unit]);

  if (data.length < 2) {
    return <section className="weight-chart-panel" aria-label="Andamento del peso">
      <h3>Andamento del peso</h3>
      <p className="muted">{data.length === 0 ? "Non ci sono pesate da rappresentare." : "Registra almeno un'altra pesata per visualizzare l'andamento."}</p>
    </section>;
  }

  return <section className="weight-chart-panel" aria-label="Andamento del peso">
    <div className="panel-heading"><div><h3>Andamento del peso</h3><p className="muted">Valori registrati, dal più vecchio al più recente. Unità: {unit}.</p></div></div>
    <div className="weight-chart">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 12, right: 18, bottom: 8, left: 2 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line, #d8e3de)" />
          <XAxis dataKey="measuredAt" tickFormatter={formatTick} minTickGap={24} tick={{ fontSize: 12 }} />
          <YAxis width={64} tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
          <Tooltip
            labelFormatter={(value) => new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)))}
            formatter={(value) => [`${Number(value).toLocaleString("it-IT", { maximumFractionDigits: 2 })} ${unit}`, "Peso"]}
          />
          <Line type="monotone" dataKey="weight" name="Peso" stroke="#2d6a59" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </section>;
}
