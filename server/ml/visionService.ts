import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  GeminiVisionResult,
  ImageFeatureStats,
  InspectionRecord,
  SampleSpecimen,
  SystemSettings,
} from '../../src/types/prometheus';
import {
  DATASETS_DIR,
  RESULTS_DIR,
  UPLOADS_DIR,
  addIndustrialEvent,
  findDatasetDuplicate,
  getMemoryBank,
  getSettings,
  insertDatasetImage,
  insertInspection,
  listDatasetImages,
  saveMemoryBank,
} from '../db/database';
import {
  SEVERITY_DISCLAIMER,
  buildCoresetMemoryBank,
  calibrateAnomalyScore,
  computeForegroundMask,
  computeImageFeatureStats,
  decideInspectionOutcome,
  estimateSeverity,
  evaluateDistributionShift,
  evaluateValidationSet,
  extractMultiScalePatchFeatures,
  fuseAnomalyMapAndExtractRegions,
  renderAnomalyMapToRgba,
  scorePatchAnomalyMap,
  type PatchMemoryBankData,
} from './engine';
import { computeBufferSha256 } from '../services/security';

const GEMINI_MODEL = 'gemini-4-hydrogen';
const GRID_SIZE = 24;

export const BUNDLED_SPECIMENS: SampleSpecimen[] = [
  {
    id: 'specimen-metal-nut-defect',
    name: 'Metal Nut — Scratch & Edge Dent',
    category: 'Metal Nut',
    expectedCondition: 'Defective',
    description: 'Machined hex metal nut with a deep diagonal gouge scratch and upper-right edge impact dent.',
    imageUrl: '/src/assets/images/sample_metal_nut_defect_1795654732689.jpg',
  },
  {
    id: 'specimen-metal-nut-normal',
    name: 'Metal Nut — Normal Baseline',
    category: 'Metal Nut',
    expectedCondition: 'Normal',
    description: 'Pristine machined hex metal nut under calibrated ring-light illumination for normal-pattern verification.',
    imageUrl: '/src/assets/images/sample_metal_nut_normal_1795654732772.jpg',
  },
  {
    id: 'specimen-transistor-defect',
    name: 'TO-220 Transistor — Bent Lead & Crack',
    category: 'Transistor',
    expectedCondition: 'Defective',
    description: 'Industrial power transistor showing a hairline casing fracture and a bent right terminal lead.',
    imageUrl: '/src/assets/images/sample_transistor_defect_1795654731440.jpg',
  },
];

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim().length < 8) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function isGeminiConfigured(): boolean {
  return createGeminiClient() !== null;
}

/**
 * Queries Gemini Vision API (gemini-4-hydrogen) server-side for open-set defect inspection,
 * precise normalized defect localization coordinates, and explainable rationale.
 */
