import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Download, Play, Printer, Square } from 'lucide-react';
import {
  PRODUCT_CATEGORIES,
  type IndustrialEvent,
  type IndustrialRule,
  type InspectionRecord,
  type LocalizationShape,
} from '../types/prometheus';
import { api } from '../services/api';
import { InspectionVisualTrio } from '../components/InspectionVisualTrio';

interface IndustrialPageProps {
  defaultShape: LocalizationShape;
  onInspectionCompleted: (record: InspectionRecord) => void;
}

export function IndustrialPage({ defaultShape, onInspectionCompleted }: IndustrialPageProps) {
  const [status, setStatus] = useState<{
    lineStatus: string;
    adapters: Array<{ id: string; name: string; protocol: string; status: string; note: string }>;
    metrics: {
      totalInspected: number;
      normalCount: number;
      defectCount: number;
      defectRatePct: number;
      avgTimeMs: number;
    };
    rules: IndustrialRule[];
    events: IndustrialEvent[];
  } | null>(null);

  const [category, setCategory] = useState<string>('Metal Nut');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [continuousMode, setContinuousMode] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [latestCapture, setLatestCapture] = useState<InspectionRecord | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [ruleCategory, setRuleCategory] = useState('Metal Nut');
  const [ruleMaxScore, setRuleMaxScore] = useState('0.48');
  const [ruleMessage, setRuleMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);

  const loadStatus = async () => {
    try {
      const data = await api.getIndustrialStatus();
      setStatus(data);
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    loadStatus();
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startWebcam = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Browser camera API is unavailable in this context.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? err.message
          : 'Unable to access webcam. Verify browser camera permissions.'
      );
    }
  };

  const stopWebcam = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setContinuousMode(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  };

  const captureAndInspectFrame = async () => {
    if (!videoRef.current || capturing) return;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    setCapturing(true);
    setCameraError(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const res = await api.inspectWebcamFrame(dataUrl, category);
      setLatestCapture(res.inspection);
      onInspectionCompleted(res.inspection);
      await loadStatus();
    } catch (err) {
      setCameraError(err instanceof Error ? err.message : 'Frame inspection failed.');
    } finally {
      setCapturing(false);
    }
  };

  const toggleContinuous = () => {
    if (continuousMode) {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
      setContinuousMode(false);
    } else {
      setContinuousMode(true);
      captureAndInspectFrame();
      intervalRef.current = window.setInterval(() => {
        captureAndInspectFrame();
      }, 6000);
    }
  };

  const handleSaveRule = async () => {
    setRuleMessage(null);
    try {
      await api.saveIndustrialRule({
        name: ruleName.trim() || `${ruleCategory} Line Gate`,
        category: ruleCategory,
        maxAnomalyScore: Number(ruleMaxScore),
        autoRejectSeverity: 'MEDIUM',
        consecutiveDefectAlertCount: 3,
        enabled: true,
      });
      setRuleName('');
      setRuleMessage('Production-line inspection rule saved.');
      await loadStatus();
    } catch (err) {
      setRuleMessage(err instanceof Error ? err.message : 'Failed to save rule.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Live Production KPI Bar */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Camera Acquisition</p>
          <p className={`mt-1.5 font-display text-sm font-semibold ${cameraActive ? 'text-emerald-400' : 'text-slate-200'}`}>
            {cameraActive ? 'Webcam Active' : 'Standby'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Total Inspected</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-white">
            {status?.metrics.totalInspected ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Normal Units</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-emerald-400">
            {status?.metrics.normalCount ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Defective Units</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-rose-400">
            {status?.metrics.defectCount ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
          <p className="text-xs text-slate-400">Line Defect Rate</p>
          <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-amber-400">
            {status?.metrics.defectRatePct ?? 0}%
          </p>
        </div>
      </div>

      {/* Webcam Acquisition Prototype & Hardware Adapter Readiness */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Optical Camera Prototype (Webcam Live Feed)
              </h2>
              <p className="text-xs text-slate-400">
                Capture live frames from a connected USB or built-in camera and inspect through /api/inspect
              </p>
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Camera inspection category"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white"
            >
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="relative mt-4 aspect-video overflow-hidden rounded-lg border border-slate-800 bg-[#080d18]">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`h-full w-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
            />
            {!cameraActive && (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <Camera className="h-8 w-8 text-slate-600" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium text-slate-300">Camera feed is inactive</p>
                <p className="mt-1 text-xs text-slate-500">
                  Start the browser webcam prototype to test real-time single-frame or 6-second continuous inspection.
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!cameraActive ? (
              <button
                type="button"
                onClick={startWebcam}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                Start Webcam Prototype
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={capturing}
                  onClick={captureAndInspectFrame}
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {capturing ? 'Inspecting Frame...' : 'Capture & Inspect Frame'}
                </button>
                <button
                  type="button"
                  onClick={toggleContinuous}
                  className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-semibold ${
                    continuousMode
                      ? 'border-amber-600 bg-amber-950/50 text-amber-200'
                      : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-sky-500'
                  }`}
                >
                  {continuousMode ? (
                    <>
                      <Square className="h-3 w-3" aria-hidden="true" />
                      Stop Continuous (6s)
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" aria-hidden="true" />
                      Start Continuous (6s)
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={stopWebcam}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:text-rose-300"
                >
                  <CameraOff className="h-3.5 w-3.5" aria-hidden="true" />
                  Stop Camera
                </button>
              </>
            )}
          </div>

          {cameraError && (
            <div role="alert" className="mt-3 rounded-lg border border-amber-900/70 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              {cameraError}
            </div>
          )}
        </div>

        {/* Camera & Hardware Adapter Interface Status */}
        <div className="space-y-4 rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-white">
              Industrial Camera Adapters
            </h2>
            <div className="flex items-center gap-2">
              <a
                href="/api/reports/export/csv"
                download
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-sky-500"
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                CSV Report
              </a>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-sky-500"
              >
                <Printer className="h-3 w-3" aria-hidden="true" />
                PDF
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {(status?.adapters ?? []).map((adapter) => (
              <div key={adapter.id} className="rounded-lg border border-slate-800 bg-[#0b1222] p-3.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{adapter.name}</span>
                  <span
                    className={`font-mono text-[11px] ${
                      adapter.status === 'SUPPORTED' ? 'text-emerald-400' : 'text-slate-500'
                    }`}
                  >
                    {adapter.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="mt-1 text-slate-400">{adapter.protocol}</p>
                <p className="mt-1 text-[11px] text-slate-500">{adapter.note}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Latest Live Capture Result */}
      {latestCapture && (
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6">
          <h3 className="mb-4 font-display text-sm font-semibold text-white">
            Latest Live Frame Inspection — {latestCapture.prediction} ({latestCapture.anomalyScore.toFixed(3)})
          </h3>
          <InspectionVisualTrio inspection={latestCapture} defaultShape={defaultShape} compact />
        </div>
      )}

      {/* Production Rules & Event Log */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-5">
          <h3 className="font-display text-sm font-semibold text-white">Configurable Line Inspection Rules</h3>
          <div className="mt-3 space-y-2">
            {(status?.rules ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#0b1222] px-3 py-2.5 text-xs">
                <div>
                  <p className="font-medium text-white">{r.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {r.category} · Reject ≥ {r.maxAnomalyScore} · Auto-alert after {r.consecutiveDefectAlertCount} defects
                  </p>
                </div>
                <span className="font-mono text-[11px] text-emerald-400">{r.enabled ? 'ACTIVE' : 'PAUSED'}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-2.5 border-t border-slate-800 pt-4 text-xs">
            <p className="font-medium text-slate-300">Add Production-Line Rule</p>
            <input
              type="text"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="Rule name (e.g. Shift A Bolt Tolerance)"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={ruleCategory}
                onChange={(e) => setRuleCategory(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
              >
                {PRODUCT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.02"
                min="0.1"
                max="0.95"
                value={ruleMaxScore}
                onChange={(e) => setRuleMaxScore(e.target.value)}
                aria-label="Rule anomaly score threshold"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-white"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveRule}
              className="w-full rounded-lg bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-500"
            >
              Save Line Rule
            </button>
            {ruleMessage && <p className="text-sky-300">{ruleMessage}</p>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 lg:col-span-7">
          <h3 className="font-display text-sm font-semibold text-white">Inspection Event Log</h3>
          <div className="mt-3 max-h-80 overflow-y-auto divide-y divide-slate-800/70 text-xs">
            {(status?.events ?? []).length === 0 ? (
              <p className="py-6 text-slate-500">No inspection line events logged yet.</p>
            ) : (
              status!.events.map((ev) => (
                <div key={ev.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div>
                    <p className="font-medium text-slate-200">{ev.message}</p>
                    <p className="text-[11px] text-slate-500">
                      {ev.lineName} · {ev.cameraAdapter} · {ev.eventType}
                    </p>
                  </div>
                  <span className="font-mono text-[11px] tabular-nums text-slate-500 whitespace-nowrap">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
