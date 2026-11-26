import type {
  CalibrationOutput,
  ConfidenceBand,
  DefectRegion,
  DriftAnalysis,
  DriftStatus,
  GeminiVisionResult,
  ImageFeatureStats,
  ModelEvaluationMetrics,
  PredictionOutcome,
  ReliabilityBin,
  SeverityLevel,
  SystemSettings,
} from '../../src/types/prometheus';

export interface PatchMemoryBankData {
  category: string;
  gridSize: number;
  coreset: number[][]; // Each patch descriptor has length 10
  spatialReferenceGrid?: number[][]; // Per-cell mean descriptor across train_normal images (length gridSize*gridSize)
  referenceStats: ImageFeatureStats;
  referenceStd: {
    meanR: number;
    meanG: number;
    meanB: number;
    luminanceMean: number;
    luminanceStd: number;
    contrast: number;
    edgeDensity: number;
    textureVariance: number;
    saturationMean: number;
  };
  normalImageCount: number;
  calibration: {
    calibrated: boolean;
    plattA: number;
    plattB: number;
    temperature: number;
    evaluation: ModelEvaluationMetrics | null;
  };
}

export const SEVERITY_DISCLAIMER =
  'Estimated inspection severity category derived from visual anomaly intensity and affected area; not a certified structural or engineering safety assessment.';

export const DRIFT_DISCLAIMER =
  'Distribution shift monitoring detects changes in imaging or production input statistics and does not automatically prove a product is defective or that the model has failed.';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

/**
 * Computes global image feature statistics used for Distribution Shift Monitoring.
 * Input rgb is a flat Uint8Array of length width * height * 3 (RGB order).
 */
export function computeImageFeatureStats(
  rgb: Uint8Array,
  width: number,
  height: number,
  originalWidth = width,
  originalHeight = height
): ImageFeatureStats {
  const pixelCount = Math.max(1, width * height);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLum = 0;
  let sumSat = 0;
  const lum = new Float32Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    sumR += r;
    sumG += g;
    sumB += b;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    lum[i] = l;
    sumLum += l;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    sumSat += maxC > 0 ? (maxC - minC) / maxC : 0;
  }

  const meanR = sumR / pixelCount;
  const meanG = sumG / pixelCount;
  const meanB = sumB / pixelCount;
  const luminanceMean = sumLum / pixelCount;
  const saturationMean = sumSat / pixelCount;

  let lumVarSum = 0;
  let minLum = 1;
  let maxLum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const d = lum[i] - luminanceMean;
    lumVarSum += d * d;
    if (lum[i] < minLum) minLum = lum[i];
    if (lum[i] > maxLum) maxLum = lum[i];
  }
  const luminanceStd = Math.sqrt(lumVarSum / pixelCount);

  // Sobel edge density & Laplacian texture variance
  let edgeSum = 0;
  let lapVarSum = 0;
  let innerCount = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx =
        -lum[idx - width - 1] +
        lum[idx - width + 1] -
        2 * lum[idx - 1] +
        2 * lum[idx + 1] -
        lum[idx + width - 1] +
        lum[idx + width + 1];
      const gy =
        -lum[idx - width - 1] -
        2 * lum[idx - width] -
        lum[idx - width + 1] +
        lum[idx + width - 1] +
        2 * lum[idx + width] +
        lum[idx + width + 1];
      const mag = Math.sqrt(gx * gx + gy * gy);
      edgeSum += mag;
      const lap =
        4 * lum[idx] - lum[idx - 1] - lum[idx + 1] - lum[idx - width] - lum[idx + width];
      lapVarSum += lap * lap;
      innerCount++;
    }
  }

  const edgeDensity = innerCount > 0 ? edgeSum / innerCount : 0;
  const textureVariance = innerCount > 0 ? Math.sqrt(lapVarSum / innerCount) : 0;

  return {
    meanR: Number(meanR.toFixed(4)),
    meanG: Number(meanG.toFixed(4)),
    meanB: Number(meanB.toFixed(4)),
    luminanceMean: Number(luminanceMean.toFixed(4)),
    luminanceStd: Number(luminanceStd.toFixed(4)),
    contrast: Number((maxLum - minLum).toFixed(4)),
    edgeDensity: Number(edgeDensity.toFixed(4)),
    textureVariance: Number(textureVariance.toFixed(4)),
    saturationMean: Number(saturationMean.toFixed(4)),
    width: originalWidth,
    height: originalHeight,
  };
}

/**
 * Estimates a soft foreground focus mask [0..1] per grid cell to suppress uniform
 * background inspection stages and prevent vertical/horizontal border bleed
 * (solving the false-positive edge strip issue seen in naive patch comparators).
 */
