import { useMemo, useState } from 'react';
import { ArrowUpDown, Download, Eye, Search, Trash2 } from 'lucide-react';
import { PRODUCT_CATEGORIES, type InspectionRecord } from '../types/prometheus';
import { api } from '../services/api';

interface HistoryPageProps {
  inspections: InspectionRecord[];
  onRefresh: () => Promise<void>;
  onOpenLocalization: (id: string) => void;
}

export function HistoryPage({
  inspections,
  onRefresh,
  onOpenLocalization,
}: HistoryPageProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [predictionFilter, setPredictionFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'date' | 'score' | 'severity'>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sevWeight: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

    return inspections
      .filter((item) => {
        if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;
        if (predictionFilter !== 'ALL' && item.prediction !== predictionFilter) return false;
        if (severityFilter !== 'ALL' && item.severity !== severityFilter) return false;
        if (q) {
          const haystack = `${item.id} ${item.category} ${item.filename} ${item.defectType}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'date') {
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        } else if (sortBy === 'score') {
          cmp = a.anomalyScore - b.anomalyScore;
        } else {
          cmp = (sevWeight[a.severity] ?? 0) - (sevWeight[b.severity] ?? 0);
        }
        return sortAsc ? cmp : -cmp;
      });
  }, [inspections, search, categoryFilter, predictionFilter, severityFilter, sortBy, sortAsc]);

  const toggleSort = (col: 'date' | 'score' | 'severity') => {
    if (sortBy === col) setSortAsc((v) => !v);
    else {
      setSortBy(col);
      setSortAsc(false);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await api.deleteInspection(id);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete record.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-[#0f172a] p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search inspection ID, filename, or defect type..."
            aria-label="Search inspection history"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-3 text-xs text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by product category"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
          >
            <option value="ALL">All Categories</option>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={predictionFilter}
            onChange={(e) => setPredictionFilter(e.target.value)}
            aria-label="Filter by prediction outcome"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
          >
            <option value="ALL">All Predictions</option>
            <option value="PASS">PASS</option>
            <option value="DEFECT">DEFECT</option>
            <option value="REVIEW">REVIEW</option>
          </select>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            aria-label="Filter by severity"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
          >
            <option value="ALL">All Severities</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
            <option value="NONE">NONE</option>
          </select>

          <a
            href="/api/reports/export/csv"
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-medium text-slate-200 hover:border-sky-500 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export CSV
          </a>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-rose-900/70 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Inspection Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0f172a]">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No inspection records match your current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-[#0b1222] text-slate-400">
                  <th className="px-4 py-3 font-medium">Inspection ID</th>
                  <th className="px-4 py-3 font-medium">Category &amp; Specimen</th>
                  <th className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('date')}
                      className="inline-flex items-center gap-1 hover:text-white"
                    >
                      Timestamp
                      <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">Prediction</th>
                  <th className="px-4 py-3 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('severity')}
                      className="inline-flex items-center gap-1 hover:text-white"
                    >
                      Severity
                      <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('score')}
                      className="inline-flex items-center gap-1 hover:text-white"
                    >
                      Anomaly Score
                      <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium">Review Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono text-slate-200 whitespace-nowrap">{item.id}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-white">{item.category}</p>
                      <p className="max-w-[190px] truncate text-[11px] text-slate-500">
                        {item.filename} · {item.defectType}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td
                      className={`px-4 py-3 font-semibold ${
                        item.prediction === 'DEFECT'
                          ? 'text-rose-400'
                          : item.prediction === 'REVIEW'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                      }`}
                    >
                      {item.prediction}
                    </td>
                    <td className="px-4 py-3 text-slate-200">{item.severity}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-sky-400">
                      {item.anomalyScore.toFixed(3)}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{item.reviewStatus.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenLocalization(item.id)}
                          aria-label={`Inspect localization for ${item.id}`}
                          className="rounded p-1.5 text-sky-400 hover:bg-slate-800 hover:text-sky-300"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <a
                          href={`/api/reports/${encodeURIComponent(item.id)}?format=csv`}
                          download
                          aria-label={`Download CSV report for ${item.id}`}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.id)}
                          aria-label={`Delete inspection ${item.id}`}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
