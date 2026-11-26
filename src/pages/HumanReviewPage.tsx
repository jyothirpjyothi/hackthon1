import { useEffect, useState } from 'react';
import { Check, Flag, X } from 'lucide-react';
import type { AnalyticsOverview, InspectionRecord, LocalizationShape } from '../types/prometheus';
import { api } from '../services/api';
import { InspectionVisualTrio } from '../components/InspectionVisualTrio';

interface HumanReviewPageProps {
  overview: AnalyticsOverview | null;
  defaultShape: LocalizationShape;
  onDecisionSaved: () => Promise<void>;
}

export function HumanReviewPage({
  overview,
  defaultShape,
  onDecisionSaved,
}: HumanReviewPageProps) {
  const [queue, setQueue] = useState<InspectionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = async () => {
    try {
      const res = await api.getPendingReviews();
      setQueue(res.pending);
      if (res.pending.length > 0 && !res.pending.some((p) => p.id === selectedId)) {
        setSelectedId(res.pending[0].id);
      } else if (res.pending.length === 0) {
        setSelectedId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review queue.');
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const active = queue.find((item) => item.id === selectedId) ?? queue[0] ?? null;

  const submitDecision = async (
    decision: 'APPROVED_NORMAL' | 'CONFIRMED_DEFECT' | 'FALSE_POSITIVE'
  ) => {
    if (!active) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await api.submitReviewDecision(active.id, decision, notes.trim());
      setMessage(`Saved human verification decision (${decision.replace('_', ' ')}) for ${active.id}.`);
      setNotes('');
      await Promise.all([loadQueue(), onDecisionSaved()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save decision.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* False-Positive KPI Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Pending Review</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-amber-400">
            {queue.length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Confirmed Defects</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-rose-400">
            {overview?.confirmedDefectCount ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Marked False Positives</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-sky-400">
            {overview?.falsePositiveCount ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Total Human Reviewed</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-white">
            {overview?.humanReviewedCount ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">False-Positive Rate</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-200">
            {overview?.falsePositiveRatePct ?? 0}%
          </p>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/40 px-4 py-3 text-xs text-emerald-200">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-rose-900/70 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {!active ? (
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-10 text-center">
          <h2 className="font-display text-lg font-semibold text-white">Review Queue Clear</h2>
          <p className="mt-2 text-sm text-slate-400">
            All flagged anomalies and uncertain inspections have been verified by a quality reviewer. Human review outcomes are stored for audit and false-positive tracking without triggering automatic unverified model retraining.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Pending List */}
          <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4 lg:col-span-3">
            <h2 className="font-display text-sm font-semibold text-white">
              Flagged Queue ({queue.length})
            </h2>
            <div className="mt-3 space-y-2 max-h-[560px] overflow-y-auto pr-1">
              {queue.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full rounded-lg border p-3 text-left text-xs transition-colors ${
                    active.id === item.id
                      ? 'border-sky-500 bg-sky-950/30'
                      : 'border-slate-800 bg-[#0b1222] hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-white">{item.id}</span>
                    <span
                      className={
                        item.prediction === 'DEFECT' ? 'text-rose-400 font-semibold' : 'text-amber-400 font-semibold'
                      }
                    >
                      {item.prediction}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-slate-300">{item.category} · {item.defectType}</p>
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-slate-500">
                    Score {item.anomalyScore.toFixed(3)} · {item.severity}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Active Inspection Verification Desk */}
          <div className="space-y-5 rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-9">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h2 className="font-display text-lg font-semibold text-white">
                  Verify {active.id} · {active.category}
                </h2>
                <p className="text-xs text-slate-400">
                  {active.filename} · Score {active.anomalyScore.toFixed(3)} · {active.calibration.confidenceBand}
                </p>
              </div>
              <span className="text-xs text-slate-500">
                Decisions are logged to SQLite audit history (no automatic unverified retraining)
              </span>
            </div>

            <InspectionVisualTrio inspection={active} defaultShape={defaultShape} compact />

            <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-4 text-xs text-slate-300">
              <p className="font-semibold text-sky-400">AI Detection Explanation</p>
              <p className="mt-1 leading-relaxed">{active.explanation}</p>
            </div>

            <div className="space-y-3 border-t border-slate-800 pt-4">
              <label className="block text-xs">
                <span className="font-medium text-slate-300">Quality Engineer Inspection Notes</span>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Document defect verification details, lighting glare, or disposition notes..."
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => submitDecision('CONFIRMED_DEFECT')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Reject — Confirm Defect
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => submitDecision('FALSE_POSITIVE')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-600/70 bg-amber-950/50 px-4 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-600 hover:text-white disabled:opacity-50"
                >
                  <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                  Mark False Positive
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => submitDecision('APPROVED_NORMAL')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/70 bg-emerald-950/50 px-4 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-600 hover:text-white disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Approve Normal Product
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
