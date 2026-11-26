import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { SystemSettings } from '../types/prometheus';
import { api } from '../services/api';

interface SettingsPageProps {
  settings: SystemSettings;
  onSettingsUpdated: (next: SystemSettings) => void;
}

export function SettingsPage({ settings, onSettingsUpdated }: SettingsPageProps) {
  const [form, setForm] = useState<SystemSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedMsg(null);
    setError(null);
    try {
      const res = await api.saveSettings(form);
      onSettingsUpdated(res.settings);
      setSavedMsg('Validated and saved configuration to SQLite.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">
            Inspection &amp; Model Configuration
          </h2>
          <p className="text-xs text-slate-400">
            All thresholds are strictly validated server-side before saving
          </p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {savedMsg && (
        <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/40 px-4 py-3 text-xs text-emerald-200">
          {savedMsg}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-rose-900/70 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Detection & Severity Thresholds */}
        <div className="space-y-4 rounded-xl border border-slate-800 bg-[#0f172a] p-6 text-xs">
          <h3 className="font-display text-sm font-semibold text-white">
            Anomaly &amp; Severity Thresholds
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-slate-300">Anomaly Defect Threshold (0.10–0.95)</span>
              <input
                type="number"
                step="0.01"
                value={form.anomalyThreshold}
                onChange={(e) => setForm({ ...form, anomalyThreshold: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white"
              />
            </label>
            <label className="block">
              <span className="text-slate-300">Review Lower Bound (&lt; Anomaly)</span>
              <input
                type="number"
                step="0.01"
                value={form.reviewLowerThreshold}
                onChange={(e) => setForm({ ...form, reviewLowerThreshold: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white"
              />
            </label>
            <label className="block">
              <span className="text-slate-300">Low Severity Area (%)</span>
              <input
                type="number"
                step="0.5"
                value={form.severityLowAreaPct}
                onChange={(e) => setForm({ ...form, severityLowAreaPct: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white"
              />
            </label>
            <label className="block">
              <span className="text-slate-300">Medium Severity Area (%)</span>
              <input
                type="number"
                step="0.5"
                value={form.severityMediumAreaPct}
                onChange={(e) => setForm({ ...form, severityMediumAreaPct: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white"
              />
            </label>
            <label className="block">
              <span className="text-slate-300">High Severity Area (%)</span>
              <input
                type="number"
                step="0.5"
                value={form.severityHighAreaPct}
                onChange={(e) => setForm({ ...form, severityHighAreaPct: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white"
              />
            </label>
            <label className="block">
              <span className="text-slate-300">High Severity Peak Intensity</span>
              <input
                type="number"
                step="0.02"
                value={form.severityHighIntensity}
                onChange={(e) => setForm({ ...form, severityHighIntensity: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white"
              />
            </label>
          </div>
        </div>

        {/* Preprocessing, Localization, Drift & Calibration */}
        <div className="space-y-4 rounded-xl border border-slate-800 bg-[#0f172a] p-6 text-xs">
          <h3 className="font-display text-sm font-semibold text-white">
            Model, Calibration &amp; Drift Controls
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-slate-300">Active Architecture</span>
              <select
                value={form.activeModelArchitecture}
                onChange={(e) =>
                  setForm({
                    ...form,
                    activeModelArchitecture: e.target.value as SystemSettings['activeModelArchitecture'],
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
              >
                <option value="PatchCore + Gemini Vision Hybrid">PatchCore + Gemini Vision Hybrid</option>
                <option value="PatchCore Multi-Scale">PatchCore Multi-Scale Only</option>
                <option value="EfficientAD Lightweight">EfficientAD Lightweight</option>
              </select>
            </label>

            <label className="block">
              <span className="text-slate-300">Default Defect Marker Shape</span>
              <select
                value={form.defaultMarkerShape}
                onChange={(e) =>
                  setForm({
                    ...form,
                    defaultMarkerShape: e.target.value as SystemSettings['defaultMarkerShape'],
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
              >
                <option value="rectangle">Rectangle Bounding Box</option>
                <option value="circle">Circle Localization Ring</option>
              </select>
            </label>

            <label className="block">
              <span className="text-slate-300">Preprocessing Resolution</span>
              <select
                value={form.preprocessingSize}
                onChange={(e) =>
                  setForm({ ...form, preprocessingSize: Number(e.target.value) as 256 | 320 | 384 })
                }
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white"
              >
                <option value={256}>256 × 256 (Fastest)</option>
                <option value={320}>320 × 320 (Balanced)</option>
                <option value={384}>384 × 384 (High Detail)</option>
              </select>
            </label>

            <label className="block">
              <span className="text-slate-300">Calibration Method</span>
              <select
                value={form.calibrationMethod}
                onChange={(e) =>
                  setForm({
                    ...form,
                    calibrationMethod: e.target.value as SystemSettings['calibrationMethod'],
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
              >
                <option value="platt_scaling">Platt Scaling (Logistic)</option>
                <option value="temperature_scaling">Temperature Scaling</option>
              </select>
            </label>

            <label className="block">
              <span className="text-slate-300">Drift Warning Threshold (σ)</span>
              <input
                type="number"
                step="0.1"
                value={form.driftWarningThreshold}
                onChange={(e) => setForm({ ...form, driftWarningThreshold: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white"
              />
            </label>

            <label className="block">
              <span className="text-slate-300">Drift Critical Threshold (σ)</span>
              <input
                type="number"
                step="0.1"
                value={form.driftCriticalThreshold}
                onChange={(e) => setForm({ ...form, driftCriticalThreshold: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white"
              />
            </label>
          </div>

          <div className="space-y-2 border-t border-slate-800 pt-3">
            <label className="flex items-center gap-2.5 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.foregroundSuppression}
                onChange={(e) => setForm({ ...form, foregroundSuppression: e.target.checked })}
                className="rounded border-slate-700 bg-slate-900 accent-sky-500"
              />
              <span>Enable Foreground Suppression (prevents uniform background border bleed)</span>
            </label>
            <label className="flex items-center gap-2.5 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.useGeminiVision}
                onChange={(e) => setForm({ ...form, useGeminiVision: e.target.checked })}
                className="rounded border-slate-700 bg-slate-900 accent-sky-500"
              />
              <span>Enable Server-Side Gemini Vision Hybrid Fusion (when configured)</span>
            </label>
          </div>
        </div>
      </div>
    </form>
  );
}