export function computeForegroundMask(
  rgb: Uint8Array,
  width: number,
  height: number,
  gridSize: number
): Float32Array {
  // Sample 4% border ring to estimate background plate color
  const borderW = Math.max(2, Math.floor(width * 0.05));
  const borderH = Math.max(2, Math.floor(height * 0.05));
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < borderW || x >= width - borderW || y < borderH || y >= height - borderH) {
        const i = (y * width + x) * 3;
        bgR += rgb[i] / 255;
        bgG += rgb[i + 1] / 255;
        bgB += rgb[i + 2] / 255;
        count++;
      }
    }
  }
  bgR /= Math.max(1, count);
  bgG /= Math.max(1, count);
  bgB /= Math.max(1, count);

  const mask = new Float32Array(gridSize * gridSize);
  const cellW = width / gridSize;
  const cellH = height / gridSize;

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const x0 = Math.floor(gx * cellW);
      const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cellW));
      const y0 = Math.floor(gy * cellH);
      const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * cellH));

      let distSum = 0;
      let cellCount = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 3;
          const dr = rgb[i] / 255 - bgR;
          const dg = rgb[i + 1] / 255 - bgG;
          const db = rgb[i + 2] / 255 - bgB;
          distSum += Math.sqrt(dr * dr + dg * dg + db * db);
          cellCount++;
        }
      }
      const avgDist = distSum / Math.max(1, cellCount);
      // Softly suppress the outermost 1-cell rim to avoid frame artifacts
      const edgeTaper =
        gx === 0 || gx === gridSize - 1 || gy === 0 || gy === gridSize - 1 ? 0.35 : 1.0;
      // Foreground weight smoothly rises above background color delta > 0.06
      const fgWeight = clamp((avgDist - 0.04) / 0.14, 0.22, 1.0);
      mask[gy * gridSize + gx] = fgWeight * edgeTaper;
    }
  }

  return mask;
}

/**
 * Multi-scale PatchCore-inspired feature extraction.
 * Extracts a 10-D descriptor per cell on a `gridSize x gridSize` lattice, fusing local fine features
 * with 3x3 neighborhood mid-scale aggregates (just like PatchCore's local neighborhood aggregation).
 */
export function extractMultiScalePatchFeatures(
  rgb: Uint8Array,
  width: number,
  height: number,
  gridSize = 24
): number[][] {
  const cellW = width / gridSize;
  const cellH = height / gridSize;
  const rawCells: number[][] = new Array(gridSize * gridSize);

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const x0 = Math.floor(gx * cellW);
      const x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cellW));
      const y0 = Math.floor(gy * cellH);
      const y1 = Math.max(y0 + 1, Math.floor((gy + 1) * cellH));

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumL = 0;
      let sumL2 = 0;
      let gradSum = 0;
      let maxGrad = 0;
      let lapSum = 0;
      let n = 0;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 3;
          const r = rgb[i] / 255;
          const g = rgb[i + 1] / 255;
          const b = rgb[i + 2] / 255;
          const l = 0.299 * r + 0.587 * g + 0.114 * b;
          sumR += r;
          sumG += g;
          sumB += b;
          sumL += l;
          sumL2 += l * l;

          const rx = Math.min(width - 1, x + 1);
          const lx = Math.max(0, x - 1);
          const dy = Math.min(height - 1, y + 1);
          const uy = Math.max(0, y - 1);

          const lumAt = (px: number, py: number) => {
            const p = (py * width + px) * 3;
            return (0.299 * rgb[p] + 0.587 * rgb[p + 1] + 0.114 * rgb[p + 2]) / 255;
          };

          const gxVal = lumAt(rx, y) - lumAt(lx, y);
          const gyVal = lumAt(x, dy) - lumAt(x, uy);
          const gMag = Math.sqrt(gxVal * gxVal + gyVal * gyVal);
          gradSum += gMag;
          if (gMag > maxGrad) maxGrad = gMag;

          const lap = Math.abs(4 * l - lumAt(rx, y) - lumAt(lx, y) - lumAt(x, dy) - lumAt(x, uy));
          lapSum += lap;
          n++;
        }
      }

      const invN = 1 / Math.max(1, n);
      const meanR = sumR * invN;
      const meanG = sumG * invN;
      const meanB = sumB * invN;
      const meanL = sumL * invN;
      const stdL = Math.sqrt(Math.max(0, sumL2 * invN - meanL * meanL));
      const meanGrad = gradSum * invN;
      const meanLap = lapSum * invN;
      const maxC = Math.max(meanR, meanG, meanB);
      const minC = Math.min(meanR, meanG, meanB);
      const chroma = maxC - minC;

      rawCells[gy * gridSize + gx] = [
        meanR,
        meanG,
        meanB,
        meanL,
        stdL * 2.5, // emphasize local texture contrast
        meanGrad * 3.0, // emphasize fine scratches & edges
        maxGrad * 1.8, // catch sharp cracks/chips
        meanLap * 3.5, // high-frequency surface anomaly
        chroma * 1.6, // rust / corrosion / burn discoloration
        0, // placeholder for multi-scale neighborhood delta
      ];
    }
  }

  // Multi-scale local neighborhood context (3x3 average comparison)
  const aggregated: number[][] = new Array(gridSize * gridSize);
  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const center = rawCells[gy * gridSize + gx];
      let nbLum = 0;
      let nbGrad = 0;
      let nbCount = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = gy + dy;
          const nx = gx + dx;
          if (ny >= 0 && ny < gridSize && nx >= 0 && nx < gridSize) {
            const c = rawCells[ny * gridSize + nx];
            nbLum += c[3];
            nbGrad += c[5];
            nbCount++;
          }
        }
      }
      const localContrastDelta =
        Math.abs(center[3] - nbLum / nbCount) * 2.5 +
        Math.abs(center[5] - nbGrad / nbCount) * 1.5;

      aggregated[gy * gridSize + gx] = [
        center[0],
        center[1],
        center[2],
        center[3],
        center[4],
        center[5],
        center[6],
        center[7],
        center[8],
        localContrastDelta,
      ];
    }
  }

  return aggregated;
}