async function analyzeWithGeminiVision(
  imageBuffer: Buffer,
  mimeType: string,
  category: string
): Promise<GeminiVisionResult> {
  const ai = createGeminiClient();
  if (!ai) {
    return {
      used: false,
      model: null,
      error: 'GEMINI_API_KEY is not configured in the server environment; running PatchCore memory-bank engine only.',
      defectDetected: false,
      defectType: 'None',
      confidence: 0,
      explanation: '',
      regions: [],
    };
  }

  try {
    const base64Data = imageBuffer.toString('base64');
    const prompt = [
      `You are an industrial optical quality inspection vision model evaluating a "${category}" specimen.`,
      `Carefully inspect ONLY the physical product specimen itself (ignore uniform dark/wood/metallic background tables or borders outside the object).`,
      `Identify any scratches, cracks, dents, chipped edges, bent pins/leads, corrosion, burns, holes, contamination, or structural anomalies — including rare or previously unseen defects.`,
      `If the product is clean and normal with no real manufacturing defect, set defectDetected=false and return an empty regions array.`,
      `If defects exist, return tight, accurate normalized bounding boxes [ymin, xmin, ymax, xmax] scaled 0..1000 tightly around EACH distinct defect on the product (never box the entire background).`,
      `Be precise and conservative to minimize false positives.`,
    ].join('\n');

    let response = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              { text: prompt },
            ],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                defectDetected: {
                  type: Type.BOOLEAN,
                  description: 'True only if an actual manufacturing defect or surface abnormality is visible on the product.',
                },
                defectType: {
                  type: Type.STRING,
                  description: 'Short defect category such as Scratch & Dent, Surface Crack, Bent Lead, Corrosion, Contamination, or None.',
                },
                confidence: {
                  type: Type.NUMBER,
                  description: 'Model certainty from 0.0 to 1.0.',
                },
                explanation: {
                  type: Type.STRING,
                  description: 'Concise 2-sentence technical explanation of observed normal features or defect evidence.',
                },
                regions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      defectType: { type: Type.STRING },
                      ymin: { type: Type.INTEGER },
                      xmin: { type: Type.INTEGER },
                      ymax: { type: Type.INTEGER },
                      xmax: { type: Type.INTEGER },
                      severityHint: { type: Type.STRING },
                    },
                    required: ['label', 'defectType', 'ymin', 'xmin', 'ymax', 'xmax', 'severityHint'],
                  },
                },
              },
              required: ['defectDetected', 'defectType', 'confidence', 'explanation', 'regions'],
            },
          },
        });
        break;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const transient = msg.includes('503') || msg.includes('429') || msg.includes('UNAVAILABLE') || msg.includes('high demand');
        if (transient && attempt < 2) {
          await new Promise((r) => setTimeout(r, 700 * Math.pow(2, attempt)));
          continue;
        }
        throw err;
      }
    }
    if (!response) throw lastError ?? new Error('No response from Gemini Vision.');

    const rawText = (response.text ?? '').trim();
    const parsed = JSON.parse(rawText) as {
      defectDetected: boolean;
      defectType: string;
      confidence: number;
      explanation: string;
      regions: Array<{
        label: string;
        defectType: string;
        ymin: number;
        xmin: number;
        ymax: number;
        xmax: number;
        severityHint: string;
      }>;
    };

    const sanitizedRegions = Array.isArray(parsed.regions)
      ? parsed.regions
          .filter(
            (r) =>
              Number.isFinite(r.xmin) &&
              Number.isFinite(r.xmax) &&
              Number.isFinite(r.ymin) &&
              Number.isFinite(r.ymax) &&
              r.xmax > r.xmin &&
              r.ymax > r.ymin
          )
          .slice(0, 6)
          .map((r) => ({
            label: String(r.label || 'Defect Region').slice(0, 64),
            defectType: String(r.defectType || parsed.defectType || 'Surface Anomaly').slice(0, 48),
            ymin: Math.max(0, Math.min(1000, Math.round(r.ymin))),
            xmin: Math.max(0, Math.min(1000, Math.round(r.xmin))),
            ymax: Math.max(0, Math.min(1000, Math.round(r.ymax))),
            xmax: Math.max(0, Math.min(1000, Math.round(r.xmax))),
            severityHint: (['LOW', 'MEDIUM', 'HIGH'].includes(String(r.severityHint).toUpperCase())
              ? String(r.severityHint).toUpperCase()
              : 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH',
          }))
      : [];

    return {
      used: true,
      model: GEMINI_MODEL,
      error: null,
      defectDetected: Boolean(parsed.defectDetected),
      defectType: parsed.defectDetected ? String(parsed.defectType || 'Surface Defect') : 'None',
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.7)),
      explanation: String(parsed.explanation || ''),
      regions: parsed.defectDetected ? sanitizedRegions : [],
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Gemini Vision request failed.';
    const friendly =
      rawMsg.includes('503') || rawMsg.includes('UNAVAILABLE') || rawMsg.includes('high demand')
        ? 'Gemini Vision temporarily busy (503). Inspection completed using PatchCore Memory Bank.'
        : rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED')
          ? 'Gemini Vision quota temporarily exhausted (429). Inspection completed using PatchCore Memory Bank.'
          : 'Gemini Vision temporarily unavailable. Inspection completed using PatchCore Memory Bank.';
    return {
      used: false,
      model: GEMINI_MODEL,
      error: friendly,
      defectDetected: false,
      defectType: 'Unknown',
      confidence: 0,
      explanation: '',
      regions: [],
    };
  }
}

