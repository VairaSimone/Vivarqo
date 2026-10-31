import React, { useMemo } from "react";
import { getIntlLocale } from "../i18n";

export type WeightPoint = {
  id?: string;
  measuredAt?: string | Date;
  weightG?: number | string;
  [key: string]: unknown;
};

type ChartPoint = {
  date: Date;
  weight: number;
};

const GRAMS_PER_UNIT: Record<string, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

function formatWeight(value: number, unit: string): string {
  return value.toLocaleString(getIntlLocale(), { maximumFractionDigits: 2 }) + " " + unit;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat(getIntlLocale(), { day: "2-digit", month: "short" }).format(value);
}

export function WeightChart({ points, unit = "g" }: { points: WeightPoint[]; unit?: "g" | "kg" | "oz" | "lb" }) {
  const data = useMemo<ChartPoint[]>(() => points
    .map((point) => ({ date: new Date(point.measuredAt ?? ""), weight: Number(point.weightG) / (GRAMS_PER_UNIT[unit] ?? 1) }))
    .filter((point) => !Number.isNaN(point.date.getTime()) && Number.isFinite(point.weight) && point.weight > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime()), [points, unit]);

  return (
    <section className="panel weight-chart-panel" aria-label="Andamento del peso">
      <div className="panel-heading">
        <div>
          <h3>Andamento del peso</h3>
          <p className="subheading">Storico delle pesate registrate · unità {unit}</p>
        </div>
      </div>
      {data.length < 2 ? (
        <p className="muted">{data.length === 0 ? "Non ci sono pesate da rappresentare." : "Registra almeno un'altra pesata per visualizzare l'andamento."}</p>
      ) : (
        <div style={{ width: "100%", minWidth: 0 }}>
          <svg
            viewBox="0 0 720 250"
            role="img"
            aria-label="Grafico dell'andamento del peso nel tempo"
            style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }}
          >
            <title>Andamento del peso</title>
            {(() => {
              const left = 62, right = 18, top = 14, bottom = 38;
              const width = 720 - left - right, height = 250 - top - bottom;
              const minValue = Math.min(...data.map((point) => point.weight));
              const maxValue = Math.max(...data.map((point) => point.weight));
              const spread = Math.max(maxValue - minValue, Math.max(maxValue * 0.08, 1));
              const lower = Math.max(0, minValue - spread * 0.12);
              const upper = maxValue + spread * 0.12;
              const x = (index: number) => left + (index / (data.length - 1)) * width;
              const y = (value: number) => top + height - ((value - lower) / (upper - lower)) * height;
              const pointsText = data.map((point, index) => `${x(index)},${y(point.weight)}`).join(" ");
              return (
                <>
                  {[0, 1, 2, 3].map((tick) => {
                    const value = lower + ((upper - lower) * tick) / 3;
                    const position = y(value);
                    return (
                      <g key={tick}>
                        <line x1={left} x2={720 - right} y1={position} y2={position} stroke="var(--line, #d8e3de)" strokeDasharray="4 4" />
                        <text x={left - 8} y={position + 4} textAnchor="end" fill="currentColor" fontSize="11">
                          {value.toLocaleString(getIntlLocale(), { maximumFractionDigits: 2 })}
                        </text>
                      </g>
                    );
                  })}
                  <polyline points={pointsText} fill="none" stroke="var(--accent, #2d6a59)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                  {data.map((point, index) => (
                    <circle key={point.date.toISOString() + ":" + index} cx={x(index)} cy={y(point.weight)} r="4" fill="var(--accent, #2d6a59)">
                      <title>{formatDate(point.date)} · {formatWeight(point.weight, unit)}</title>
                    </circle>
                  ))}
                  <text x={left} y={242} textAnchor="start" fill="currentColor" fontSize="11">{formatDate(data[0].date)}</text>
                  <text x={720 - right} y={242} textAnchor="end" fill="currentColor" fontSize="11">{formatDate(data[data.length - 1].date)}</text>
                </>
              );
            })()}
          </svg>
        </div>
      )}
    </section>
  );
}