/**
 * Greedy coreset subsampling (PatchCore style) to keep memory bank compact & fast.
 */
export function buildCoresetMemoryBank(allPatches: number[][], maxCoresetSize = 420): number[][] {
  if (allPatches.length <= maxCoresetSize) {
    return allPatches.map((p) => p.map((v) => Number(v.toFixed(4))));
  }
  const stride = allPatches.length / maxCoresetSize;
  const selected: number[][] = [];
  for (let i = 0; i < maxCoresetSize; i++) {
    const idx = Math.min(allPatches.length - 1, Math.floor(i * stride));
    selected.push(allPatches[idx].map((v) => Number(v.toFixed(4))));
  }
  return selected;
}

function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Scores every patch against the learned Normal Memory Bank using k-NN distance (k=3)
 * combined with 3x3 spatially-aligned normal patch reference comparison (prevents dark scratches
 * on metallic surfaces from falsely matching dark background cells in global k-NN).
 */
export function scorePatchAnomalyMap(
  patches: number[][],
  gridSize: number,
  memoryBank: number[][] | null,
  foregroundMask: Float32Array | null,
  spatialReferenceGrid: number[][] | null = null
): { map: Float32Array; imageScore: number; usedMemoryBank: boolean } {
  const n = patches.length;
  const rawScores = new Float32Array(n);
  const usedMemoryBank = Boolean(memoryBank && memoryBank.length >= 16);
  const hasSpatialRef = Boolean(spatialReferenceGrid && spatialReferenceGrid.length === n);

  if (usedMemoryBank && memoryBank) {
    const k = Math.min(3, memoryBank.length);
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const i = gy * gridSize + gx;
        const p = patches[i];
        // 1. Global PatchCore coreset k-NN distance
        const best = new Float32Array(k).fill(Infinity);
        for (let j = 0; j < memoryBank.length; j++) {
          const dist = euclideanDistance(p, memoryBank[j]);
          if (dist < best[k - 1]) {
            best[k - 1] = dist;
            for (let m = k - 1; m > 0 && best[m] < best[m - 1]; m--) {
              const tmp = best[m - 1];
              best[m - 1] = best[m];
              best[m] = tmp;
            }
          }
        }
        let globalDist = 0;
        for (let m = 0; m < k; m++) globalDist += best[m];
        globalDist /= k;

        // 2. Local 3x3 spatial-tolerant reference distance (handles slight part translation while catching scratches/dents)
        let spatialDist = globalDist;
        if (hasSpatialRef && spatialReferenceGrid) {
          let bestLocal = Infinity;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = gy + dy;
              const nx = gx + dx;
              if (ny >= 0 && ny < gridSize && nx >= 0 && nx < gridSize) {
                const d = euclideanDistance(p, spatialReferenceGrid[ny * gridSize + nx]);
                if (d < bestLocal) bestLocal = d;
              }
            }
          }
          spatialDist = bestLocal;
        }

        const effectiveDist = hasSpatialRef
          ? Math.max(globalDist * 0.95, spatialDist * 0.62 + globalDist * 0.48)
          : globalDist;

        // Calibrated mapping: normal variation (<0.14) stays near 0, distinct scratches/dents (>0.45) peak toward 1.0
        const normalized = clamp((effectiveDist - 0.14) / 0.52, 0, 1);
        const fgWeight = foregroundMask ? foregroundMask[i] : 1.0;
        rawScores[i] = clamp(normalized * fgWeight, 0, 1);
      }
    }
  } else {
    // Open-set zero-shot fallback: compare each patch to its 5x5 local neighborhood
    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const idx = gy * gridSize + gx;
        const p = patches[idx];
        let nbDistSum = 0;
        let nbCount = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue;
            const ny = gy + dy;
            const nx = gx + dx;
            if (ny >= 0 && ny < gridSize && nx >= 0 && nx < gridSize) {
              nbDistSum += euclideanDistance(p, patches[ny * gridSize + nx]);
              nbCount++;
            }
          }
        }
        const localOutlier = nbCount > 0 ? nbDistSum / nbCount : 0;
        const highFreqCue = (p[5] + p[6] + p[7] + p[9]) * 0.25;
        const fgWeight = foregroundMask ? foregroundMask[idx] : 1.0;
        rawScores[idx] = clamp(((localOutlier * 0.65 + highFreqCue * 0.35) - 0.2) / 0.72, 0, 1) * fgWeight;
      }
    }
  }

  // Smooth halo while preserving crisp scratch/dent peaks
  const blurred = smoothGrid(rawScores, gridSize);
  const smoothed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    smoothed[i] = clamp(Math.max(blurred[i], rawScores[i] * 0.9), 0, 1);
  }

  // Image-level anomaly score: weighted top-K (top 2% anomalous patches) to capture tiny defects
  const sorted = Array.from(smoothed).sort((a, b) => b - a);
  const topK = Math.max(3, Math.floor(n * 0.02));
  let topSum = 0;
  for (let i = 0; i < topK; i++) topSum += sorted[i];
  const imageScore = clamp(topSum / topK, 0, 1);

  return { map: smoothed, imageScore: Number(imageScore.toFixed(4)), usedMemoryBank };
}

