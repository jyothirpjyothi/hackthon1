import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Cpu, Database, Loader2, Trash2, Upload } from 'lucide-react';
import {
  PRODUCT_CATEGORIES,
  type CategoryModelStatus,
  type DatasetImageRecord,
  type DatasetSplit,
} from '../types/prometheus';
import { api } from '../services/api';

interface DatasetModelPageProps {
  initialSection?: 'dataset' | 'model';
}

const SPLIT_LABELS: Record<DatasetSplit, string> = {
  train_normal: 'Normal Training (Memory Bank)',
  val_normal: 'Validation Normal (Held-Out)',
  val_defect: 'Validation Defective (Calibration)',
  test_defect: 'Test Defective (Evaluation Only)',
};

export function DatasetModelPage({ initialSection = 'dataset' }: DatasetModelPageProps) {
  const [section, setSection] = useState<'dataset' | 'model'>(initialSection);
  const [selectedCategory, setSelectedCategory] = useState<string>('Metal Nut');
  const [split, setSplit] = useState<DatasetSplit>('train_normal');
  const [lighting, setLighting] = useState('Calibrated Ring Light');
  const [cameraAngle, setCameraAngle] = useState('Top-Down 90°');
  const [background, setBackground] = useState('Anodized Charcoal Plate');
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [images, setImages] = useState<DatasetImageRecord[]>([]);
  const [summary, setSummary] = useState<
    Array<{
      category: string;
      trainNormal: number;
      valNormal: number;
      valDefect: number;
      testDefect: number;
      total: number;
    }>
  >([]);
  const [modelInfo, setModelInfo] = useState<{
    modelName: string;
    architecture: string;
    primaryBaseline: string;
    visionFusion: string;
    datasetStandard: string;
    inputSize: string;
    categories: CategoryModelStatus[];
    versions: Array<{
      id: string;
      name: string;
      architecture: string;
      category: string;
      version: string;
      datasetName: string;
      inputSize: number;
      normalSamples: number;
      createdAt: string;
    }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  const loadAll = async () => {
    try {
      const [ds, mi] = await Promise.all([api.getDataset(), api.getModelInfo()]);
      setImages(ds.images);
      setSummary(ds.summaryByCategory);
      setModelInfo(mi);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dataset and model status.');
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleUpload = async () => {
    if (uploadFiles.length === 0) {
      setError('Select one or more JPG/PNG images first.');
      return;
    }
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await api.uploadDatasetImages({
        files: uploadFiles,
        category: selectedCategory,
        split,
        lighting,
        cameraAngle,
        background,
      });
      setFeedback(
        `Uploaded ${res.added.length} image(s) to ${selectedCategory} (${SPLIT_LABELS[split]}). ${res.duplicatesSkipped} duplicate(s) skipped.`
      );
      setUploadFiles([]);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleTrain = async (cat: string) => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await api.trainModel(cat);
      const ev = res.trained.evaluation;
      setFeedback(
        `Built PatchCore Memory Bank ${res.trained.version} for ${cat}: ${res.trained.normalImageCount} normal training image(s), ${res.trained.coresetPatchCount} coreset patches.` +
          (ev && ev.auroc !== null
            ? ` Validation AUROC ${ev.auroc.toFixed(3)}, F1 ${ev.f1AtThreshold?.toFixed(3)}, ECE ${ev.ece?.toFixed(3)}.`
            : ' Add both val_normal and val_defect images to compute calibrated AUROC and ECE.')
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Training failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteImage = async (id: string) => {
    try {
      await api.deleteDatasetImage(id);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete dataset image.');
    }
  };

  const filteredImages = images.filter((img) => img.category === selectedCategory);
  const activeModelCat = modelInfo?.categories.find((c) => c.category === selectedCategory) ?? modelInfo?.categories[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Sub-navigation tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex rounded-lg border border-slate-800 bg-[#0f172a] p-1">
          <button
            type="button"
            onClick={() => setSection('dataset')}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors ${
              section === 'dataset' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Database className="h-3.5 w-3.5" aria-hidden="true" />
            Dataset Manager
          </button>
          <button
            type="button"
            onClick={() => setSection('model')}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold transition-colors ${
              section === 'model' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
            Model &amp; Calibration Metrics
          </button>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            aria-label="Active dataset category"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-white"
          >
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => handleTrain(selectedCategory)}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            Build {selectedCategory} Memory Bank
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-emerald-900/70 bg-emerald-950/40 px-4 py-3 text-xs text-emerald-200">
          {feedback}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-rose-900/70 bg-rose-950/40 px-4 py-3 text-xs text-rose-200">
          {error}
        </div>
      )}

      {section === 'dataset' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Dataset Upload Form */}
            <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-5">
              <h2 className="font-display text-base font-semibold text-white">
                Upload Industrial Dataset Images
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Normal training images populate the PatchCore memory bank. Defective images are strictly isolated for validation/test evaluation and never enter training.
              </p>

              <div className="mt-4 space-y-3 text-xs">
                <label className="block">
                  <span className="text-slate-300">Dataset Split</span>
                  <select
                    value={split}
                    onChange={(e) => setSplit(e.target.value as DatasetSplit)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
                  >
                    {(Object.keys(SPLIT_LABELS) as DatasetSplit[]).map((k) => (
                      <option key={k} value={k}>
                        {SPLIT_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-slate-400">Lighting</span>
                    <input
                      type="text"
                      value={lighting}
                      onChange={(e) => setLighting(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-400">Angle</span>
                    <input
                      type="text"
                      value={cameraAngle}
                      onChange={(e) => setCameraAngle(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
                    />
                  </label>
                  <label className="block">
                    <span className="text-slate-400">Background</span>
                    <input
                      type="text"
                      value={background}
                      onChange={(e) => setBackground(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-slate-300">Select JPG / PNG Files (up to 12)</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    multiple
                    onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []).slice(0, 12))}
                    className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-300 file:mr-3 file:rounded file:border-0 file:bg-sky-600 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-white"
                  />
                </label>

                <button
                  type="button"
                  disabled={busy || uploadFiles.length === 0}
                  onClick={handleUpload}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  Upload {uploadFiles.length > 0 ? `${uploadFiles.length} Image(s)` : 'to Dataset'}
                </button>
              </div>
            </div>

            {/* Category Split Matrix */}
            <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-7">
              <h2 className="font-display text-base font-semibold text-white">
                Category Dataset Distribution (MVTec AD Compatible)
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Strict train / validation / test split counts stored in SQLite
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 font-medium">Category</th>
                      <th className="py-2 text-right font-medium">Train Normal</th>
                      <th className="py-2 text-right font-medium">Val Normal</th>
                      <th className="py-2 text-right font-medium">Val Defect</th>
                      <th className="py-2 text-right font-medium">Test Defect</th>
                      <th className="py-2 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {summary.map((row) => (
                      <tr
                        key={row.category}
                        className={row.category === selectedCategory ? 'bg-sky-950/20' : 'hover:bg-slate-800/30'}
                      >
                        <td className="py-2 font-medium text-slate-200">{row.category}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-emerald-400">{row.trainNormal}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-sky-400">{row.valNormal}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-amber-400">{row.valDefect}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-rose-400">{row.testDefect}</td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedCategory(row.category)}
                            className="text-sky-400 hover:text-sky-300 font-medium"
                          >
                            Select
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Dataset Preview Grid */}
          <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6">
            <h3 className="font-display text-sm font-semibold text-white">
              {selectedCategory} Stored Images ({filteredImages.length})
            </h3>
            {filteredImages.length === 0 ? (
              <p className="mt-3 text-xs text-slate-400">
                No images stored for {selectedCategory} yet. Upload normal training images above to build a category memory bank.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {filteredImages.map((img) => (
                  <div key={img.id} className="rounded-lg border border-slate-800 bg-[#0b1222] p-2.5">
                    <img
                      src={img.imageUrl}
                      alt={img.filename}
                      referrerPolicy="no-referrer"
                      className="aspect-square w-full rounded object-cover"
                    />
                    <p className="mt-2 truncate text-xs font-medium text-white">{img.filename}</p>
                    <p className="text-[11px] text-sky-400">{img.split}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">
                      {img.width}×{img.height} · {img.lighting}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleDeleteImage(img.id)}
                      aria-label={`Delete dataset image ${img.filename}`}
                      className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Model Specification Overview */}
          {modelInfo && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                <p className="text-xs text-slate-400">Active Architecture</p>
                <p className="mt-1.5 font-display text-sm font-semibold text-white">{modelInfo.architecture}</p>
                <p className="mt-1 text-xs text-slate-500">{modelInfo.primaryBaseline}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                <p className="text-xs text-slate-400">Open-Set Vision Fusion</p>
                <p className="mt-1.5 font-display text-sm font-semibold text-sky-400">{modelInfo.visionFusion}</p>
                <p className="mt-1 text-xs text-slate-500">Server-side structured localization</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                <p className="text-xs text-slate-400">Preprocessing Input Size</p>
                <p className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-white">{modelInfo.inputSize}</p>
                <p className="mt-1 text-xs text-slate-500">24×24 multi-scale patch lattice</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                <p className="text-xs text-slate-400">Trained Memory Banks</p>
                <p className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-emerald-400">
                  {modelInfo.categories.length} Categories
                </p>
                <p className="mt-1 text-xs text-slate-500">{modelInfo.datasetStandard}</p>
              </div>
            </div>
          )}

          {/* Validation & Calibration Evaluation Metrics */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-6">
              <h2 className="font-display text-base font-semibold text-white">
                Evaluation &amp; Calibration ({activeModelCat?.category ?? selectedCategory})
              </h2>
              {activeModelCat?.evaluation && activeModelCat.evaluation.auroc !== null ? (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-3">
                      <p className="text-[11px] text-slate-400">Image AUROC</p>
                      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-emerald-400">
                        {activeModelCat.evaluation.auroc.toFixed(3)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-3">
                      <p className="text-[11px] text-slate-400">Avg Precision</p>
                      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-sky-400">
                        {activeModelCat.evaluation.averagePrecision?.toFixed(3)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-3">
                      <p className="text-[11px] text-slate-400">F1 Score</p>
                      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-white">
                        {activeModelCat.evaluation.f1AtThreshold?.toFixed(3)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-800 bg-[#0b1222] p-3">
                      <p className="text-[11px] text-slate-400">ECE Error</p>
                      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-amber-400">
                        {activeModelCat.evaluation.ece?.toFixed(3)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400">{activeModelCat.evaluation.note}</p>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-slate-800 bg-[#0b1222] p-5 text-xs text-slate-400">
                  <p className="font-medium text-slate-200">Validation Evaluation Pending</p>
                  <p className="mt-1.5 leading-relaxed">
                    PROMETHEUS-X never displays invented benchmark numbers. Upload held-out images to both{' '}
                    <span className="font-mono text-sky-400">val_normal</span> and{' '}
                    <span className="font-mono text-amber-400">val_defect</span> for {selectedCategory}, then click{' '}
                    <strong>Build {selectedCategory} Memory Bank</strong> to run real AUROC, Average Precision, F1, Platt/Temperature calibration, and ECE computation.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-6">
              <h2 className="font-display text-base font-semibold text-white">
                Calibration Reliability Diagram
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Predicted calibrated confidence vs observed defect accuracy per bin
              </p>
              {activeModelCat?.evaluation?.reliabilityBins && activeModelCat.evaluation.reliabilityBins.length > 0 ? (
                <div className="mt-4 h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={activeModelCat.evaluation.reliabilityBins}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="binLabel" stroke="#64748b" fontSize={11} />
                      <YAxis domain={[0, 1]} stroke="#64748b" fontSize={11} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0b1120',
                          borderColor: '#1e293b',
                          fontSize: '12px',
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="avgConfidence" name="Predicted Confidence" fill="#38bdf8" />
                      <Bar dataKey="empiricalAccuracy" name="Empirical Accuracy" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="mt-4 flex h-52 items-center justify-center rounded-lg border border-slate-800 bg-[#0b1222] text-xs text-slate-500">
                  Reliability bins populate after held-out validation calibration completes.
                </div>
              )}
            </div>
          </div>

          {/* Model Version History Table */}
          <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6">
            <h2 className="font-display text-base font-semibold text-white">Trained Memory Bank Checkpoints</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 font-medium">Category</th>
                    <th className="py-2 font-medium">Version</th>
                    <th className="py-2 text-right font-medium">Normal Images</th>
                    <th className="py-2 text-right font-medium">Coreset Patches</th>
                    <th className="py-2 font-medium">Calibration</th>
                    <th className="py-2 font-medium">Trained At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {(modelInfo?.categories ?? []).map((cat) => (
                    <tr key={cat.category}>
                      <td className="py-2.5 font-medium text-white">{cat.category}</td>
                      <td className="py-2.5 font-mono text-sky-400">{cat.version}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-slate-200">{cat.normalImageCount}</td>
                      <td className="py-2.5 text-right font-mono tabular-nums text-slate-200">{cat.coresetPatchCount}</td>
                      <td className="py-2.5 text-slate-300">
                        {cat.calibrationReady ? 'Calibrated (Validation)' : 'Uncalibrated (Normal Only)'}
                      </td>
                      <td className="py-2.5 font-mono text-slate-400">
                        {cat.trainedAt ? new Date(cat.trainedAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