/**
 * Decodes an image buffer to a resized RGB tensor + original metadata using Sharp.
 */
export async function decodeImageToRgb(
  buffer: Buffer,
  targetSize: number
): Promise<{
  rgb: Uint8Array;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}> {
  const meta = await sharp(buffer).metadata();
  const originalWidth = meta.width ?? targetSize;
  const originalHeight = meta.height ?? targetSize;

  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(targetSize, targetSize, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    rgb: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
    originalWidth,
    originalHeight,
  };
}

/**
 * Ensures the starter Metal Nut baseline normal dataset & Memory Bank is bootstrapped
 * from our real bundled macro specimen so PatchCore immediately has a real normal memory bank
 * (without fabricating any fake inspection records!).
 */
export async function ensureStarterNormalBaseline(): Promise<void> {
  const existingBank = getMemoryBank('Metal Nut');
  if (existingBank && existingBank.spatialReferenceGrid && existingBank.spatialReferenceGrid.length > 0) return;

  const normalAssetPath = path.resolve(
    process.cwd(),
    'src/assets/images/sample_metal_nut_normal_1795654732772.jpg'
  );
  const defectAssetPath = path.resolve(
    process.cwd(),
    'src/assets/images/sample_metal_nut_defect_1795654732689.jpg'
  );
  if (!fs.existsSync(normalAssetPath)) return;

  try {
    const normalBuf = fs.readFileSync(normalAssetPath);
    const normalHash = computeBufferSha256(normalBuf);
    if (!findDatasetDuplicate('Metal Nut', normalHash)) {
      const meta = await sharp(normalBuf).metadata();
      const storedName = `ds-seed-metal-nut-normal.jpg`;
      fs.writeFileSync(path.join(DATASETS_DIR, storedName), normalBuf);
      insertDatasetImage({
        id: 'ds-seed-mn-norm-1',
        category: 'Metal Nut',
        split: 'train_normal',
        filename: 'metal_nut_normal_baseline.jpg',
        imageHash: normalHash,
        storedFilename: storedName,
        width: meta.width ?? 1024,
        height: meta.height ?? 1024,
        lighting: 'Calibrated Ring Light',
        cameraAngle: 'Top-Down 90°',
        background: 'Anodized Charcoal Plate',
      });
    }

    // Also add held-out validation defect specimen strictly in val_defect (never in train_normal!)
    if (fs.existsSync(defectAssetPath)) {
      const defBuf = fs.readFileSync(defectAssetPath);
      const defHash = computeBufferSha256(defBuf);
      if (!findDatasetDuplicate('Metal Nut', defHash)) {
        const meta = await sharp(defBuf).metadata();
        const storedName = `ds-seed-metal-nut-defect.jpg`;
        fs.writeFileSync(path.join(DATASETS_DIR, storedName), defBuf);
        insertDatasetImage({
          id: 'ds-seed-mn-def-1',
          category: 'Metal Nut',
          split: 'val_defect',
          filename: 'metal_nut_scratch_dent_val.jpg',
          imageHash: defHash,
          storedFilename: storedName,
          width: meta.width ?? 1024,
          height: meta.height ?? 1024,
          lighting: 'Calibrated Ring Light',
          cameraAngle: 'Top-Down 90°',
          background: 'Anodized Charcoal Plate',
        });
      }
    }

    await trainCategoryMemoryBank('Metal Nut');
  } catch (err) {
    console.warn('Starter normal baseline initialization skipped:', err);
  }
}

/**
 * Trains (or rebuilds) a category's PatchCore Normal Memory Bank exclusively from `train_normal` images,
 * computes baseline Reference Distribution statistics for Drift Monitoring,
 * and evaluates held-out validation images (`val_normal` + `val_defect` / `test_defect`) for AUROC/AP/F1/ECE.
 */
