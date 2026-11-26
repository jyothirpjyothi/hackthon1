import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download } from 'lucide-react';
import type { AnalyticsOverview } from '../types/prometheus';

interface AnalyticsPageProps {
  overview: AnalyticsOverview | null;
  onGoToStudio: () => void;
}

export function AnalyticsPage({ overview, onGoToStudio }: AnalyticsPageProps) {
  if (!overview || overview.totalInspected === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-10 text-center">
        <h2 className="font-display text-lg font-semibold text-white">Analytics Awaiting Inspection Data</h2>
        <p className="mt-2 text-sm text-slate-400">
          Inspect product specimens to populate real-time throughput, category defect distribution, confidence bands, and false-positive trends.
        </p>
        <button
          type="button"
          onClick={onGoToStudio}
          className="mt-5 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-500"
        >
          Go to AI Inspection Studio
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            Quality Analytics &amp; Real-Time Performance
          </h2>
          <p className="text-xs text-slate-400">
            Measured strictly from backend SQLite execution timings and verified inspection records
          </p>
        </div>
        <a
          href="/api/reports/export/csv"
          download
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:border-sky-500"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Export Full QC CSV
        </a>
      </div>

      {/* Real-Time Performance Telemetry Row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Average Time', value: `${overview.performance.avgTimeMs} ms` },
          { label: 'Fastest Inspection', value: `${overview.performance.fastestTimeMs} ms` },
          { label: 'Slowest Inspection', value: `${overview.performance.slowestTimeMs} ms` },
          { label: 'Total Processed', value: String(overview.performance.totalProcessed) },
          { label: 'Throughput', value: `${overview.performance.imagesPerMinute} /min` },
          { label: 'Batch Jobs', value: String(overview.performance.batchCount) },
        ].map((metric) => (
          <div key={metric.label} className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
            <p className="text-xs text-slate-400">{metric.label}</p>
            <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-white">{metric.value}</p>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5">
          <h3 className="font-display text-sm font-semibold text-white">Category-Wise Defect Distribution</h3>
          <p className="mt-0.5 text-xs text-slate-400">Normal, defect, and review volume per manufacturing line</p>
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overview.categoryStats}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="category" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0b1120', borderColor: '#1e293b', fontSize: '12px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="normal" name="Normal" fill="#10b981" />
                <Bar dataKey="defect" name="Defect" fill="#ef4444" />
                <Bar dataKey="review" name="Review" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5">
          <h3 className="font-display text-sm font-semibold text-white">Confidence Band Distribution</h3>
          <p className="mt-0.5 text-xs text-slate-400">Prediction certainty tiers across inspected specimens</p>
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overview.confidenceDistribution} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis type="number" stroke="#64748b" fontSize={11} allowDecimals={false} />
                <YAxis type="category" dataKey="band" width={140} stroke="#94a3b8" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0b1120', borderColor: '#1e293b', fontSize: '12px' }}
                />
                <Bar dataKey="count" name="Inspections" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* False-Positive & Trend Area Chart */}
      <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="font-display text-sm font-semibold text-white">
              Inspection Volume &amp; False-Positive Trend
            </h3>
            <p className="text-xs text-slate-400">
              Confirmed defects: {overview.confirmedDefectCount} · Marked false positives: {overview.falsePositiveCount} ({overview.falsePositiveRatePct}%) · Human reviewed: {overview.humanReviewedCount}
            </p>
          </div>
        </div>
        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={overview.trends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="bucket" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0b1120', borderColor: '#1e293b', fontSize: '12px' }}
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Area type="monotone" dataKey="total" name="Total Inspected" stroke="#38bdf8" fill="#0284c7" fillOpacity={0.2} />
              <Area type="monotone" dataKey="defect" name="Anomalies" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} />
              <Area type="monotone" dataKey="falsePositives" name="False Positives" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.25} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
