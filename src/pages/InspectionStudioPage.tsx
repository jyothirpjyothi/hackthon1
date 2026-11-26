import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Layers,
  Loader2,
  Printer,
  Upload,
} from 'lucide-react';
import {
  PRODUCT_CATEGORIES,
  type InspectionRecord,
  type LocalizationShape,
  type SampleSpecimen,
} from '../types/prometheus';
import { api } from '../services/api';
import { InspectionVisualTrio } from '../components/InspectionVisualTrio';

interface InspectionStudioPageProps {
  defaultShape: LocalizationShape;
  onInspectionCompleted: (record: InspectionRecord) => void;
  onOpenLocalization: (id: string) => void;
}

export function InspectionStudioPage({
  defaultShape,
  onInspectionCompleted,
  onOpenLocalization,
}: InspectionStudioPageProps) {
  const [category, setCategory] = useState<string>('Metal Nut');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [skipDuplicate, setSkipDuplicate] = useState<boolean>(false);
  const [samples, setSamples] = useState<SampleSpecimen[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InspectionRecord | null>(null);
  const [batchResults, setBatchResults] = useState<InspectionRecord[]>([]);
  const [batchSummary, setBatchSummary] = useState<{
    batchId: string;
    processedCount: number;
    skippedDuplicates: number;
    totalBatchMs: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api.getSamples().then((res) => setSamples(res.samples)).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedFiles.length === 0) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(selectedFiles[0]);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFiles]);

  const handleFilesSelected = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter((f) =>
      ['image/jpeg', 'image/jpg', 'image/png'].includes(f.type) ||
      /\.(jpe?g|png)$/i.test(f.name)
    );
    if (arr.length === 0) {
      setError('Only JPG, JPEG, and PNG images are supported.');
      return;
    }
    setError(null);
    setSelectedFiles(arr.slice(0, 12));
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  const runInspection = async () => {
    if (selectedFiles.length === 0) {
      setError('Upload one or more specimen images, or choose a calibration specimen below.');
      return;
    }
    setError(null);
    setIsProcessing(true);
    setBatchSummary(null);
    setBatchResults([]);

    try {
      if (selectedFiles.length === 1) {
        setProgressMsg('Extracting multi-scale patch descriptors, querying PatchCore memory bank & Gemini Vision...');
        const res = await api.inspectFile(selectedFiles[0], category, skipDuplicate);
        setResult(res.inspection);
        onInspectionCompleted(res.inspection);
      } else {
        setProgressMsg(`Running parallel batch inspection on ${selectedFiles.length} specimens...`);
        const res = await api.inspectBatch(selectedFiles, category);
        setBatchResults(res.inspections);
        setBatchSummary({
          batchId: res.batchId,
          processedCount: res.processedCount,
          skippedDuplicates: res.skippedDuplicates,
          totalBatchMs: res.totalBatchMs,
        });
        if (res.inspections.length > 0) {
          setResult(res.inspections[0]);
          onInspectionCompleted(res.inspections[0]);
        }
        if (res.errors.length > 0) {
          setError(`${res.errors.length} file(s) rejected: ${res.errors[0].filename} (${res.errors[0].error})`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Inspection request failed.');
    } finally {
      setIsProcessing(false);
      setProgressMsg('');
    }
  };

  const runBundledSpecimen = async (sample: SampleSpecimen) => {
    setCategory(sample.category);
    setSelectedFiles([]);
    setError(null);
    setBatchSummary(null);
    setBatchResults([]);
    setIsProcessing(true);
    setProgressMsg(`Inspecting ${sample.name} via PatchCore memory bank + Gemini Vision...`);

    try {
      const res = await api.inspectSample(sample.id, sample.category);
      setResult(res.inspection);
      onInspectionCompleted(res.inspection);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Specimen inspection failed.');
    } finally {
      setIsProcessing(false);
      setProgressMsg('');
    }
  };

  const handlePrintReport = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Input & Configuration Workspace */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Upload & Batch Queue Panel */}
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Specimen Image Ingestion
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Single or batch upload (up to 12 JPG/PNG files, max 10 MB each)
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <span>Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Product category"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white focus:border-sky-500 focus:outline-none"
              >
                {PRODUCT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors ${
              isDragging
                ? 'border-sky-400 bg-sky-950/30'
                : 'border-slate-700 bg-[#0b1222] hover:border-slate-600'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              multiple
              onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
              className="sr-only"
              id="studio-file-upload"
            />
            {previewUrl ? (
              <div className="flex w-full flex-col items-center gap-3 sm:flex-row sm:text-left">
                <img
                  src={previewUrl}
                  alt="Selected specimen preview"
                  className="h-24 w-24 rounded-lg border border-slate-700 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {selectedFiles.length === 1
                      ? selectedFiles[0].name
                      : `${selectedFiles.length} specimens queued for parallel batch processing`}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {selectedFiles.map((f) => f.name).slice(0, 3).join(' · ')}
                    {selectedFiles.length > 3 ? ` · +${selectedFiles.length - 3} more` : ''}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-md border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300 hover:text-white"
                    >
                      Change Files
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedFiles([])}
                      className="rounded-md border border-slate-800 px-3 py-1 text-xs text-slate-400 hover:text-rose-300"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <Upload className="h-7 w-7 text-sky-400" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-slate-200">
                  Drag and drop product images here, or browse local files
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Supports JPG, JPEG, PNG · Magic-byte verified · Automatic foreground isolation
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:border-sky-500 transition-colors"
                >
                  Select Images
                </button>
              </>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={skipDuplicate}
                onChange={(e) => setSkipDuplicate(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 accent-sky-500"
              />
              <span>Skip duplicate SHA-256 hash if recently inspected</span>
            </label>

            <button
              type="button"
              onClick={runInspection}
              disabled={isProcessing || selectedFiles.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Inspecting...
                </>
              ) : selectedFiles.length > 1 ? (
                `Run Batch Inspection (${selectedFiles.length})`
              ) : (
                'Start AI Inspection'
              )}
            </button>
          </div>

          {isProcessing && progressMsg && (
            <div className="mt-4 rounded-lg border border-sky-900/60 bg-sky-950/30 px-4 py-3 text-xs text-sky-200">
              {progressMsg}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-rose-900/70 bg-rose-950/40 px-4 py-3 text-xs text-rose-200"
            >
              {error}
            </div>
          )}
        </div>

        {/* Bench Specimens for Immediate Real-Pipeline Testing */}
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-5">
          <h2 className="font-display text-base font-semibold text-white">
            Optical Test Bench Specimens
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Run real PatchCore + Gemini Vision inference on high-resolution industrial macro specimens
          </p>

          <div className="mt-4 space-y-3">
            {samples.map((sample) => (
              <div
                key={sample.id}
                className="flex items-center gap-3.5 rounded-lg border border-slate-800 bg-[#0b1222] p-3"
              >
                <img
                  src={sample.imageUrl}
                  alt={sample.name}
                  referrerPolicy="no-referrer"
                  className="h-14 w-14 rounded-md border border-slate-700 object-cover shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">{sample.name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {sample.category} · Expected {sample.expectedCondition}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => runBundledSpecimen(sample)}
                  className="rounded-md border border-sky-700/70 bg-sky-950/50 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-600 hover:text-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  Inspect
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Batch Summary Selector */}
      {batchSummary && batchResults.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                Batch {batchSummary.batchId} Completed
              </h3>
              <p className="text-xs text-slate-400">
                {batchSummary.processedCount} processed · {batchSummary.skippedDuplicates} duplicates skipped ·{' '}
                <span className="font-mono tabular-nums">{batchSummary.totalBatchMs} ms</span> total
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {batchResults.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setResult(item)}
                className={`rounded-lg border p-2 text-left transition-colors ${
                  result?.id === item.id
                    ? 'border-sky-500 bg-sky-950/30'
                    : 'border-slate-800 bg-[#0b1222] hover:border-slate-600'
                }`}
              >
                <img
                  src={item.assets.originalUrl}
                  alt={item.filename}
                  className="aspect-square w-full rounded object-cover"
                />
                <p className="mt-1.5 truncate text-[11px] font-medium text-slate-200">{item.filename}</p>
                <p
                  className={`font-mono text-[11px] font-semibold ${
                    item.prediction === 'DEFECT'
                      ? 'text-rose-400'
                      : item.prediction === 'REVIEW'
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                  }`}
                >
                  {item.prediction} · {item.anomalyScore.toFixed(2)}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Flagship Inspection Result & 3-Panel Visual Localization */}
      {result && (
        <div className="space-y-6 rounded-xl border border-slate-800 bg-[#0f172a] p-6" data-testid="inspection-result">
          {/* Result Header & Recommendation */}
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <span className="font-mono text-slate-200">{result.id}</span>
                <span aria-hidden="true">·</span>
                <span>{result.category}</span>
                <span aria-hidden="true">·</span>
                <span>{result.filename}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{result.processingTimeMs} ms</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {result.prediction === 'PASS' ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" aria-hidden="true" />
                ) : (
                  <AlertTriangle
                    className={`h-6 w-6 ${result.prediction === 'DEFECT' ? 'text-rose-400' : 'text-amber-400'}`}
                    aria-hidden="true"
                  />
                )}
                <h2 className="font-display text-2xl font-bold text-white">
                  {result.prediction === 'PASS'
                    ? 'PASS — No Significant Anomaly Detected'
                    : result.prediction === 'DEFECT'
                      ? `DEFECT — ${result.defectType}`
                      : `REVIEW — Uncertain or Shifted Conditions`}
                </h2>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenLocalization(result.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-sky-500 hover:text-white transition-colors"
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                Deep Localization
              </button>
              <a
                href={`/api/reports/${encodeURIComponent(result.id)}?format=csv`}
                download
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 transition-colors"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                CSV
              </a>
              <a
                href={`/api/reports/${encodeURIComponent(result.id)}`}
                download
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 transition-colors"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                JSON
              </a>
              <button
                type="button"
                onClick={handlePrintReport}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-slate-500 transition-colors"
              >
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                PDF / Print
              </button>
            </div>
          </div>

          {/* 3-Panel Visual Localization (Original, Pixel Anomaly Heatmap, Rectangle/Circle Overlay) */}
          <InspectionVisualTrio inspection={result} defaultShape={defaultShape} />

          {/* Quantitative Breakdown Row */}
          <div className="grid grid-cols-1 gap-4 border-t border-slate-800 pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-4">
              <p className="text-xs text-slate-400">Overall Anomaly Score</p>
              <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-white">
                {result.anomalyScore.toFixed(3)}
              </p>
              <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-400">
                PatchCore {result.patchCoreScore.toFixed(3)}
                {result.geminiScore !== null ? ` · Vision ${result.geminiScore.toFixed(3)}` : ' · PatchCore Only'}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-4">
              <p className="text-xs text-slate-400">Estimated Severity</p>
              <p
                className={`mt-1.5 font-display text-2xl font-bold ${
                  result.severity === 'HIGH'
                    ? 'text-rose-400'
                    : result.severity === 'MEDIUM'
                      ? 'text-amber-400'
                      : result.severity === 'LOW'
                        ? 'text-sky-400'
                        : 'text-emerald-400'
                }`}
              >
                {result.severity}
              </p>
              <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-400">
                Affected area {result.affectedAreaPct}% · Peak {(result.maxIntensity * 100).toFixed(0)}%
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-4">
              <p className="text-xs text-slate-400">Confidence &amp; Calibration</p>
              <p className="mt-1.5 font-display text-lg font-semibold text-white">
                {result.calibration.confidenceBand}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">
                {result.calibration.calibrated && result.calibration.calibratedProbability !== null
                  ? `Calibrated prob: ${(result.calibration.calibratedProbability * 100).toFixed(1)}% · Uncertainty ${result.calibration.uncertainty}`
                  : `Uncalibrated score · Uncertainty ${result.calibration.uncertainty}`}
              </p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-4">
              <p className="text-xs text-slate-400">Distribution Shift Status</p>
              <p
                className={`mt-1.5 font-display text-lg font-semibold ${
                  result.drift.status === 'SIGNIFICANT_SHIFT'
                    ? 'text-rose-400'
                    : result.drift.status === 'POSSIBLE_SHIFT'
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                }`}
              >
                {result.drift.status.replace('_', ' ')}
              </p>
              <p className="mt-1 font-mono text-[11px] tabular-nums text-slate-400">
                {result.drift.referenceAvailable
                  ? `Drift magnitude ${result.drift.driftScore}σ`
                  : 'Baseline reference not yet trained'}
              </p>
            </div>
          </div>

          {/* Explainability & Notices */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-4 lg:col-span-8">
              <h3 className="text-xs font-semibold text-sky-400">Explainable Inspection Rationale</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-200">{result.explanation}</p>
              {result.geminiMeta.error && (
                <p className="mt-2 text-xs text-amber-300">{result.geminiMeta.error}</p>
              )}
              <p className="mt-3 text-[11px] text-slate-500">{result.severityDisclaimer}</p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-4 lg:col-span-4">
              <h3 className="text-xs font-semibold text-slate-300">Localized Defect Regions</h3>
              {result.regions.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">
                  No abnormal regions exceeded localization threshold.
                </p>
              ) : (
                <ul className="mt-2 space-y-2 text-xs">
                  {result.regions.map((reg, i) => (
                    <li
                      key={reg.id}
                      className="flex items-center justify-between border-b border-slate-800/80 pb-1.5 last:border-0"
                    >
                      <span className="text-slate-200">
                        #{i + 1} {reg.label}
                      </span>
                      <span className="font-mono tabular-nums text-sky-400">
                        {reg.areaPct}% · {(reg.intensity * 100).toFixed(0)}%
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
