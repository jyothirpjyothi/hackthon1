import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../services/api';
import type { InspectionRecord } from '../types/prometheus';

export function DriftMonitorPage() {
  const [statusData, setStatusData] = useState<{
    overallStatus: string;
    latestInspectionId: string | null;
    latestDrift: InspectionRecord['drift'] | null;
    categoryDrift: Array<{
      category: string;
      latestDriftScore: number;
      latestStatus: string;
      alertCount: number;
    }>;
    recentSeries: Array<{
      index: number;
      id: string;
      category: string;
      driftScore: number;
      status: string;
      time: string;
    }>;
  } | null>(null);

  const [historyEvents, setHistoryEvents] = useState<
    Array<{
      id: string;
      inspectionId: string | null;
      category: string;
      status: string;
      driftScore: number;
      causes: string[];
      recommendedActions: string[];
      createdAt: string;
    }>
  >([]);

  useEffect(() => {
    Promise.all([api.getDriftStatus(), api.getDriftHistory()])
      .then(([s, h]) => {
        setStatusData(s);
        setHistoryEvents(h.events);
      })
      .catch(() => {});
  }, []);

  const latestDrift = statusData?.latestDrift ?? null;

  return (
    <div className="space-y-6">
      {/* Important Domain Notice */}
      <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-sky-400">Statistical Input Monitoring</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-white">
              Current Distribution Status:{' '}
              <span
                className={
                  statusData?.overallStatus === 'SIGNIFICANT_SHIFT'
                    ? 'text-rose-400'
                    : statusData?.overallStatus === 'POSSIBLE_SHIFT'
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                }
              >
                {(statusData?.overallStatus ?? 'STABLE').replace('_', ' ')}
              </span>
            </h2>
            <p className="mt-1 max-w-3xl text-xs text-slate-400">
              Distribution shift detection compares incoming luminance, contrast, color channel balance, edge sharpness, texture variance, and aspect ratio against validated category baselines. A shift warning indicates changed imaging or production conditions and does not automatically mean a product is defective or that the model has failed.
            </p>
          </div>
          {latestDrift && (
            <div className="text-right">
              <p className="text-xs text-slate-400">Latest Drift Magnitude</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white">
                {latestDrift.driftScore.toFixed(2)}σ
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-6">
          <h3 className="font-display text-sm font-semibold text-white">
            Reference vs Current Feature Statistics
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Normalized optical descriptors from the latest evaluated specimen
          </p>
          {latestDrift && latestDrift.featureDeltas.length > 0 ? (
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latestDrift.featureDeltas}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="feature" stroke="#64748b" fontSize={10} interval={0} angle={-18} textAnchor="end" height={54} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: '#0b1120', borderColor: '#1e293b', fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="reference" name="Baseline Reference" fill="#38bdf8" />
                  <Bar dataKey="current" name="Current Input" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="mt-4 flex h-56 items-center justify-center rounded-lg border border-slate-800 bg-[#0b1222] text-xs text-slate-500">
              Inspect a specimen belonging to a trained category to compare feature distributions.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-6">
          <h3 className="font-display text-sm font-semibold text-white">Drift Magnitude Trend (σ)</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            RMS Z-score distance over the 20 most recent inspections
          </p>
          {statusData && statusData.recentSeries.length > 0 ? (
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={statusData.recentSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: '#0b1120', borderColor: '#1e293b', fontSize: '12px' }} />
                  <ReferenceLine y={2.2} stroke="#f59e0b" strokeDasharray="4 4" />
                  <ReferenceLine y={3.8} stroke="#ef4444" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="driftScore" name="Drift Score (σ)" stroke="#38bdf8" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="mt-4 flex h-56 items-center justify-center rounded-lg border border-slate-800 bg-[#0b1222] text-xs text-slate-500">
              No inspection drift series recorded yet.
            </div>
          )}
        </div>
      </div>

      {/* Category Drift & Recommended Corrective Actions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-5">
          <h3 className="font-display text-sm font-semibold text-white">Category-Wise Drift Baseline</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 font-medium">Category</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Latest σ</th>
                  <th className="py-2 text-right font-medium">Alerts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {(statusData?.categoryDrift ?? []).map((c) => (
                  <tr key={c.category}>
                    <td className="py-2.5 font-medium text-white">{c.category}</td>
                    <td
                      className={`py-2.5 font-medium ${
                        c.latestStatus === 'SIGNIFICANT_SHIFT'
                          ? 'text-rose-400'
                          : c.latestStatus === 'POSSIBLE_SHIFT'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      {c.latestStatus.replace('_', ' ')}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-slate-200">
                      {c.latestDriftScore.toFixed(2)}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-slate-400">{c.alertCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-7">
          <h3 className="font-display text-sm font-semibold text-white">Historical Drift Alerts &amp; Corrective Actions</h3>
          {historyEvents.length === 0 ? (
            <p className="mt-4 text-xs text-slate-400">
              No distribution shift warnings logged. When lighting, contrast, camera framing, or material color shifts exceed configured thresholds, alerts and engineering guidance appear here.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {historyEvents.slice(0, 8).map((ev) => (
                <div key={ev.id} className="rounded-lg border border-slate-800 bg-[#0b1222] p-3.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-white">
                      {ev.category} ·{' '}
                      <span className={ev.status === 'SIGNIFICANT_SHIFT' ? 'text-rose-400' : 'text-amber-400'}>
                        {ev.status.replace('_', ' ')} ({ev.driftScore.toFixed(2)}σ)
                      </span>
                    </span>
                    <span className="font-mono text-slate-500">{new Date(ev.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1.5 text-slate-300">{ev.causes.join(' ')}</p>
                  <p className="mt-1 text-sky-400">Recommended: {ev.recommendedActions[0]}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
