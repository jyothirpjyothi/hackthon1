import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { InspectionRecord, LocalizationShape } from '../types/prometheus';
import { InspectionVisualTrio } from '../components/InspectionVisualTrio';

interface LocalizationPageProps {
  inspections: InspectionRecord[];
  selectedId: string | null;
  onSelectId: (id: string) => void;
  defaultShape: LocalizationShape;
  onGoToStudio: () => void;
}

export function LocalizationPage({
  inspections,
  selectedId,
  onSelectId,
  defaultShape,
  onGoToStudio,
}: LocalizationPageProps) {
  const [splitPercent, setSplitPercent] = useState<number>(50);
  const active = inspections.find((i) => i.id === selectedId) ?? inspections[0] ?? null;

  if (!active) {
    return (
      <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-10 text-center">
        <SlidersHorizontal className="mx-auto h-7 w-7 text-sky-400" aria-hidden="true" />
        <h2 className="mt-4 font-display text-lg font-semibold text-white">
          No Localized Inspections Available
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Run an inspection in the AI Inspection Studio to examine pixel heatmaps, binary masks, and rectangle or circle overlays here.
        </p>
        <button
          type="button"
          onClick={onGoToStudio}
          className="mt-5 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-500"
        >
          Open AI Inspection Studio
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Specimen Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-[#0f172a] p-4">
        <div>
          <h2 className="font-display text-base font-semibold text-white">
            Interactive Defect Localization Workbench
          </h2>
          <p className="text-xs text-slate-400">
            Compare original specimen, Jet anomaly heatmap, toggleable Rectangle/Circle overlay, and thresholded segmentation mask
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-300">
          <span>Inspection</span>
          <select
            value={active.id}
            onChange={(e) => onSelectId(e.target.value)}
            aria-label="Select inspection record"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-mono text-white focus:border-sky-500 focus:outline-none"
          >
            {inspections.map((ins) => (
              <option key={ins.id} value={ins.id}>
                {ins.id} · {ins.category} · {ins.prediction} ({ins.anomalyScore.toFixed(2)})
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 4-Panel Full Visual Matrix */}
      <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6">
        <InspectionVisualTrio inspection={active} defaultShape={defaultShape} showMaskPanel />
      </div>

      {/* Interactive Split-Comparison Slider & Region Coordinates Table */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                Split-Curtain Comparison (Original ↔ Pixel Heatmap)
              </h3>
              <p className="text-xs text-slate-400">Drag slider to align defect features pixel-for-pixel</p>
            </div>
            <span className="font-mono text-xs tabular-nums text-sky-400">{splitPercent}%</span>
          </div>

          <div className="relative mt-4 aspect-square max-h-[380px] mx-auto overflow-hidden rounded-lg border border-slate-800 bg-[#0b1120]">
            <img
              src={active.assets.heatmapUrl}
              alt="Heatmap comparison base"
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain"
            />
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
            >
              <img
                src={active.assets.originalUrl}
                alt="Original comparison overlay"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            </div>
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-sky-400"
              style={{ left: `${splitPercent}%` }}
            />
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span className="text-xs text-slate-400">Original</span>
            <input
              type="range"
              min={0}
              max={100}
              value={splitPercent}
              onChange={(e) => setSplitPercent(Number(e.target.value))}
              aria-label="Original versus heatmap comparison split"
              className="h-1.5 flex-1 accent-sky-500 cursor-pointer"
            />
            <span className="text-xs text-slate-400">Heatmap</span>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-6">
          <h3 className="font-display text-sm font-semibold text-white">
            Anomaly Region Spatial Coordinates
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Normalized bounding rectangle (x, y, w, h) and circle geometry (cx, cy, r)
          </p>

          {active.regions.length === 0 ? (
            <div className="mt-6 rounded-lg border border-slate-800 bg-[#0b1222] p-6 text-center text-xs text-slate-400">
              No anomaly regions detected above the configured operating threshold.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 font-medium">Region</th>
                    <th className="py-2 font-medium">Rectangle (x, y, w, h)</th>
                    <th className="py-2 font-medium">Circle (cx, cy, r)</th>
                    <th className="py-2 text-right font-medium">Area</th>
                    <th className="py-2 text-right font-medium">Peak</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {active.regions.map((r, i) => (
                    <tr key={r.id}>
                      <td className="py-2.5">
                        <p className="font-medium text-white">#{i + 1} {r.label}</p>
                        <p className="text-[11px] text-slate-500">{r.defectType} · {r.source}</p>
                      </td>
                      <td className="py-2.5 font-mono text-[11px] tabular-nums text-slate-300">
                        {r.bbox.x.toFixed(2)}, {r.bbox.y.toFixed(2)}, {r.bbox.width.toFixed(2)}, {r.bbox.height.toFixed(2)}
                      </td>
                      <td className="py-2.5 font-mono text-[11px] tabular-nums text-slate-300">
                        {r.circle.cx.toFixed(2)}, {r.circle.cy.toFixed(2)}, {r.circle.r.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-slate-200">{r.areaPct}%</td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-sky-400">
                        {(r.intensity * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-800 pt-4 text-xs">
            <div>
              <p className="text-slate-400">Total Affected Area</p>
              <p className="mt-1 font-mono text-base font-semibold tabular-nums text-white">
                {active.affectedAreaPct}%
              </p>
            </div>
            <div>
              <p className="text-slate-400">Peak Intensity</p>
              <p className="mt-1 font-mono text-base font-semibold tabular-nums text-sky-400">
                {(active.maxIntensity * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-slate-400">Estimated Severity</p>
              <p className="mt-1 font-display text-base font-semibold text-white">{active.severity}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
