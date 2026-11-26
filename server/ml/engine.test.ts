import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
  jetColormap,
  scorePatchAnomalyMap,
} from './engine';
import type { SystemSettings } from '../../src/types/prometheus';

const TEST_SETTINGS: SystemSettings = {
  anomalyThreshold: 0.48,
  reviewLowerThreshold: 0.34,
  severityLowAreaPct: 1.5,
  severityMediumAreaPct: 5.0,
  severityHighAreaPct: 12.0,
  severityHighIntensity: 0.78,
  driftWarningThreshold: 2.2,
  driftCriticalThreshold: 3.8,
  calibrationUncertaintyCutoff: 0.42,
  preprocessingSize: 64,
  defaultMarkerShape: 'rectangle',
  foregroundSuppression: true,
  useGeminiVision: false,
  calibrationMethod: 'platt_scaling',
  activeModelArchitecture: 'PatchCore Multi-Scale',
};

function makeSyntheticSpecimen(size: number, withDefect: boolean, brightnessOffset = 0): Uint8Array {
  const rgb = new Uint8Array(size * size * 3);
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 3;
      const dist = Math.hypot(x - cx, y - cy);
      let r = 45;
      let g = 48;
      let b = 52;
      // Metallic ring specimen in center
      if (dist >= size * 0.14 && dist <= size * 0.34) {
        r = 175;
        g = 178;
        b = 182;
      }
      // Sharp diagonal scratch & dent defect on metallic ring
      if (withDefect && x >= size * 0.34 && x <= size * 0.44 && y >= size * 0.34 && y <= size * 0.44) {
        r = 25;
        g = 15;
        b = 15;
      }
      rgb[idx] = Math.max(0, Math.min(255, r + brightnessOffset));
      rgb[idx + 1] = Math.max(0, Math.min(255, g + brightnessOffset));
      rgb[idx + 2] = Math.max(0, Math.min(255, b + brightnessOffset));
    }
  }
  return rgb;
}

test('PatchCore memory bank scores defective specimen higher than normal specimen', () => {
  const size = 64;
  const gridSize = 16;
  const normalImg = makeSyntheticSpecimen(size, false);
  const defectImg = makeSyntheticSpecimen(size, true);

  const normalPatches = extractMultiScalePatchFeatures(normalImg, size, size, gridSize);
  const coreset = buildCoresetMemoryBank(normalPatches, 256);

  const normalFg = computeForegroundMask(normalImg, size, size, gridSize);
  const defectFg = computeForegroundMask(defectImg, size, size, gridSize);

  const defectPatches = extractMultiScalePatchFeatures(defectImg, size, size, gridSize);
  const normalResult = scorePatchAnomalyMap(normalPatches, gridSize, coreset, normalFg);
  const defectResult = scorePatchAnomalyMap(defectPatches, gridSize, coreset, defectFg);

  assert.equal(normalResult.usedMemoryBank, true);
  assert.equal(defectResult.usedMemoryBank, true);
  assert.ok(
    defectResult.imageScore > normalResult.imageScore + 0.15,
    `Expected defect score (${defectResult.imageScore}) to clearly exceed normal score (${normalResult.imageScore})`
  );
});

test('Foreground mask suppresses uniform background border cells', () => {
  const size = 64;
  const gridSize = 16;
  const img = makeSyntheticSpecimen(size, false);
  const mask = computeForegroundMask(img, size, size, gridSize);
  const cornerWeight = mask[0]; // top-left background border
  const ringWeight = mask[Math.floor(gridSize * 0.35) * gridSize + Math.floor(gridSize * 0.5)];
  assert.ok(ringWeight > cornerWeight * 2, `Expected ring foreground (${ringWeight}) >> border (${cornerWeight})`);
});