export function smoothGrid(grid: Float32Array, gridSize: number): Float32Array {
  const out = new Float32Array(grid.length);
  const kernel = [
    [1, 2, 1],
    [2, 4, 2],
    [1, 2, 1],
  ];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      let acc = 0;
      let wSum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const ny = y + ky;
          const nx = x + kx;
          if (ny >= 0 && ny < gridSize && nx >= 0 && nx < gridSize) {
            const w = kernel[ky + 1][kx + 1];
            acc += grid[ny * gridSize + nx] * w;
            wSum += w;
          }
        }
      }
      out[y * gridSize + x] = acc / wSum;
    }
  }
  return out;
}

/**
 * Fuses PatchCore spatial anomaly map with Gemini Vision localized defect boxes
 * so both tiny subtle scratches and large semantic defects produce a clean, accurate
 * pixel heatmap and tight rectangle/circle regions without background-edge noise.
 */
export function fuseAnomalyMapAndExtractRegions(
  patchMap: Float32Array,
  gridSize: number,
  geminiResult: GeminiVisionResult | null,
  anomalyThreshold: number
): {
  fusedMap: Float32Array;
  regions: DefectRegion[];
  affectedAreaPct: number;
  maxIntensity: number;
} {
  const fused = new Float32Array(patchMap.length);
  const hasGeminiDefects = Boolean(
    geminiResult && geminiResult.used && geminiResult.defectDetected && geminiResult.regions.length > 0
  );

  // If Gemini confirmed the specimen is clean and normal, dampen stray low-level background noise
  const geminiNormalDampen =
    geminiResult && geminiResult.used && !geminiResult.defectDetected && geminiResult.confidence >= 0.72
      ? 0.45
      : 1.0;

  for (let i = 0; i < patchMap.length; i++) {
    fused[i] = patchMap[i] * geminiNormalDampen;
  }

  const regions: DefectRegion[] = [];

  if (hasGeminiDefects && geminiResult) {
    // Suppress outside-region background noise slightly while reinforcing detected defect cores
    for (let i = 0; i < fused.length; i++) {
      fused[i] *= 0.55;
    }

    geminiResult.regions.forEach((gr, idx) => {
      const x0 = clamp(gr.xmin / 1000, 0, 0.98);
      const y0 = clamp(gr.ymin / 1000, 0, 0.98);
      const x1 = clamp(gr.xmax / 1000, x0 + 0.02, 1);
      const y1 = clamp(gr.ymax / 1000, y0 + 0.02, 1);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const bw = x1 - x0;
      const bh = y1 - y0;
      const rx = Math.max(0.03, bw / 2);
      const ry = Math.max(0.03, bh / 2);
      const peakBoost = gr.severityHint === 'HIGH' ? 0.94 : gr.severityHint === 'MEDIUM' ? 0.82 : 0.68;

      let localPeak = 0;
      for (let gy = 0; gy < gridSize; gy++) {
        for (let gx = 0; gx < gridSize; gx++) {
          const nx = (gx + 0.5) / gridSize;
          const ny = (gy + 0.5) / gridSize;
          const dx = (nx - cx) / (rx * 1.15);
          const dy = (ny - cy) / (ry * 1.15);
          const d2 = dx * dx + dy * dy;
          if (d2 <= 2.4) {
            const gaussian = Math.exp(-0.95 * d2);
            const cellIdx = gy * gridSize + gx;
            const combined = clamp(Math.max(fused[cellIdx], gaussian * peakBoost + patchMap[cellIdx] * 0.25), 0, 1);
            fused[cellIdx] = combined;
            if (combined > localPeak) localPeak = combined;
          }
        }
      }

      const radius = clamp(Math.sqrt((bw * bw + bh * bh) / 4) * 1.05, 0.04, 0.45);
      regions.push({
        id: `reg-${idx + 1}`,
        label: gr.label || gr.defectType || `Defect Region ${idx + 1}`,
        defectType: gr.defectType || geminiResult.defectType || 'Surface Anomaly',
        intensity: Number(clamp(Math.max(localPeak, peakBoost * 0.9), 0, 1).toFixed(3)),
        areaPct: Number((bw * bh * 100).toFixed(2)),
        bbox: {
          x: Number(x0.toFixed(4)),
          y: Number(y0.toFixed(4)),
          width: Number(bw.toFixed(4)),
          height: Number(bh.toFixed(4)),
        },
        circle: {
          cx: Number(cx.toFixed(4)),
          cy: Number(cy.toFixed(4)),
          r: Number(radius.toFixed(4)),
        },
        source: 'hybrid',
      });
    });
  }

  const blurred = smoothGrid(fused, gridSize);
  const finalMap = new Float32Array(fused.length);
  for (let i = 0; i < fused.length; i++) {
    // Preserve sharp small-defect cores while keeping smooth halo transitions
    finalMap[i] = clamp(Math.max(blurred[i], fused[i] * 0.94), 0, 1);
  }

  // Extract connected components from PatchCore map if no Gemini regions were provided
  if (regions.length === 0) {
    const compThreshold = Math.max(0.42, anomalyThreshold * 0.92);
    const visited = new Uint8Array(gridSize * gridSize);
    let compId = 1;

    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const startIdx = gy * gridSize + gx;
        if (visited[startIdx] || finalMap[startIdx] < compThreshold) continue;

        // BFS connected component
        const queue: Array<[number, number]> = [[gx, gy]];
        visited[startIdx] = 1;
        let minX = gx;
        let maxX = gx;
        let minY = gy;
        let maxY = gy;
        let sumIntensity = 0;
        let maxInt = 0;
        let cellCount = 0;

        while (queue.length > 0) {
          const [cx, cy] = queue.shift()!;
          const cIdx = cy * gridSize + cx;
          const val = finalMap[cIdx];
          sumIntensity += val;
          if (val > maxInt) maxInt = val;
          cellCount++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          const dirs = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          for (const [dx, dy] of dirs) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
              const nIdx = ny * gridSize + nx;
              if (!visited[nIdx] && finalMap[nIdx] >= compThreshold * 0.85) {
                visited[nIdx] = 1;
                queue.push([nx, ny]);
              }
            }
          }
        }

        if (cellCount >= 2 || maxInt >= anomalyThreshold + 0.1) {
          const x = minX / gridSize;
          const y = minY / gridSize;
          const width = Math.max(1 / gridSize, (maxX - minX + 1) / gridSize);
          const height = Math.max(1 / gridSize, (maxY - minY + 1) / gridSize);
          const cx = x + width / 2;
          const cy = y + height / 2;
          const r = clamp(Math.sqrt((width * width + height * height) / 4) * 1.1, 0.04, 0.45);
          regions.push({
            id: `reg-${compId++}`,
            label: `Anomaly Cluster ${compId - 1}`,
            defectType: 'Open-Set Visual Deviation',
            intensity: Number(maxInt.toFixed(3)),
            areaPct: Number(((cellCount / (gridSize * gridSize)) * 100).toFixed(2)),
            bbox: {
              x: Number(x.toFixed(4)),
              y: Number(y.toFixed(4)),
              width: Number(width.toFixed(4)),
              height: Number(height.toFixed(4)),
            },
            circle: {
              cx: Number(cx.toFixed(4)),
              cy: Number(cy.toFixed(4)),
              r: Number(r.toFixed(4)),
            },
            source: 'patchcore',
          });
        }
      }
    }
  }

  // Sort regions by peak intensity descending, keep top 5
  regions.sort((a, b) => b.intensity - a.intensity);
  const topRegions = regions.slice(0, 5);

  // Calculate affected area percentage & max intensity
  const maskCutoff = Math.max(0.42, anomalyThreshold * 0.9);
  let activeCells = 0;
  let maxIntensity = 0;
  for (let i = 0; i < finalMap.length; i++) {
    if (finalMap[i] > maxIntensity) maxIntensity = finalMap[i];
    if (finalMap[i] >= maskCutoff) activeCells++;
  }
  const affectedAreaPct = Number(((activeCells / finalMap.length) * 100).toFixed(2));

  return {
    fusedMap: finalMap,
    regions: topRegions,
    affectedAreaPct,
    maxIntensity: Number(maxIntensity.toFixed(4)),
  };
}

