'use client';

import { Bar, BarChart, CartesianGrid, Legend, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency } from '../../lib/currency';
import type { CategoryTotal, DailyTotal } from '../../types/report';
import { formatReportDate } from './report-format';

/**
 * Series colours.
 *
 * Income keeps the app's own terracotta; expenses take a cool counterpoint, so
 * the pair reads as opposite (money in vs money out) rather than as two
 * arbitrary categories. Both were checked against the card surface they render
 * on — lightness band, chroma floor, colour-blind separation (worst adjacent
 * ΔE 14.8 light / 14.5 dark, against a target of 8), normal-vision separation
 * and 3:1 contrast all pass in both modes.
 *
 * DARK holds the steps chosen for the dark surface — not a flip of the light
 * ones, which fall outside the dark lightness band. Nothing applies the `.dark`
 * class today, so LIGHT is what renders; wire DARK in alongside a theme toggle.
 */
const LIGHT = { income: '#cb633a', expenses: '#0f8fa3' };
export const DARK = { income: '#d0734e', expenses: '#22a0b3' };

const AXIS = '#898781';
const GRID = '#e1e0d9';

const axisProps = {
  stroke: GRID,
  tick: { fill: AXIS, fontSize: 11 },
  tickLine: false,
} as const;

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function EmptyPlot({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-secondary/30 px-3 py-6 text-center text-xs text-muted-foreground">
      {message}
    </p>
  );
}

const tooltipStyle = {
  contentStyle: {
    borderRadius: 10,
    border: '1px solid #e1e0d9',
    background: '#faf8f5',
    fontSize: 12,
    boxShadow: '0 10px 30px rgb(0 0 0 / .10)',
  },
  labelStyle: { color: '#52514e', fontSize: 11, marginBottom: 2 },
} as const;

/**
 * Where the money came from, or went. One series, so length carries the
 * magnitude and a single hue is enough — shading each bar differently would
 * encode the same thing twice. Sorted so the ranking is the shape of the chart.
 */
export function CategoryBars({
  title,
  note,
  data,
  tone,
  emptyMessage,
}: {
  title: string;
  note?: string;
  data: CategoryTotal[];
  tone: 'income' | 'expenses';
  emptyMessage: string;
}) {
  const sorted = [...data].sort((a, b) => b.total - a.total);
  const colour = LIGHT[tone];

  return (
    <ChartCard title={title} note={note}>
      {sorted.length === 0 ? <EmptyPlot message={emptyMessage} /> : (
        <ResponsiveContainer width="100%" height={Math.max(140, sorted.length * 46)}>
          <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" {...axisProps} tickFormatter={(value) => formatCurrency(Number(value ?? 0), { maximumFractionDigits: 0 })} />
            <YAxis type="category" dataKey="name" width={110} {...axisProps} axisLine={false} />
            <Tooltip
              {...tooltipStyle}
              cursor={{ fill: 'rgba(11,11,11,0.04)' }}
              formatter={(value) => [formatCurrency(Number(value ?? 0)), title]}
            />
            {/* 4px rounded data-end, anchored to the baseline. */}
            <Bar dataKey="total" fill={colour} radius={[0, 4, 4, 0]} barSize={18} isAnimationActive={false}>
              <LabelList
                dataKey="total"
                position="right"
                formatter={(value) => formatCurrency(Number(value ?? 0))}
                style={{ fill: '#52514e', fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

/**
 * Income against expenses across the window. Both are money, so they share one
 * axis — a second scale would let any two bars be made to look equal.
 * Values are left to the tooltip rather than printed on every bar.
 */
export function IncomeExpenseTrend({ data, note }: { data: DailyTotal[]; note?: string }) {
  return (
    <ChartCard title="Income and expenses over the period" note={note}>
      {data.length === 0 ? <EmptyPlot message="Nothing was recorded in this window." /> : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barGap={2}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={(value) => formatReportDate(String(value))} />
            <YAxis {...axisProps} axisLine={false} tickFormatter={(value) => formatCurrency(Number(value ?? 0), { maximumFractionDigits: 0 })} />
            <Tooltip
              {...tooltipStyle}
              cursor={{ fill: 'rgba(11,11,11,0.04)' }}
              labelFormatter={(value) => formatReportDate(String(value))}
              formatter={(value, name) => [formatCurrency(Number(value ?? 0)), String(name ?? '')]}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: AXIS }} iconType="circle" iconSize={8} />
            <Bar dataKey="income" name="Income" fill={LIGHT.income} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
            <Bar dataKey="expenses" name="Expenses" fill={LIGHT.expenses} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