test('Hybrid map fusion generates valid rectangle and circle localization bounds', () => {
  const gridSize = 16;
  const baseMap = new Float32Array(gridSize * gridSize).fill(0.08);
  const fused = fuseAnomalyMapAndExtractRegions(
    baseMap,
    gridSize,
    {
      used: true,
      model: 'gemini-4-hydrogen',
      error: null,
      defectDetected: true,
      defectType: 'Scratch',
      confidence: 0.91,
      explanation: 'Clear diagonal scratch on upper-left face.',
      regions: [
        {
          label: 'Diagonal Scratch',
          defectType: 'Scratch',
          ymin: 300,
          xmin: 280,
          ymax: 460,
          xmax: 440,
          severityHint: 'HIGH',
        },
      ],
    },
    0.48
  );

  assert.equal(fused.regions.length, 1);
  const r = fused.regions[0];
  assert.ok(r.bbox.width > 0.1 && r.bbox.height > 0.1);
  assert.ok(r.circle.r > 0.05 && r.circle.cx > 0.25 && r.circle.cy > 0.25);
  assert.ok(fused.maxIntensity > 0.7);
});

test('Severity estimation distinguishes NONE, LOW, MEDIUM, and HIGH', () => {
  assert.equal(estimateSeverity('PASS', 10, 0.9, TEST_SETTINGS), 'NONE');
  assert.equal(estimateSeverity('DEFECT', 0.8, 0.55, TEST_SETTINGS), 'LOW');
  assert.equal(estimateSeverity('DEFECT', 6.0, 0.68, TEST_SETTINGS), 'MEDIUM');
  assert.equal(estimateSeverity('DEFECT', 15.0, 0.85, TEST_SETTINGS), 'HIGH');
});

test('Validation evaluation computes exact AUROC, F1, ECE, and Platt calibration', () => {
  const evalMetrics = evaluateValidationSet(
    [
      { score: 0.12, isDefect: false },
      { score: 0.18, isDefect: false },
      { score: 0.24, isDefect: false },
      { score: 0.78, isDefect: true },
      { score: 0.86, isDefect: true },
      { score: 0.92, isDefect: true },
    ],
    0.48
  );

  assert.equal(evalMetrics.auroc, 1);
  assert.equal(evalMetrics.f1AtThreshold, 1);
  assert.ok(evalMetrics.ece !== null && evalMetrics.ece >= 0 && evalMetrics.ece <= 1);
  assert.equal(evalMetrics.reliabilityBins.length, 5);

  const calHigh = calibrateAnomalyScore(0.9, TEST_SETTINGS, {
    calibrated: true,
    plattA: evalMetrics.plattA,
    plattB: evalMetrics.plattB,
    temperature: evalMetrics.temperature,
  });
  assert.equal(calHigh.calibrated, true);
  assert.ok((calHigh.calibratedProbability ?? 0) > 0.8);

  const uncal = calibrateAnomalyScore(0.72, TEST_SETTINGS, null);
  assert.equal(uncal.calibrated, false);
  assert.equal(uncal.calibratedProbability, null);
});

test('Distribution shift detector identifies significant lighting shift', () => {
  const normalImg = makeSyntheticSpecimen(64, false, 0);
  const brightShiftImg = makeSyntheticSpecimen(64, false, 75);
  const refStats = computeImageFeatureStats(normalImg, 64, 64);
  const curStats = computeImageFeatureStats(brightShiftImg, 64, 64);
  const refStd = {
    meanR: 0.04,
    meanG: 0.04,
    meanB: 0.04,
    luminanceMean: 0.04,
    luminanceStd: 0.04,
    contrast: 0.05,
    edgeDensity: 0.04,
    textureVariance: 0.04,
    saturationMean: 0.04,
  };

  const stable = evaluateDistributionShift(refStats, refStats, refStd, TEST_SETTINGS);
  const shifted = evaluateDistributionShift(curStats, refStats, refStd, TEST_SETTINGS);

  assert.equal(stable.status, 'STABLE');
  assert.ok(shifted.status === 'POSSIBLE_SHIFT' || shifted.status === 'SIGNIFICANT_SHIFT');
  assert.ok(shifted.driftScore > TEST_SETTINGS.driftWarningThreshold);

  const decision = decideInspectionOutcome(0.2, calibrateAnomalyScore(0.2, TEST_SETTINGS, null), shifted, TEST_SETTINGS);
  assert.ok(decision === 'REVIEW' || decision === 'PASS');
});

test('Jet colormap maps low intensity to deep blue and high intensity to red', () => {
  const [r0, , b0] = jetColormap(0.02);
  const [r1, , b1] = jetColormap(0.95);
  assert.ok(b0 > r0, 'Low anomaly intensity should be blue-dominant');
  assert.ok(r1 > b1, 'High anomaly intensity should be red-dominant');
});