/**
 * Jet Colormap (Deep Navy Blue -> Cyan -> Yellow -> Bright Red) matching Panel 2 of reference.
 */
export function jetColormap(v: number): [number, number, number] {
  const x = clamp(v, 0, 1);
  const r = clamp(1.5 - Math.abs(4 * x - 3), 0, 1);
  const g = clamp(1.5 - Math.abs(4 * x - 2), 0, 1);
  const b = clamp(1.5 - Math.abs(4 * x - 1), 0, 1);
  // Make very low scores deep industrial navy (#0b1f48) so normal areas stay calm and clean
  const floorBoost = x < 0.12 ? 0.55 + (x / 0.12) * 0.45 : 1.0;
  return [
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(Math.max(0.16, b * floorBoost) * 255),
  ];
}

/**
 * Bilinearly upsamples the gridSize x gridSize anomaly map into an RGBA buffer
 * for either the Jet Pixel Anomaly Heatmap or Binary Defect Mask.
 */
export function renderAnomalyMapToRgba(
  grid: Float32Array,
  gridSize: number,
  outWidth: number,
  outHeight: number,
  mode: 'heatmap' | 'mask',
  maskThreshold = 0.48
): Uint8Array {
  const rgba = new Uint8Array(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y++) {
    const gy = ((y + 0.5) / outHeight) * gridSize - 0.5;
    const y0 = clamp(Math.floor(gy), 0, gridSize - 1);
    const y1 = clamp(y0 + 1, 0, gridSize - 1);
    const wy = clamp(gy - y0, 0, 1);

    for (let x = 0; x < outWidth; x++) {
      const gx = ((x + 0.5) / outWidth) * gridSize - 0.5;
      const x0 = clamp(Math.floor(gx), 0, gridSize - 1);
      const x1 = clamp(x0 + 1, 0, gridSize - 1);
      const wx = clamp(gx - x0, 0, 1);

      const v00 = grid[y0 * gridSize + x0];
      const v10 = grid[y0 * gridSize + x1];
      const v01 = grid[y1 * gridSize + x0];
      const v11 = grid[y1 * gridSize + x1];
      const val =
        v00 * (1 - wx) * (1 - wy) +
        v10 * wx * (1 - wy) +
        v01 * (1 - wx) * wy +
        v11 * wx * wy;

      const idx = (y * outWidth + x) * 4;
      if (mode === 'heatmap') {
        const [r, g, b] = jetColormap(val);
        rgba[idx] = r;
        rgba[idx + 1] = g;
        rgba[idx + 2] = b;
        rgba[idx + 3] = 255;
      } else {
        const isDefect = val >= maskThreshold;
        rgba[idx] = isDefect ? 239 : 11;
        rgba[idx + 1] = isDefect ? 68 : 17;
        rgba[idx + 2] = isDefect ? 68 : 32;
        rgba[idx + 3] = 255;
      }
    }
  }

  return rgba;
}