export async function trainCategoryMemoryBank(category: string): Promise<{
  category: string;
  version: string;
  normalImageCount: number;
  coresetPatchCount: number;
  evaluation: PatchMemoryBankData['calibration']['evaluation'];
}> {
  const settings = getSettings();
  const trainImages = listDatasetImages(category, 'train_normal');
  if (trainImages.length === 0) {
    throw new Error(
      `No normal training images found for category "${category}". Upload at least 1 normal image to the train_normal split first.`
    );
  }

  const allPatches: number[][] = [];
  const perImagePatchGrids: number[][][] = [];
  const statList: ImageFeatureStats[] = [];

  for (const img of trainImages) {
    const filePath = path.join(DATASETS_DIR, img.storedFilename);
    if (!fs.existsSync(filePath)) continue;
    const buf = fs.readFileSync(filePath);
    const decoded = await decodeImageToRgb(buf, settings.preprocessingSize);
    const patches = extractMultiScalePatchFeatures(decoded.rgb, decoded.width, decoded.height, GRID_SIZE);
    allPatches.push(...patches);
    perImagePatchGrids.push(patches);
    statList.push(
      computeImageFeatureStats(
        decoded.rgb,
        decoded.width,
        decoded.height,
        decoded.originalWidth,
        decoded.originalHeight
      )
    );
  }

  if (allPatches.length === 0 || statList.length === 0) {
    throw new Error(`Unable to read stored training images for "${category}".`);
  }

  const coreset = buildCoresetMemoryBank(allPatches, 460);

  // Compute spatial mean reference grid across normal training images
  const cellCount = GRID_SIZE * GRID_SIZE;
  const featDim = perImagePatchGrids[0][0].length;
  const spatialReferenceGrid: number[][] = Array.from({ length: cellCount }, (_, cellIdx) => {
    const meanVec = new Array<number>(featDim).fill(0);
    for (const grid of perImagePatchGrids) {
      const vec = grid[cellIdx];
      for (let d = 0; d < featDim; d++) meanVec[d] += vec[d];
    }
    return meanVec.map((v) => Number((v / perImagePatchGrids.length).toFixed(4)));
  });

  // Compute reference mean & std across normal training images
  const avg = (fn: (s: ImageFeatureStats) => number) =>
    statList.reduce((acc, s) => acc + fn(s), 0) / statList.length;
  const std = (fn: (s: ImageFeatureStats) => number, meanVal: number) => {
    if (statList.length < 2) return 0.08;
    const v = statList.reduce((acc, s) => acc + Math.pow(fn(s) - meanVal, 2), 0) / statList.length;
    return Math.max(0.04, Math.sqrt(v));
  };

  const referenceStats: ImageFeatureStats = {
    meanR: Number(avg((s) => s.meanR).toFixed(4)),
    meanG: Number(avg((s) => s.meanG).toFixed(4)),
    meanB: Number(avg((s) => s.meanB).toFixed(4)),
    luminanceMean: Number(avg((s) => s.luminanceMean).toFixed(4)),
    luminanceStd: Number(avg((s) => s.luminanceStd).toFixed(4)),
    contrast: Number(avg((s) => s.contrast).toFixed(4)),
    edgeDensity: Number(avg((s) => s.edgeDensity).toFixed(4)),
    textureVariance: Number(avg((s) => s.textureVariance).toFixed(4)),
    saturationMean: Number(avg((s) => s.saturationMean).toFixed(4)),
    width: Math.round(avg((s) => s.width)),
    height: Math.round(avg((s) => s.height)),
  };

  const referenceStd: PatchMemoryBankData['referenceStd'] = {
    meanR: Number(std((s) => s.meanR, referenceStats.meanR).toFixed(4)),
    meanG: Number(std((s) => s.meanG, referenceStats.meanG).toFixed(4)),
    meanB: Number(std((s) => s.meanB, referenceStats.meanB).toFixed(4)),
    luminanceMean: Number(std((s) => s.luminanceMean, referenceStats.luminanceMean).toFixed(4)),
    luminanceStd: Number(std((s) => s.luminanceStd, referenceStats.luminanceStd).toFixed(4)),
    contrast: Number(std((s) => s.contrast, referenceStats.contrast).toFixed(4)),
    edgeDensity: Number(std((s) => s.edgeDensity, referenceStats.edgeDensity).toFixed(4)),
    textureVariance: Number(std((s) => s.textureVariance, referenceStats.textureVariance).toFixed(4)),
    saturationMean: Number(std((s) => s.saturationMean, referenceStats.saturationMean).toFixed(4)),
  };

  // Held-out validation evaluation (never trains on test/val defect images!)
  const valNormal = listDatasetImages(category, 'val_normal');
  const valDefect = [
    ...listDatasetImages(category, 'val_defect'),
    ...listDatasetImages(category, 'test_defect'),
  ];

  const evalSamples: Array<{ score: number; isDefect: boolean }> = [];
  const scoreDatasetFile = async (storedFilename: string) => {
    const p = path.join(DATASETS_DIR, storedFilename);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    const decoded = await decodeImageToRgb(buf, settings.preprocessingSize);
    const fgMask = settings.foregroundSuppression
      ? computeForegroundMask(decoded.rgb, decoded.width, decoded.height, GRID_SIZE)
      : null;
    const patches = extractMultiScalePatchFeatures(decoded.rgb, decoded.width, decoded.height, GRID_SIZE);
    const scored = scorePatchAnomalyMap(patches, GRID_SIZE, coreset, fgMask, spatialReferenceGrid);
    return scored.imageScore;
  };

  for (const img of valNormal) {
    const score = await scoreDatasetFile(img.storedFilename);
    if (score !== null) evalSamples.push({ score, isDefect: false });
  }
  for (const img of valDefect) {
    const score = await scoreDatasetFile(img.storedFilename);
    if (score !== null) evalSamples.push({ score, isDefect: true });
  }

  const evaluation =
    evalSamples.length >= 2 &&
    evalSamples.some((s) => !s.isDefect) &&
    evalSamples.some((s) => s.isDefect)
      ? evaluateValidationSet(evalSamples, settings.anomalyThreshold)
      : null;

  const bank: PatchMemoryBankData = {
    category,
    gridSize: GRID_SIZE,
    coreset,
    spatialReferenceGrid,
    referenceStats,
    referenceStd,
    normalImageCount: statList.length,
    calibration: {
      calibrated: Boolean(evaluation && evaluation.auroc !== null),
      plattA: evaluation?.plattA ?? 6.0,
      plattB: evaluation?.plattB ?? -3.0,
      temperature: evaluation?.temperature ?? 1.0,
      evaluation,
    },
  };

  const version = `v${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.${String(Date.now()).slice(-4)}`;
  saveMemoryBank(bank, version, settings.preprocessingSize);

  return {
    category,
    version,
    normalImageCount: statList.length,
    coresetPatchCount: coreset.length,
    evaluation,
  };
}

