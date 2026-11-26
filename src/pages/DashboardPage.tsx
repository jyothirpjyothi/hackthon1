import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowRight, ScanSearch } from 'lucide-react';
import type { AnalyticsOverview, InspectionRecord } from '../types/prometheus';

interface DashboardPageProps {
  overview: AnalyticsOverview | null;
  recentInspections: InspectionRecord[];
  loading: boolean;
  onNavigate: (tab: string, inspectionId?: string) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  HIGH: '#ef4444',
  MEDIUM: '#f59e0b',
  LOW: '#38bdf8',
  NONE: '#10b981',
};

export function DashboardPage({
  overview,
  recentInspections,
  loading,
  onNavigate,
}: DashboardPageProps) {
  if (loading && !overview) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-slate-800 bg-[#0f172a]" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-xl border border-slate-800 bg-[#0f172a]" />
      </div>
    );
  }

  const total = overview?.totalInspected ?? 0;

  if (total === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-slate-700 bg-slate-900">
          <ScanSearch className="h-6 w-6 text-sky-400" aria-hidden="true" />
        </div>
        <h2 className="mt-4 font-display text-xl font-semibold text-white">
          No Inspection Records Yet
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-slate-400">
          All dashboard metrics, defect rates, severity charts, and drift alerts are computed exclusively from actual SQLite inspection records—zero synthetic production numbers are displayed.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('studio')}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 transition-colors"
          >
            Run First AI Inspection
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('dataset')}
            className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 hover:border-slate-500 transition-colors"
          >
            Manage Datasets &amp; Memory Bank
          </button>
        </div>
      </div>
    );
  }

  const severityData = [
    { name: 'High', key: 'HIGH', value: overview!.highSeverityCount },
    { name: 'Medium', key: 'MEDIUM', value: overview!.mediumSeverityCount },
    { name: 'Low', key: 'LOW', value: overview!.lowSeverityCount },
    { name: 'Normal', key: 'NONE', value: overview!.normalCount },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      {/* Primary KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {[
          { label: 'Total Inspected', value: String(overview!.totalInspected), sub: 'SQLite verified' },
          { label: 'Normal Products', value: String(overview!.normalCount), sub: 'PASS outcome', tone: 'text-emerald-400' },
          { label: 'Anomalies Detected', value: String(overview!.defectCount), sub: `${overview!.defectDetectionRatePct}% rate`, tone: 'text-rose-400' },
          { label: 'High Severity', value: String(overview!.highSeverityCount), sub: 'Immediate triage', tone: 'text-rose-400' },
          { label: 'False Positive Rate', value: `${overview!.falsePositiveRatePct}%`, sub: `${overview!.falsePositiveCount} marked FP`, tone: 'text-amber-400' },
          { label: 'Drift Alerts', value: String(overview!.driftAlertCount), sub: 'Input shift events', tone: 'text-sky-400' },
          { label: 'Avg Inference', value: `${overview!.performance.avgTimeMs} ms`, sub: `${overview!.performance.imagesPerMinute}/min`, tone: 'text-slate-100' },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
            <p className="text-xs font-medium text-slate-400">{kpi.label}</p>
            <p className={`mt-2 font-mono text-2xl font-semibold tabular-nums ${kpi.tone ?? 'text-white'}`}>
              {kpi.value}
            </p>
            <p className="mt-1 text-xs text-slate-500">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-7">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Inspection Activity &amp; Outcomes
              </h2>
              <p className="text-xs text-slate-400">Normal vs anomalous inspections over recent buckets</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="text-xs font-medium text-sky-400 hover:text-sky-300"
            >
              Full Analytics
            </button>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={overview!.trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="bucket" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0b1120',
                    borderColor: '#1e293b',
                    fontSize: '12px',
                    color: '#f8fafc',
                  }}
                />
                <Bar dataKey="normal" name="Normal (PASS)" stackId="a" fill="#10b981" maxBarSize={64} />
                <Bar dataKey="review" name="Needs Review" stackId="a" fill="#f59e0b" maxBarSize={64} />
                <Bar dataKey="defect" name="Defect" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={64} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-5">
          <div className="mb-4">
            <h2 className="font-display text-base font-semibold text-white">
              Severity Distribution
            </h2>
            <p className="text-xs text-slate-400">Estimated visual severity categories across inspected units</p>
          </div>
          <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={severityData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={84}
                    paddingAngle={2}
                  >
                    {severityData.map((entry) => (
                      <Cell key={entry.key} fill={SEVERITY_COLORS[entry.key]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0b1120',
                      borderColor: '#1e293b',
                      fontSize: '12px',
                      color: '#f8fafc',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2.5 text-xs">
              {severityData.map((item) => (
                <div key={item.key} className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <span className="font-medium text-slate-300">{item.name}</span>
                  <span className="font-mono tabular-nums text-white">{item.value}</span>
                </div>
              ))}
              <div className="pt-1 text-slate-500">
                Pending Human Review: <span className="font-mono tabular-nums text-amber-400">{overview!.pendingReviewCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Category Statistics & Recent Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-5">
          <h2 className="font-display text-base font-semibold text-white">Category Performance</h2>
          <p className="mt-0.5 text-xs text-slate-400">Defect rate and mean anomaly score by product line</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 font-medium">Category</th>
                  <th className="py-2 text-right font-medium">Units</th>
                  <th className="py-2 text-right font-medium">Defect %</th>
                  <th className="py-2 text-right font-medium">Avg Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {overview!.categoryStats.map((cat) => (
                  <tr key={cat.category} className="hover:bg-slate-800/30">
                    <td className="py-2.5 font-medium text-slate-200">{cat.category}</td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-slate-300">{cat.total}</td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-rose-400">{cat.defectRatePct}%</td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-sky-400">{cat.avgScore.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-7">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-white">Recent Inspection Activity</h2>
              <p className="mt-0.5 text-xs text-slate-400">Click any record to open pixel-level localization</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('history')}
              className="text-xs font-medium text-sky-400 hover:text-sky-300"
            >
              View All History
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 font-medium">Inspection ID</th>
                  <th className="py-2 font-medium">Category</th>
                  <th className="py-2 font-medium">Outcome</th>
                  <th className="py-2 font-medium">Severity</th>
                  <th className="py-2 text-right font-medium">Score</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {recentInspections.slice(0, 6).map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 font-mono text-slate-200">{item.id}</td>
                    <td className="py-2.5 text-slate-300">{item.category}</td>
                    <td
                      className={`py-2.5 font-semibold ${
                        item.prediction === 'DEFECT'
                          ? 'text-rose-400'
                          : item.prediction === 'REVIEW'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      {item.prediction}
                    </td>
                    <td className="py-2.5 text-slate-300">{item.severity}</td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-slate-200">
                      {item.anomalyScore.toFixed(3)}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => onNavigate('localization', item.id)}
                        className="text-sky-400 hover:text-sky-300 font-medium"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