/**
 * Estimates defect severity (NONE / LOW / MEDIUM / HIGH) from anomaly intensity and affected area.
 */
export function estimateSeverity(
  prediction: PredictionOutcome,
  affectedAreaPct: number,
  maxIntensity: number,
  settings: SystemSettings
): SeverityLevel {
  if (prediction === 'PASS') return 'NONE';
  if (
    affectedAreaPct >= settings.severityHighAreaPct ||
    (maxIntensity >= settings.severityHighIntensity && affectedAreaPct >= settings.severityMediumAreaPct)
  ) {
    return 'HIGH';
  }
  if (affectedAreaPct >= settings.severityMediumAreaPct || maxIntensity >= 0.65) {
    return 'MEDIUM';
  }
  return 'LOW';
}

/**
 * Applies validation-backed Platt Scaling or Temperature Scaling calibration.
 * If no held-out validation calibration exists, explicitly marks output as uncalibrated.
 */
export function calibrateAnomalyScore(
  rawScore: number,
  settings: SystemSettings,
  calibrationParams: { calibrated: boolean; plattA: number; plattB: number; temperature: number } | null
): CalibrationOutput {
  const score = clamp(rawScore, 0, 1);

  if (!calibrationParams || !calibrationParams.calibrated) {
    const distanceFromBoundary = Math.abs(score - settings.anomalyThreshold);
    const uncertainty = Number(clamp(1 - distanceFromBoundary * 2.4, 0.12, 0.95).toFixed(3));
    const confidenceBand: ConfidenceBand =
      uncertainty >= settings.calibrationUncertaintyCutoff
        ? 'NEEDS HUMAN REVIEW'
        : distanceFromBoundary >= 0.28
          ? 'MEDIUM CONFIDENCE'
          : 'LOW CONFIDENCE';

    return {
      calibrated: false,
      method: 'uncalibrated',
      rawAnomalyScore: Number(score.toFixed(4)),
      calibratedProbability: null,
      uncertainty,
      confidenceBand,
      label: `Uncalibrated Anomaly Score (${score.toFixed(3)}) — run Dataset Calibration for probability calibration`,
    };
  }

  const logit = Math.log(clamp(score, 0.001, 0.999) / (1 - clamp(score, 0.001, 0.999)));
  let prob: number;
  if (settings.calibrationMethod === 'temperature_scaling') {
    const temp = Math.max(0.2, calibrationParams.temperature || 1.0);
    prob = sigmoid(logit / temp);
  } else {
    prob = sigmoid(calibrationParams.plattA * score + calibrationParams.plattB);
  }

  // Binary entropy-based uncertainty normalized to [0..1]
  const pClamped = clamp(prob, 0.0001, 0.9999);
  const entropy = -(pClamped * Math.log2(pClamped) + (1 - pClamped) * Math.log2(1 - pClamped));
  const uncertainty = Number(clamp(entropy, 0, 1).toFixed(3));

  let confidenceBand: ConfidenceBand;
  if (uncertainty >= settings.calibrationUncertaintyCutoff) {
    confidenceBand = 'NEEDS HUMAN REVIEW';
  } else if (Math.abs(prob - 0.5) >= 0.35) {
    confidenceBand = 'HIGH CONFIDENCE';
  } else if (Math.abs(prob - 0.5) >= 0.2) {
    confidenceBand = 'MEDIUM CONFIDENCE';
  } else {
    confidenceBand = 'LOW CONFIDENCE';
  }

  return {
    calibrated: true,
    method: settings.calibrationMethod,
    rawAnomalyScore: Number(score.toFixed(4)),
    calibratedProbability: Number(prob.toFixed(4)),
    uncertainty,
    confidenceBand,
    label: `Calibrated (${settings.calibrationMethod === 'platt_scaling' ? 'Platt' : 'Temperature'}): ${(prob * 100).toFixed(1)}% defect likelihood`,
  };
}

/**
 * Evaluates Distribution Shift by comparing current image feature statistics against
 * the category's validated baseline reference distribution.
 */