/**
 * Full end-to-end inspection pipeline:
 * 1. Decode & preprocess image with Sharp
 * 2. Compute feature stats & Distribution Shift against category baseline
 * 3. Multi-scale PatchCore feature extraction + foreground suppression + memory bank k-NN distance
 * 4. Optional Gemini Vision API (gemini-4-hydrogen) open-set defect localization & explanation
 * 5. Hybrid anomaly map fusion -> Jet Colormap PNG + Binary Mask PNG + Rectangle & Circle defect regions
 * 6. Severity estimation, Calibration (Platt/Temperature or explicitly uncalibrated), Final recommendation
 * 7. Persist original + visual assets + SQLite inspection & industrial event records
 */
export async function runInspectionPipeline(params: {
  imageBuffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  filename: string;
  category: string;
  source: 'upload' | 'batch' | 'webcam' | 'sample';
  batchId?: string | null;
  settingsOverride?: Partial<SystemSettings>;
}): Promise<InspectionRecord> {
  const startMs = performance.now();
  const settings: SystemSettings = { ...getSettings(), ...(params.settingsOverride ?? {}) };
  const id = `INS-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const imageHash = computeBufferSha256(params.imageBuffer);

  // 1. Decode image
  const decoded = await decodeImageToRgb(params.imageBuffer, settings.preprocessingSize);
  const featureStats = computeImageFeatureStats(
    decoded.rgb,
    decoded.width,
    decoded.height,
    decoded.originalWidth,
    decoded.originalHeight
  );

  // 2. Load category PatchCore Memory Bank & evaluate Distribution Shift
  const bank = getMemoryBank(params.category);
  const drift = evaluateDistributionShift(
    featureStats,
    bank?.referenceStats ?? null,
    bank?.referenceStd ?? null,
    settings
  );

  // 3. PatchCore multi-scale patch extraction & scoring
  const fgMask = settings.foregroundSuppression
    ? computeForegroundMask(decoded.rgb, decoded.width, decoded.height, GRID_SIZE)
    : null;
  const patches = extractMultiScalePatchFeatures(decoded.rgb, decoded.width, decoded.height, GRID_SIZE);
  const patchScored = scorePatchAnomalyMap(
    patches,
    GRID_SIZE,
    bank?.coreset ?? null,
    fgMask,
    bank?.spatialReferenceGrid ?? null
  );

  // 4. Gemini Vision API open-set inspection (when enabled)
  let geminiResult: GeminiVisionResult | null = null;
  if (settings.useGeminiVision && settings.activeModelArchitecture === 'PatchCore + Gemini Vision Hybrid') {
    // Resize copy <= 768px for fast, reliable vision API latency
    const visionBuf = await sharp(params.imageBuffer)
      .rotate()
      .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    geminiResult = await analyzeWithGeminiVision(visionBuf, 'image/jpeg', params.category);
  }

  // 5. Fuse PatchCore + Gemini anomaly maps & extract clean Rectangle/Circle defect regions
  const fused = fuseAnomalyMapAndExtractRegions(
    patchScored.map,
    GRID_SIZE,
    geminiResult,
    settings.anomalyThreshold
  );

  // Compute combined anomaly score
  let combinedScore = patchScored.imageScore;
  let geminiScore: number | null = null;
  let engineMode: InspectionRecord['engineMode'] = patchScored.usedMemoryBank
    ? 'patchcore_memory_bank'
    : 'patchcore_self_similarity';

  if (geminiResult && geminiResult.used) {
    engineMode = 'hybrid_patchcore_gemini';
    geminiScore = geminiResult.defectDetected
      ? Number(Math.max(0.58, geminiResult.confidence * 0.96).toFixed(4))
      : Number(Math.max(0.04, (1 - geminiResult.confidence) * 0.35).toFixed(4));
    combinedScore = Number(
      Math.min(1, Math.max(0, patchScored.imageScore * 0.42 + geminiScore * 0.58)).toFixed(4)
    );
    // Boost if both engines strongly agree on defect
    if (geminiResult.defectDetected && patchScored.imageScore >= 0.4) {
      combinedScore = Number(Math.min(0.99, Math.max(combinedScore, fused.maxIntensity * 0.95)).toFixed(4));
    }
  } else {
    combinedScore = Number(Math.max(patchScored.imageScore, fused.maxIntensity * 0.85).toFixed(4));
  }

  // 6. Calibration, Decision & Severity
  const calibration = calibrateAnomalyScore(combinedScore, settings, bank?.calibration ?? null);
  const prediction = decideInspectionOutcome(combinedScore, calibration, drift, settings);
  const severity = estimateSeverity(prediction, fused.affectedAreaPct, fused.maxIntensity, settings);

  // If PASS, clear stray sub-threshold regions so clean parts don't show noisy boxes
  const finalRegions = prediction === 'PASS' ? [] : fused.regions;
  const defectType =
    prediction === 'PASS'
      ? 'None (Normal Specimen)'
      : geminiResult?.used && geminiResult.defectDetected
        ? geminiResult.defectType
        : finalRegions[0]?.defectType ?? 'Open-Set Surface Anomaly';

  const explanation = (() => {
    const parts: string[] = [];
    if (geminiResult?.used && geminiResult.explanation) {
      parts.push(geminiResult.explanation);
    }
    if (patchScored.usedMemoryBank) {
      parts.push(
        `PatchCore k-NN memory bank (${bank?.coreset.length ?? 0} normal reference patches) measured a patch anomaly score of ${patchScored.imageScore.toFixed(3)} with ${fused.affectedAreaPct}% affected surface area.`
      );
    } else {
      parts.push(
        `Multi-scale local patch saliency measured a deviation score of ${patchScored.imageScore.toFixed(3)} (${fused.affectedAreaPct}% area). Train a normal baseline in Dataset Manager for reference memory-bank matching.`
      );
    }
    if (drift.referenceAvailable && drift.status !== 'STABLE') {
      parts.push(`Distribution shift monitor flagged ${drift.status.replace('_', ' ')} (${drift.driftScore}σ).`);
    }
    return parts.join(' ');
  })();

  // 7. Save Original, Jet Heatmap PNG, and Binary Mask PNG to disk
  const ext = params.mimeType === 'image/png' ? 'png' : 'jpg';
  const originalFile = `${id}_original.${ext}`;
  const heatmapFile = `${id}_heatmap.png`;
  const maskFile = `${id}_mask.png`;

  // Normalize visual output size to preserve specimen aspect ratio up to 512px
  const aspect = decoded.originalWidth / Math.max(1, decoded.originalHeight);
  const outW = aspect >= 1 ? 512 : Math.max(192, Math.round(512 * aspect));
  const outH = aspect >= 1 ? Math.max(192, Math.round(512 / aspect)) : 512;

  fs.writeFileSync(path.join(UPLOADS_DIR, originalFile), params.imageBuffer);

  const heatmapRgba = renderAnomalyMapToRgba(fused.fusedMap, GRID_SIZE, outW, outH, 'heatmap');
  await sharp(Buffer.from(heatmapRgba), { raw: { width: outW, height: outH, channels: 4 } })
    .png()
    .toFile(path.join(RESULTS_DIR, heatmapFile));

  const maskRgba = renderAnomalyMapToRgba(
    fused.fusedMap,
    GRID_SIZE,
    outW,
    outH,
    'mask',
    Math.max(0.42, settings.anomalyThreshold * 0.9)
  );
  await sharp(Buffer.from(maskRgba), { raw: { width: outW, height: outH, channels: 4 } })
    .png()
    .toFile(path.join(RESULTS_DIR, maskFile));

  const processingTimeMs = Number((performance.now() - startMs).toFixed(1));
  const reviewStatus =
    prediction === 'REVIEW' ||
    calibration.confidenceBand === 'NEEDS HUMAN REVIEW' ||
    prediction === 'DEFECT'
      ? 'PENDING'
      : 'NOT_REQUIRED';

  const record: InspectionRecord = {
    id,
    category: params.category,
    filename: params.filename,
    imageHash,
    createdAt: new Date().toISOString(),
    processingTimeMs,
    prediction,
    anomalyScore: combinedScore,
    patchCoreScore: patchScored.imageScore,
    geminiScore,
    severity,
    severityDisclaimer: SEVERITY_DISCLAIMER,
    affectedAreaPct: fused.affectedAreaPct,
    maxIntensity: fused.maxIntensity,
    defectType,
    explanation,
    engineMode,
    memoryBankUsed: patchScored.usedMemoryBank,
    calibration,
    drift,
    reviewStatus,
    reviewerNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    regions: finalRegions,
    featureStats,
    geminiMeta: {
      used: Boolean(geminiResult?.used),
      model: geminiResult?.model ?? null,
      error: geminiResult?.error ?? null,
    },
    assets: {
      originalUrl: `/api/files/uploads/${originalFile}`,
      heatmapUrl: `/api/files/results/${heatmapFile}`,
      maskUrl: `/api/files/results/${maskFile}`,
    },
    batchId: params.batchId ?? null,
    source: params.source,
  };

  insertInspection(record);

  // Log industrial event
  addIndustrialEvent({
    lineName: 'Optical Inspection Station 01',
    cameraAdapter: params.source === 'webcam' ? 'Live Webcam Prototype' : 'REST Upload Ingestion',
    eventType:
      prediction === 'DEFECT'
        ? 'DEFECT_REJECT'
        : drift.status !== 'STABLE'
          ? 'DRIFT_WARNING'
          : 'INSPECTION_PASS',
    message: `${record.category} (${record.filename}) → ${record.prediction} | Score ${record.anomalyScore.toFixed(3)} | Severity ${record.severity}`,
    inspectionId: record.id,
  });

  return record;
}
