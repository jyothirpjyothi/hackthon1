export type PredictionOutcome = 'PASS' | 'DEFECT' | 'REVIEW';
export type SeverityLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type ConfidenceBand =
  | 'HIGH CONFIDENCE'
  | 'MEDIUM CONFIDENCE'
  | 'LOW CONFIDENCE'
  | 'NEEDS HUMAN REVIEW';
export type DriftStatus = 'STABLE' | 'POSSIBLE_SHIFT' | 'SIGNIFICANT_SHIFT';
export type ReviewStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'APPROVED_NORMAL'
  | 'CONFIRMED_DEFECT'
  | 'FALSE_POSITIVE';
export type LocalizationShape = 'rectangle' | 'circle';
export type UserRole = 'Admin' | 'Engineer' | 'Operator';
export type DatasetSplit = 'train_normal' | 'val_normal' | 'val_defect' | 'test_defect';

export const PRODUCT_CATEGORIES = [
  'Metal Nut',
  'Transistor',
  'Tile',
  'Cable',
  'Bottle',
  'Screw',
  'Industrial Surface',
  'Capsule',
  'Pill',
  'Wood',
  'Zipper',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export interface DefectRegion {
  id: string;
  label: string;
  defectType: string;
  intensity: number; // 0..1
  areaPct: number; // percentage of image area
  bbox: {
    x: number; // 0..1 normalized
    y: number; // 0..1 normalized
    width: number; // 0..1 normalized
    height: number; // 0..1 normalized
  };
  circle: {
    cx: number; // 0..1 normalized
    cy: number; // 0..1 normalized
    r: number; // 0..1 normalized radius
  };
  source: 'hybrid' | 'patchcore' | 'gemini_vision';
}

export interface ImageFeatureStats {
  meanR: number;
  meanG: number;
  meanB: number;
  luminanceMean: number;
  luminanceStd: number;
  contrast: number;
  edgeDensity: number;
  textureVariance: number;
  saturationMean: number;
  width: number;
  height: number;
}

export interface DriftAnalysis {
  status: DriftStatus;
  driftScore: number;
  referenceAvailable: boolean;
  featureDeltas: Array<{
    feature: string;
    reference: number;
    current: number;
    zScore: number;
  }>;
  causes: string[];
  recommendedActions: string[];
  disclaimer: string;
}

export interface CalibrationOutput {
  calibrated: boolean;
  method: 'platt_scaling' | 'temperature_scaling' | 'uncalibrated';
  rawAnomalyScore: number;
  calibratedProbability: number | null;
  uncertainty: number;
  confidenceBand: ConfidenceBand;
  label: string;
}

export interface GeminiVisionResult {
  used: boolean;
  model: string | null;
  error: string | null;
  defectDetected: boolean;
  defectType: string;
  confidence: number;
  explanation: string;
  regions: Array<{
    label: string;
    defectType: string;
    ymin: number; // 0..1000
    xmin: number;
    ymax: number;
    xmax: number;
    severityHint: 'LOW' | 'MEDIUM' | 'HIGH';
  }>;
}

export interface InspectionRecord {
  id: string;
  category: string;
  filename: string;
  imageHash: string;
  createdAt: string;
  processingTimeMs: number;
  prediction: PredictionOutcome;
  anomalyScore: number;
  patchCoreScore: number;
  geminiScore: number | null;
  severity: SeverityLevel;
  severityDisclaimer: string;
  affectedAreaPct: number;
  maxIntensity: number;
  defectType: string;
  explanation: string;
  engineMode: 'hybrid_patchcore_gemini' | 'patchcore_memory_bank' | 'patchcore_self_similarity';
  memoryBankUsed: boolean;
  calibration: CalibrationOutput;
  drift: DriftAnalysis;
  reviewStatus: ReviewStatus;
  reviewerNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  regions: DefectRegion[];
  featureStats: ImageFeatureStats;
  geminiMeta: {
    used: boolean;
    model: string | null;
    error: string | null;
  };
  assets: {
    originalUrl: string;
    heatmapUrl: string;
    maskUrl: string;
  };
  batchId: string | null;
  source: 'upload' | 'batch' | 'webcam' | 'sample';
}

export interface SystemSettings {
  anomalyThreshold: number; // default 0.48
  reviewLowerThreshold: number; // default 0.36
  severityLowAreaPct: number; // default 1.5
  severityMediumAreaPct: number; // default 5.0
  severityHighAreaPct: number; // default 12.0
  severityHighIntensity: number; // default 0.78
  driftWarningThreshold: number; // default 2.2
  driftCriticalThreshold: number; // default 3.8
  calibrationUncertaintyCutoff: number; // default 0.35
  preprocessingSize: number; // 256 | 320 | 384
  defaultMarkerShape: LocalizationShape;
  foregroundSuppression: boolean;
  useGeminiVision: boolean;
  calibrationMethod: 'platt_scaling' | 'temperature_scaling';
  activeModelArchitecture: 'PatchCore + Gemini Vision Hybrid' | 'PatchCore Multi-Scale' | 'EfficientAD Lightweight';
}

export interface DatasetImageRecord {
  id: string;
  category: string;
  split: DatasetSplit;
  filename: string;
  imageHash: string;
  imageUrl: string;
  width: number;
  height: number;
  lighting: string;
  cameraAngle: string;
  background: string;
  createdAt: string;
}

export interface ReliabilityBin {
  binLabel: string;
  avgConfidence: number;
  empiricalAccuracy: number;
  count: number;
}

export interface ModelEvaluationMetrics {
  evaluatedAt: string;
  validationSampleCount: number;
  normalCount: number;
  defectCount: number;
  auroc: number | null;
  averagePrecision: number | null;
  f1AtThreshold: number | null;
  operatingThreshold: number;
  pixelLocalizationProxyScore: number | null;
  ece: number | null;
  reliabilityBins: ReliabilityBin[];
  plattA: number;
  plattB: number;
  temperature: number;
  note: string;
}

export interface CategoryModelStatus {
  category: string;
  trainedAt: string | null;
  normalImageCount: number;
  coresetPatchCount: number;
  referenceFeatureStats: ImageFeatureStats | null;
  calibrationReady: boolean;
  evaluation: ModelEvaluationMetrics | null;
  version: string;
}

export interface AnalyticsOverview {
  totalInspected: number;
  normalCount: number;
  defectCount: number;
  reviewCount: number;
  highSeverityCount: number;
  mediumSeverityCount: number;
  lowSeverityCount: number;
  falsePositiveCount: number;
  confirmedDefectCount: number;
  humanReviewedCount: number;
  pendingReviewCount: number;
  falsePositiveRatePct: number;
  defectDetectionRatePct: number;
  driftAlertCount: number;
  performance: {
    avgTimeMs: number;
    fastestTimeMs: number;
    slowestTimeMs: number;
    totalProcessed: number;
    imagesPerMinute: number;
    batchCount: number;
  };
  confidenceDistribution: Array<{ band: ConfidenceBand; count: number }>;
  categoryStats: Array<{
    category: string;
    total: number;
    normal: number;
    defect: number;
    review: number;
    defectRatePct: number;
    avgScore: number;
  }>;
  trends: Array<{
    bucket: string;
    total: number;
    normal: number;
    defect: number;
    review: number;
    falsePositives: number;
  }>;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  details: string;
  createdAt: string;
}

export interface IndustrialRule {
  id: string;
  name: string;
  category: string;
  maxAnomalyScore: number;
  autoRejectSeverity: SeverityLevel;
  consecutiveDefectAlertCount: number;
  enabled: boolean;
  updatedAt: string;
}

export interface IndustrialEvent {
  id: string;
  timestamp: string;
  lineName: string;
  cameraAdapter: string;
  eventType: 'INSPECTION_PASS' | 'DEFECT_REJECT' | 'DRIFT_WARNING' | 'LINE_ALERT' | 'CAMERA_STATUS';
  message: string;
  inspectionId: string | null;
}

export interface SampleSpecimen {
  id: string;
  name: string;
  category: ProductCategory;
  expectedCondition: 'Normal' | 'Defective';
  description: string;
  imageUrl: string;
}