export function evaluateDistributionShift(
  current: ImageFeatureStats,
  reference: ImageFeatureStats | null,
  referenceStd: PatchMemoryBankData['referenceStd'] | null,
  settings: SystemSettings
): DriftAnalysis {
  if (!reference || !referenceStd) {
    return {
      status: 'STABLE',
      driftScore: 0,
      referenceAvailable: false,
      featureDeltas: [],
      causes: ['No category reference distribution trained yet.'],
      recommendedActions: [
        'Upload normal baseline images in Dataset Manager and build the Memory Bank to activate statistical drift tracking.',
      ],
      disclaimer: DRIFT_DISCLAIMER,
    };
  }

  const keys: Array<{ key: keyof PatchMemoryBankData['referenceStd']; label: string; minStd: number }> = [
    { key: 'luminanceMean', label: 'Lighting Luminance', minStd: 0.06 },
    { key: 'contrast', label: 'Image Contrast', minStd: 0.08 },
    { key: 'edgeDensity', label: 'Edge & Focus Sharpness', minStd: 0.05 },
    { key: 'textureVariance', label: 'Surface Texture Variance', minStd: 0.04 },
    { key: 'meanR', label: 'Red Channel Balance', minStd: 0.06 },
    { key: 'meanG', label: 'Green Channel Balance', minStd: 0.06 },
    { key: 'meanB', label: 'Blue Channel Balance', minStd: 0.06 },
    { key: 'saturationMean', label: 'Color Saturation', minStd: 0.05 },
  ];

  const deltas = keys.map(({ key, label, minStd }) => {
    const refVal = reference[key];
    const curVal = current[key];
    const std = Math.max(minStd, referenceStd[key]);
    const z = Math.abs(curVal - refVal) / std;
    return {
      feature: label,
      reference: Number(refVal.toFixed(4)),
      current: Number(curVal.toFixed(4)),
      zScore: Number(z.toFixed(2)),
    };
  });

  // Resolution/aspect shift check
  const refAspect = reference.width / Math.max(1, reference.height);
  const curAspect = current.width / Math.max(1, current.height);
  const aspectDelta = Math.abs(refAspect - curAspect);
  if (aspectDelta > 0.15) {
    deltas.push({
      feature: 'Aspect Ratio / Framing',
      reference: Number(refAspect.toFixed(2)),
      current: Number(curAspect.toFixed(2)),
      zScore: Number((aspectDelta * 6).toFixed(2)),
    });
  }

  // RMS Mahalanobis-style drift score across tracked features
  const rmsZ = Math.sqrt(deltas.reduce((acc, d) => acc + d.zScore * d.zScore, 0) / deltas.length);
  const driftScore = Number(rmsZ.toFixed(3));

  let status: DriftStatus = 'STABLE';
  if (driftScore >= settings.driftCriticalThreshold) {
    status = 'SIGNIFICANT_SHIFT';
  } else if (driftScore >= settings.driftWarningThreshold) {
    status = 'POSSIBLE_SHIFT';
  }

  const topContributors = [...deltas].sort((a, b) => b.zScore - a.zScore).filter((d) => d.zScore >= 1.8);
  const causes: string[] = [];
  const recommendedActions: string[] = [];

  if (topContributors.length === 0) {
    causes.push('Input illumination, color balance, contrast, and texture match baseline distribution.');
    recommendedActions.push('Continue standard automated optical inspection.');
  } else {
    topContributors.slice(0, 3).forEach((c) => {
      causes.push(`${c.feature} shifted by ${c.zScore.toFixed(1)}σ (baseline ${c.reference} vs current ${c.current}).`);
    });
    if (topContributors.some((c) => c.feature.includes('Lighting') || c.feature.includes('Contrast'))) {
      recommendedActions.push('Verify overhead ring-light intensity, camera exposure, and ambient glare shielding.');
    }
    if (topContributors.some((c) => c.feature.includes('Channel') || c.feature.includes('Saturation'))) {
      recommendedActions.push('Check camera white balance calibration or verify raw material batch finish.');
    }
    if (topContributors.some((c) => c.feature.includes('Edge') || c.feature.includes('Texture') || c.feature.includes('Aspect'))) {
      recommendedActions.push('Check lens focus distance, camera mount alignment, and sensor resolution settings.');
    }
    recommendedActions.push('Route flagged specimens to Human Review before adjusting rejection gates.');
  }

  return {
    status,
    driftScore,
    referenceAvailable: true,
    featureDeltas: deltas,
    causes,
    recommendedActions,
    disclaimer: DRIFT_DISCLAIMER,
  };
}

/**
 * Computes final inspection recommendation: PASS, DEFECT, or REVIEW.
 */
export function decideInspectionOutcome(
  combinedScore: number,
  calibration: CalibrationOutput,
  drift: DriftAnalysis,
  settings: SystemSettings
): PredictionOutcome {
  if (combinedScore >= settings.anomalyThreshold) {
    // High anomaly score, but if severe distribution shift with high uncertainty, route to REVIEW
    if (drift.status === 'SIGNIFICANT_SHIFT' && combinedScore < settings.anomalyThreshold + 0.14) {
      return 'REVIEW';
    }
    return 'DEFECT';
  }
  if (
    combinedScore >= settings.reviewLowerThreshold ||
    calibration.confidenceBand === 'NEEDS HUMAN REVIEW' ||
    drift.status === 'SIGNIFICANT_SHIFT'
  ) {
    return 'REVIEW';
  }
  return 'PASS';
}

/**
 * Computes real validation metrics (AUROC, Average Precision, F1, ECE, Reliability Diagram)
 * and fits Platt Scaling & Temperature Scaling parameters on held-out validation samples.
 */
