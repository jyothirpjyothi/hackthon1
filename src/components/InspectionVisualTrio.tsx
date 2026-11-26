import { useState } from 'react';
import { Circle, Eye, EyeOff, Square } from 'lucide-react';
import type { InspectionRecord, LocalizationShape } from '../types/prometheus';

interface InspectionVisualTrioProps {
  inspection: InspectionRecord;
  defaultShape?: LocalizationShape;
  showMaskPanel?: boolean;
  compact?: boolean;
}

export function InspectionVisualTrio({
  inspection,
  defaultShape = 'rectangle',
  showMaskPanel = false,
  compact = false,
}: InspectionVisualTrioProps) {
  const [markerShape, setMarkerShape] = useState<LocalizationShape>(defaultShape);
  const [heatmapOpacity, setHeatmapOpacity] = useState<number>(48);
  const [showMarkers, setShowMarkers] = useState<boolean>(true);
  const [showHeatmapOverlay, setShowHeatmapOverlay] = useState<boolean>(true);

  const hasDefects = inspection.regions.length > 0 && inspection.prediction !== 'PASS';

  return (
    <div className="space-y-4">
      {/* Interactive Localization Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">Defect Marker</span>
          <div
            className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-900/90 p-0.5"
            role="group"
            aria-label="Defect marker shape"
          >
            <button
              type="button"
              onClick={() => setMarkerShape('rectangle')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                markerShape === 'rectangle'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
              Rectangle
            </button>
            <button
              type="button"
              onClick={() => setMarkerShape('circle')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                markerShape === 'circle'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Circle className="h-3.5 w-3.5" aria-hidden="true" />
              Circle
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => setShowHeatmapOverlay((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            {showHeatmapOverlay ? (
              <Eye className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            )}
            {showHeatmapOverlay ? 'Heatmap Blend On' : 'Heatmap Blend Off'}
          </button>

          <button
            type="button"
            onClick={() => setShowMarkers((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            {showMarkers ? 'Annotations Visible' : 'Annotations Hidden'}
          </button>

          {showHeatmapOverlay && (
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span>Overlay</span>
              <input
                type="range"
                min={0}
                max={85}
                value={heatmapOpacity}
                onChange={(e) => setHeatmapOpacity(Number(e.target.value))}
                aria-label="Overlay heatmap opacity"
                className="h-1.5 w-20 accent-sky-500 cursor-pointer"
              />
              <span className="font-mono tabular-nums text-slate-300 w-8">{heatmapOpacity}%</span>
            </label>
          )}
        </div>
      </div>

      {/* 3-Panel (or 4-Panel) Visual Grid matching industrial AOI workstation layout */}
      <div
        className={`grid gap-4 ${
          showMaskPanel ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4' : 'grid-cols-1 md:grid-cols-3'
        }`}
      >
        {/* 1. Original Specimen */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium text-slate-200">1. Original Specimen</span>
            <span className="font-mono tabular-nums text-slate-500 whitespace-nowrap shrink-0">
              {inspection.featureStats.width}×{inspection.featureStats.height}
            </span>
          </div>
          <div className="relative aspect-square overflow-hidden rounded-lg border border-slate-800 bg-[#0b1120]">
            <img
              src={inspection.assets.originalUrl}
              alt={`Original ${inspection.category} specimen`}
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain"
            />
          </div>
        </div>

        {/* 2. Pixel Anomaly Heatmap (Jet Colormap like reference image 2) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium text-slate-200">2. Pixel Anomaly Heatmap</span>
            <span className="font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
              Peak {(inspection.maxIntensity * 100).toFixed(0)}%
            </span>
          </div>
          <div className="relative aspect-square overflow-hidden rounded-lg border border-slate-800 bg-[#0b1f48]">
            <img
              src={inspection.assets.heatmapUrl}
              alt={`Pixel anomaly heatmap for ${inspection.category}`}
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain"
            />
          </div>
        </div>

        {/* 3. Defect Localization Overlay (Rectangle or Circle markers + optional Heatmap Blend) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-medium text-slate-200">3. Defect Localization Overlay</span>
            <span className="font-mono tabular-nums text-sky-400 whitespace-nowrap shrink-0">
              {hasDefects
                ? `${inspection.regions.length} · ${markerShape}`
                : 'Normal'}
            </span>
          </div>
          <div
            className="relative aspect-square overflow-hidden rounded-lg border border-slate-800 bg-[#0b1120]"
            data-testid="localization-overlay"
            data-marker-shape={markerShape}
          >
            <img
              src={inspection.assets.originalUrl}
              alt={`Localized overlay for ${inspection.category}`}
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain"
            />
            {showHeatmapOverlay && (
              <img
                src={inspection.assets.heatmapUrl}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                style={{ opacity: heatmapOpacity / 100 }}
                className="pointer-events-none absolute inset-0 h-full w-full object-contain mix-blend-screen"
              />
            )}

            {/* Crisp SVG Defect Annotations (Rectangle or Circle) */}
            {showMarkers && hasDefects && (
              <svg
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full"
                aria-label="Detected defect bounding overlays"
              >
                {inspection.regions.map((region, idx) => {
                  const x = region.bbox.x * 1000;
                  const y = region.bbox.y * 1000;
                  const w = Math.max(24, region.bbox.width * 1000);
                  const h = Math.max(24, region.bbox.height * 1000);
                  const cx = region.circle.cx * 1000;
                  const cy = region.circle.cy * 1000;
                  const r = Math.max(32, region.circle.r * 1000);
                  const strokeColor = region.intensity >= 0.75 ? '#38bdf8' : '#f59e0b';
                  const innerAccent = '#ef4444';
                  const labelText = `#${idx + 1} ${region.defectType.slice(0, 18)}`;
                  const labelX = Math.max(12, Math.min(720, markerShape === 'circle' ? cx - r : x));
                  const labelY = Math.max(34, (markerShape === 'circle' ? cy - r : y) - 10);

                  return (
                    <g key={region.id}>
                      {markerShape === 'rectangle' ? (
                        <>
                          <rect
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            fill="rgba(239, 68, 68, 0.14)"
                            stroke={strokeColor}
                            strokeWidth="7"
                            rx="6"
                          />
                          <rect
                            x={x + 5}
                            y={y + 5}
                            width={Math.max(10, w - 10)}
                            height={Math.max(10, h - 10)}
                            fill="none"
                            stroke={innerAccent}
                            strokeWidth="3"
                            strokeDasharray="12 8"
                            rx="4"
                          />
                        </>
                      ) : (
                        <>
                          <circle
                            cx={cx}
                            cy={cy}
                            r={r}
                            fill="rgba(239, 68, 68, 0.14)"
                            stroke={strokeColor}
                            strokeWidth="7"
                          />
                          <circle
                            cx={cx}
                            cy={cy}
                            r={Math.max(14, r - 10)}
                            fill="none"
                            stroke={innerAccent}
                            strokeWidth="3"
                            strokeDasharray="12 8"
                          />
                          {/* Precision crosshair center ticks */}
                          <line x1={cx - 14} y1={cy} x2={cx + 14} y2={cy} stroke={strokeColor} strokeWidth="3" />
                          <line x1={cx} y1={cy - 14} x2={cx} y2={cy + 14} stroke={strokeColor} strokeWidth="3" />
                        </>
                      )}

                      <rect
                        x={labelX}
                        y={labelY - 26}
                        width={Math.min(270, labelText.length * 13 + 22)}
                        height="30"
                        rx="4"
                        fill="rgba(8, 13, 24, 0.88)"
                        stroke={strokeColor}
                        strokeWidth="2"
                      />
                      <text
                        x={labelX + 10}
                        y={labelY - 6}
                        fill="#f8fafc"
                        fontSize="20"
                        fontFamily="IBM Plex Mono, monospace"
                        fontWeight="600"
                      >
                        {labelText}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </div>

        {/* 4. Optional Thresholded Binary Defect Mask */}
        {showMaskPanel && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-200">4. Thresholded Defect Mask</span>
              <span className="font-mono tabular-nums text-slate-400">
                {inspection.affectedAreaPct}% area
              </span>
            </div>
            <div className="relative aspect-square overflow-hidden rounded-lg border border-slate-800 bg-[#0b1120]">
              <img
                src={inspection.assets.maskUrl}
                alt={`Binary defect segmentation mask for ${inspection.category}`}
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            </div>
          </div>
        )}
      </div>

      {/* Anomaly Intensity Colorbar Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-400">
        <div className="flex items-center gap-3">
          <span>Anomaly Intensity Scale</span>
          <div className="flex items-center gap-2">
            <span className="font-mono tabular-nums text-slate-500">0.0</span>
            <div
              className="h-2.5 w-44 rounded-sm border border-slate-800"
              style={{
                background:
                  'linear-gradient(90deg, #0b1f48 0%, #0284c7 28%, #22d3ee 48%, #facc15 72%, #ef4444 100%)',
              }}
              aria-label="Jet anomaly intensity gradient from low blue to high red"
            />
            <span className="font-mono tabular-nums text-slate-500">1.0</span>
          </div>
        </div>
        <div className="text-slate-500">
          Normal Pattern · Low Deviation · Elevated Region · Critical Defect Core
        </div>
      </div>
    </div>
  );
}