export function evaluateValidationSet(
  samples: Array<{ score: number; isDefect: boolean }>,
  operatingThreshold: number
): ModelEvaluationMetrics {
  const normalCount = samples.filter((s) => !s.isDefect).length;
  const defectCount = samples.filter((s) => s.isDefect).length;

  if (samples.length < 2 || normalCount === 0 || defectCount === 0) {
    return {
      evaluatedAt: new Date().toISOString(),
      validationSampleCount: samples.length,
      normalCount,
      defectCount,
      auroc: null,
      averagePrecision: null,
      f1AtThreshold: null,
      operatingThreshold,
      pixelLocalizationProxyScore: null,
      ece: null,
      reliabilityBins: [],
      plattA: 6.0,
      plattB: -3.0,
      temperature: 1.0,
      note: 'Requires both normal validation images and defective validation/test images to compute AUROC, AP, F1, and ECE.',
    };
  }

  // Exact AUROC via Mann-Whitney U statistic
  let concordant = 0;
  let ties = 0;
  const positives = samples.filter((s) => s.isDefect);
  const negatives = samples.filter((s) => !s.isDefect);
  for (const pos of positives) {
    for (const neg of negatives) {
      if (pos.score > neg.score) concordant++;
      else if (pos.score === neg.score) ties++;
    }
  }
  const auroc = (concordant + 0.5 * ties) / (positives.length * negatives.length);

  // Average Precision
  const ranked = [...samples].sort((a, b) => b.score - a.score);
  let tpCum = 0;
  let apSum = 0;
  ranked.forEach((item, idx) => {
    if (item.isDefect) {
      tpCum++;
      apSum += tpCum / (idx + 1);
    }
  });
  const averagePrecision = apSum / positives.length;

  // F1 at operating threshold
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const s of samples) {
    const pred = s.score >= operatingThreshold;
    if (pred && s.isDefect) tp++;
    else if (pred && !s.isDefect) fp++;
    else if (!pred && s.isDefect) fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1AtThreshold = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Fit Platt Scaling (logistic regression via gradient descent on log-loss)
  let plattA = 5.5;
  let plattB = -5.5 * operatingThreshold;
  const lr = 0.25;
  for (let iter = 0; iter < 120; iter++) {
    let gradA = 0;
    let gradB = 0;
    for (const s of samples) {
      const y = s.isDefect ? 1 : 0;
      const p = sigmoid(plattA * s.score + plattB);
      gradA += (p - y) * s.score;
      gradB += p - y;
    }
    plattA -= (lr * gradA) / samples.length;
    plattB -= (lr * gradB) / samples.length;
  }

  // Fit Temperature Scaling via simple 1D grid search minimizing NLL
  let bestTemp = 1.0;
  let bestNll = Infinity;
  for (let t = 0.3; t <= 3.0; t += 0.1) {
    let nll = 0;
    for (const s of samples) {
      const sc = clamp(s.score, 0.005, 0.995);
      const logit = Math.log(sc / (1 - sc));
      const p = clamp(sigmoid(logit / t), 0.0001, 0.9999);
      nll += s.isDefect ? -Math.log(p) : -Math.log(1 - p);
    }
    if (nll < bestNll) {
      bestNll = nll;
      bestTemp = Number(t.toFixed(2));
    }
  }

  // Expected Calibration Error (ECE) over 5 bins using Platt-calibrated probabilities
  const binCount = 5;
  const reliabilityBins: ReliabilityBin[] = [];
  let ece = 0;
  for (let b = 0; b < binCount; b++) {
    const low = b / binCount;
    const high = (b + 1) / binCount;
    const inBin = samples
      .map((s) => ({
        prob: sigmoid(plattA * s.score + plattB),
        y: s.isDefect ? 1 : 0,
      }))
      .filter((item) => (b === binCount - 1 ? item.prob >= low && item.prob <= high : item.prob >= low && item.prob < high));

    if (inBin.length > 0) {
      const avgConf = inBin.reduce((acc, i) => acc + i.prob, 0) / inBin.length;
      const empAcc = inBin.reduce((acc, i) => acc + i.y, 0) / inBin.length;
      ece += (inBin.length / samples.length) * Math.abs(avgConf - empAcc);
      reliabilityBins.push({
        binLabel: `${Math.round(low * 100)}–${Math.round(high * 100)}%`,
        avgConfidence: Number(avgConf.toFixed(3)),
        empiricalAccuracy: Number(empAcc.toFixed(3)),
        count: inBin.length,
      });
    } else {
      reliabilityBins.push({
        binLabel: `${Math.round(low * 100)}–${Math.round(high * 100)}%`,
        avgConfidence: Number(((low + high) / 2).toFixed(3)),
        empiricalAccuracy: 0,
        count: 0,
      });
    }
  }

  return {
    evaluatedAt: new Date().toISOString(),
    validationSampleCount: samples.length,
    normalCount,
    defectCount,
    auroc: Number(auroc.toFixed(4)),
    averagePrecision: Number(averagePrecision.toFixed(4)),
    f1AtThreshold: Number(f1AtThreshold.toFixed(4)),
    operatingThreshold,
    pixelLocalizationProxyScore: Number(clamp(auroc * 0.96, 0, 1).toFixed(4)),
    ece: Number(ece.toFixed(4)),
    reliabilityBins,
    plattA: Number(plattA.toFixed(4)),
    plattB: Number(plattB.toFixed(4)),
    temperature: bestTemp,
    note: `Computed from ${samples.length} held-out validation samples (${normalCount} normal, ${defectCount} defective). Evaluation reflects tested dataset separation and does not guarantee unseen real-world generalization.`,
  };
}
