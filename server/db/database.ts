import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type {
  AnalyticsOverview,
  AuditLogEntry,
  AuthUser,
  CategoryModelStatus,
  ConfidenceBand,
  DatasetImageRecord,
  DatasetSplit,
  IndustrialEvent,
  IndustrialRule,
  InspectionRecord,
  ReviewStatus,
  SystemSettings,
  UserRole,
} from '../../src/types/prometheus';
import type { PatchMemoryBankData } from '../ml/engine';

export const DATA_ROOT = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_ROOT, 'uploads');
export const RESULTS_DIR = path.join(DATA_ROOT, 'results');
export const DATASETS_DIR = path.join(DATA_ROOT, 'datasets');
export const DB_PATH = path.join(DATA_ROOT, 'prometheus.db');

for (const dir of [DATA_ROOT, UPLOADS_DIR, RESULTS_DIR, DATASETS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const DEFAULT_SETTINGS: SystemSettings = {
  anomalyThreshold: 0.48,
  reviewLowerThreshold: 0.34,
  severityLowAreaPct: 1.5,
  severityMediumAreaPct: 5.0,
  severityHighAreaPct: 12.0,
  severityHighIntensity: 0.78,
  driftWarningThreshold: 2.2,
  driftCriticalThreshold: 3.8,
  calibrationUncertaintyCutoff: 0.42,
  preprocessingSize: 256,
  defaultMarkerShape: 'rectangle',
  foregroundSuppression: true,
  useGeminiVision: true,
  calibrationMethod: 'platt_scaling',
  activeModelArchitecture: 'PatchCore + Gemini Vision Hybrid',
};

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS inspections (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    filename TEXT NOT NULL,
    image_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    processing_time_ms REAL NOT NULL,
    prediction TEXT NOT NULL,
    anomaly_score REAL NOT NULL,
    patchcore_score REAL NOT NULL,
    gemini_score REAL,
    severity TEXT NOT NULL,
    affected_area_pct REAL NOT NULL,
    max_intensity REAL NOT NULL,
    defect_type TEXT NOT NULL,
    explanation TEXT NOT NULL,
    engine_mode TEXT NOT NULL,
    memory_bank_used INTEGER NOT NULL,
    calibration_json TEXT NOT NULL,
    drift_json TEXT NOT NULL,
    review_status TEXT NOT NULL,
    reviewer_notes TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    regions_json TEXT NOT NULL,
    feature_stats_json TEXT NOT NULL,
    gemini_meta_json TEXT NOT NULL,
    assets_json TEXT NOT NULL,
    batch_id TEXT,
    source TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_inspections_created_at ON inspections(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_inspections_category ON inspections(category);
  CREATE INDEX IF NOT EXISTS idx_inspections_review ON inspections(review_status);
  CREATE INDEX IF NOT EXISTS idx_inspections_hash ON inspections(image_hash);

  CREATE TABLE IF NOT EXISTS review_decisions (
    id TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    notes TEXT NOT NULL,
    reviewer TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(inspection_id) REFERENCES inspections(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS drift_events (
    id TEXT PRIMARY KEY,
    inspection_id TEXT,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    drift_score REAL NOT NULL,
    causes_json TEXT NOT NULL,
    actions_json TEXT NOT NULL,
    feature_deltas_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_drift_created_at ON drift_events(created_at DESC);

  CREATE TABLE IF NOT EXISTS dataset_images (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    split TEXT NOT NULL,
    filename TEXT NOT NULL,
    image_hash TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    lighting TEXT NOT NULL,
    camera_angle TEXT NOT NULL,
    background TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_dataset_cat_split ON dataset_images(category, split);

  CREATE TABLE IF NOT EXISTS memory_banks (
    category TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    trained_at TEXT NOT NULL,
    normal_image_count INTEGER NOT NULL,
    coreset_patch_count INTEGER NOT NULL,
    bank_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS model_versions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    architecture TEXT NOT NULL,
    category TEXT NOT NULL,
    version TEXT NOT NULL,
    dataset_name TEXT NOT NULL,
    input_size INTEGER NOT NULL,
    normal_samples INTEGER NOT NULL,
    evaluation_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS industrial_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    max_anomaly_score REAL NOT NULL,
    auto_reject_severity TEXT NOT NULL,
    consecutive_defect_alert_count INTEGER NOT NULL,
    enabled INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS industrial_events (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    line_name TEXT NOT NULL,
    camera_adapter TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    inspection_id TEXT
  );
`);

// Seed default settings row if absent
const existingSettings = db
  .prepare('SELECT value_json FROM system_settings WHERE key = ?')
  .get('global') as { value_json: string } | undefined;

if (!existingSettings) {
  db.prepare('INSERT INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
    'global',
    JSON.stringify(DEFAULT_SETTINGS),
    new Date().toISOString()
  );
}

// Seed default industrial QC rules if empty
const ruleCount = (db.prepare('SELECT COUNT(*) as c FROM industrial_rules').get() as { c: number }).c;
if (ruleCount === 0) {
  const now = new Date().toISOString();
  const insertRule = db.prepare(`
    INSERT INTO industrial_rules (id, name, category, max_anomaly_score, auto_reject_severity, consecutive_defect_alert_count, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertRule.run('rule-metal-nut', 'Precision Machined Fastener Gate', 'Metal Nut', 0.48, 'MEDIUM', 3, 1, now);
  insertRule.run('rule-transistor', 'Semiconductor Package Lead Gate', 'Transistor', 0.45, 'LOW', 2, 1, now);
  insertRule.run('rule-surface', 'General Surface Finish Gate', 'Industrial Surface', 0.5, 'HIGH', 4, 1, now);
}

export function getDb(): Database.Database {
  return db;
}

export function getSettings(): SystemSettings {
  const row = db
    .prepare('SELECT value_json FROM system_settings WHERE key = ?')
    .get('global') as { value_json: string } | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value_json) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: SystemSettings): SystemSettings {
  db.prepare(
    'INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)'
  ).run('global', JSON.stringify(settings), new Date().toISOString());
  return settings;
}

function rowToInspection(row: Record<string, unknown>): InspectionRecord {
  return {
    id: String(row.id),
    category: String(row.category),
    filename: String(row.filename),
    imageHash: String(row.image_hash),
    createdAt: String(row.created_at),
    processingTimeMs: Number(row.processing_time_ms),
    prediction: row.prediction as InspectionRecord['prediction'],
    anomalyScore: Number(row.anomaly_score),
    patchCoreScore: Number(row.patchcore_score),
    geminiScore: row.gemini_score !== null && row.gemini_score !== undefined ? Number(row.gemini_score) : null,
    severity: row.severity as InspectionRecord['severity'],
    severityDisclaimer:
      'Estimated inspection severity category derived from visual anomaly intensity and affected area; not a certified structural or engineering safety assessment.',
    affectedAreaPct: Number(row.affected_area_pct),
    maxIntensity: Number(row.max_intensity),
    defectType: String(row.defect_type),
    explanation: String(row.explanation),
    engineMode: row.engine_mode as InspectionRecord['engineMode'],
    memoryBankUsed: Boolean(row.memory_bank_used),
    calibration: JSON.parse(String(row.calibration_json)),
    drift: JSON.parse(String(row.drift_json)),
    reviewStatus: row.review_status as ReviewStatus,
    reviewerNotes: row.reviewer_notes ? String(row.reviewer_notes) : null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    regions: JSON.parse(String(row.regions_json)),
    featureStats: JSON.parse(String(row.feature_stats_json)),
    geminiMeta: JSON.parse(String(row.gemini_meta_json)),
    assets: JSON.parse(String(row.assets_json)),
    batchId: row.batch_id ? String(row.batch_id) : null,
    source: row.source as InspectionRecord['source'],
  };
}

export function insertInspection(record: InspectionRecord): void {
  db.prepare(`
    INSERT INTO inspections (
      id, category, filename, image_hash, created_at, processing_time_ms,
      prediction, anomaly_score, patchcore_score, gemini_score, severity,
      affected_area_pct, max_intensity, defect_type, explanation, engine_mode,
      memory_bank_used, calibration_json, drift_json, review_status,
      reviewer_notes, reviewed_by, reviewed_at, regions_json, feature_stats_json,
      gemini_meta_json, assets_json, batch_id, source
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    record.id,
    record.category,
    record.filename,
    record.imageHash,
    record.createdAt,
    record.processingTimeMs,
    record.prediction,
    record.anomalyScore,
    record.patchCoreScore,
    record.geminiScore,
    record.severity,
    record.affectedAreaPct,
    record.maxIntensity,
    record.defectType,
    record.explanation,
    record.engineMode,
    record.memoryBankUsed ? 1 : 0,
    JSON.stringify(record.calibration),
    JSON.stringify(record.drift),
    record.reviewStatus,
    record.reviewerNotes,
    record.reviewedBy,
    record.reviewedAt,
    JSON.stringify(record.regions),
    JSON.stringify(record.featureStats),
    JSON.stringify(record.geminiMeta),
    JSON.stringify(record.assets),
    record.batchId,
    record.source
  );

  // Record drift event if drift warning or shift detected
  if (record.drift.referenceAvailable && record.drift.status !== 'STABLE') {
    db.prepare(`
      INSERT INTO drift_events (id, inspection_id, category, status, drift_score, causes_json, actions_json, feature_deltas_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `drift-${record.id}`,
      record.id,
      record.category,
      record.drift.status,
      record.drift.driftScore,
      JSON.stringify(record.drift.causes),
      JSON.stringify(record.drift.recommendedActions),
      JSON.stringify(record.drift.featureDeltas),
      record.createdAt
    );
  }
}

export function listInspections(filters?: {
  category?: string;
  prediction?: string;
  severity?: string;
  reviewStatus?: string;
  search?: string;
  limit?: number;
}): InspectionRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.category && filters.category !== 'ALL') {
    clauses.push('category = ?');
    params.push(filters.category);
  }
  if (filters?.prediction && filters.prediction !== 'ALL') {
    clauses.push('prediction = ?');
    params.push(filters.prediction);
  }
  if (filters?.severity && filters.severity !== 'ALL') {
    clauses.push('severity = ?');
    params.push(filters.severity);
  }
  if (filters?.reviewStatus && filters.reviewStatus !== 'ALL') {
    clauses.push('review_status = ?');
    params.push(filters.reviewStatus);
  }
  if (filters?.search && filters.search.trim().length > 0) {
    clauses.push('(id LIKE ? OR filename LIKE ? OR category LIKE ? OR defect_type LIKE ?)');
    const q = `%${filters.search.trim()}%`;
    params.push(q, q, q, q);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(500, Math.max(1, filters?.limit ?? 200));
  const rows = db
    .prepare(`SELECT * FROM inspections ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as Record<string, unknown>[];

  return rows.map(rowToInspection);
}

export function getInspectionById(id: string): InspectionRecord | null {
  const row = db.prepare('SELECT * FROM inspections WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToInspection(row) : null;
}

export function findRecentInspectionByHash(hash: string, category: string): InspectionRecord | null {
  const row = db
    .prepare('SELECT * FROM inspections WHERE image_hash = ? AND category = ? ORDER BY created_at DESC LIMIT 1')
    .get(hash, category) as Record<string, unknown> | undefined;
  return row ? rowToInspection(row) : null;
}

export function deleteInspection(id: string): boolean {
  const res = db.prepare('DELETE FROM inspections WHERE id = ?').run(id);
  return res.changes > 0;
}

export function saveReviewDecision(
  inspectionId: string,
  decision: 'APPROVED_NORMAL' | 'CONFIRMED_DEFECT' | 'FALSE_POSITIVE',
  notes: string,
  reviewer: string
): InspectionRecord | null {
  const existing = getInspectionById(inspectionId);
  if (!existing) return null;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE inspections SET review_status = ?, reviewer_notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`
  ).run(decision, notes, reviewer, now, inspectionId);

  db.prepare(
    `INSERT INTO review_decisions (id, inspection_id, decision, notes, reviewer, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(`rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, inspectionId, decision, notes, reviewer, now);

  return getInspectionById(inspectionId);
}

export function getPendingReviews(): InspectionRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM inspections WHERE review_status = 'PENDING' OR (prediction IN ('DEFECT', 'REVIEW') AND review_status = 'NOT_REQUIRED') ORDER BY created_at DESC LIMIT 100`
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowToInspection);
}

export function getAnalyticsOverview(): AnalyticsOverview {
  const all = listInspections({ limit: 500 });
  const totalInspected = all.length;
  const normalCount = all.filter((r) => r.prediction === 'PASS').length;
  const defectCount = all.filter((r) => r.prediction === 'DEFECT').length;
  const reviewCount = all.filter((r) => r.prediction === 'REVIEW').length;
  const highSeverityCount = all.filter((r) => r.severity === 'HIGH').length;
  const mediumSeverityCount = all.filter((r) => r.severity === 'MEDIUM').length;
  const lowSeverityCount = all.filter((r) => r.severity === 'LOW').length;
  const falsePositiveCount = all.filter((r) => r.reviewStatus === 'FALSE_POSITIVE').length;
  const confirmedDefectCount = all.filter((r) => r.reviewStatus === 'CONFIRMED_DEFECT').length;
  const humanReviewedCount = all.filter((r) =>
    ['APPROVED_NORMAL', 'CONFIRMED_DEFECT', 'FALSE_POSITIVE'].includes(r.reviewStatus)
  ).length;
  const pendingReviewCount = all.filter((r) => r.reviewStatus === 'PENDING').length;

  const flaggedTotal = Math.max(1, defectCount + reviewCount);
  const falsePositiveRatePct =
    totalInspected > 0 ? Number(((falsePositiveCount / flaggedTotal) * 100).toFixed(1)) : 0;
  const defectDetectionRatePct =
    totalInspected > 0 ? Number(((defectCount / totalInspected) * 100).toFixed(1)) : 0;

  const driftAlertCount = (
    db.prepare('SELECT COUNT(*) as c FROM drift_events').get() as { c: number }
  ).c;

  // Performance metrics from real inspection execution durations
  const times = all.map((r) => r.processingTimeMs).filter((t) => Number.isFinite(t) && t > 0);
  const avgTimeMs =
    times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const fastestTimeMs = times.length > 0 ? Math.round(Math.min(...times)) : 0;
  const slowestTimeMs = times.length > 0 ? Math.round(Math.max(...times)) : 0;
  const imagesPerMinute = avgTimeMs > 0 ? Number((60000 / avgTimeMs).toFixed(1)) : 0;
  const batchIds = new Set(all.map((r) => r.batchId).filter(Boolean));

  // Confidence band breakdown
  const bands: ConfidenceBand[] = [
    'HIGH CONFIDENCE',
    'MEDIUM CONFIDENCE',
    'LOW CONFIDENCE',
    'NEEDS HUMAN REVIEW',
  ];
  const confidenceDistribution = bands.map((band) => ({
    band,
    count: all.filter((r) => r.calibration.confidenceBand === band).length,
  }));

  // Category statistics
  const catMap = new Map<
    string,
    { total: number; normal: number; defect: number; review: number; scoreSum: number }
  >();
  for (const r of all) {
    const entry = catMap.get(r.category) ?? {
      total: 0,
      normal: 0,
      defect: 0,
      review: 0,
      scoreSum: 0,
    };
    entry.total++;
    if (r.prediction === 'PASS') entry.normal++;
    else if (r.prediction === 'DEFECT') entry.defect++;
    else entry.review++;
    entry.scoreSum += r.anomalyScore;
    catMap.set(r.category, entry);
  }
  const categoryStats = Array.from(catMap.entries()).map(([category, s]) => ({
    category,
    total: s.total,
    normal: s.normal,
    defect: s.defect,
    review: s.review,
    defectRatePct: Number(((s.defect / Math.max(1, s.total)) * 100).toFixed(1)),
    avgScore: Number((s.scoreSum / Math.max(1, s.total)).toFixed(3)),
  }));

  // Time trends (grouped by hour/minute bucket for active sessions or date)
  const trendMap = new Map<
    string,
    { total: number; normal: number; defect: number; review: number; falsePositives: number }
  >();
  const chronological = [...all].reverse();
  for (const r of chronological) {
    const d = new Date(r.createdAt);
    const bucket = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
    const entry = trendMap.get(bucket) ?? {
      total: 0,
      normal: 0,
      defect: 0,
      review: 0,
      falsePositives: 0,
    };
    entry.total++;
    if (r.prediction === 'PASS') entry.normal++;
    else if (r.prediction === 'DEFECT') entry.defect++;
    else entry.review++;
    if (r.reviewStatus === 'FALSE_POSITIVE') entry.falsePositives++;
    trendMap.set(bucket, entry);
  }
  const trends = Array.from(trendMap.entries())
    .slice(-12)
    .map(([bucket, vals]) => ({ bucket, ...vals }));

  return {
    totalInspected,
    normalCount,
    defectCount,
    reviewCount,
    highSeverityCount,
    mediumSeverityCount,
    lowSeverityCount,
    falsePositiveCount,
    confirmedDefectCount,
    humanReviewedCount,
    pendingReviewCount,
    falsePositiveRatePct,
    defectDetectionRatePct,
    driftAlertCount,
    performance: {
      avgTimeMs,
      fastestTimeMs,
      slowestTimeMs,
      totalProcessed: totalInspected,
      imagesPerMinute,
      batchCount: batchIds.size,
    },
    confidenceDistribution,
    categoryStats,
    trends,
  };
}

export function getDriftHistory(limit = 50): Array<{
  id: string;
  inspectionId: string | null;
  category: string;
  status: string;
  driftScore: number;
  causes: string[];
  recommendedActions: string[];
  featureDeltas: Array<{ feature: string; reference: number; current: number; zScore: number }>;
  createdAt: string;
}> {
  const rows = db
    .prepare('SELECT * FROM drift_events ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    inspectionId: r.inspection_id ? String(r.inspection_id) : null,
    category: String(r.category),
    status: String(r.status),
    driftScore: Number(r.drift_score),
    causes: JSON.parse(String(r.causes_json)),
    recommendedActions: JSON.parse(String(r.actions_json)),
    featureDeltas: JSON.parse(String(r.feature_deltas_json)),
    createdAt: String(r.created_at),
  }));
}

// Dataset & Memory Bank methods
export function insertDatasetImage(record: {
  id: string;
  category: string;
  split: DatasetSplit;
  filename: string;
  imageHash: string;
  storedFilename: string;
  width: number;
  height: number;
  lighting: string;
  cameraAngle: string;
  background: string;
}): DatasetImageRecord {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO dataset_images (
      id, category, split, filename, image_hash, stored_filename,
      width, height, lighting, camera_angle, background, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.category,
    record.split,
    record.filename,
    record.imageHash,
    record.storedFilename,
    record.width,
    record.height,
    record.lighting,
    record.cameraAngle,
    record.background,
    now
  );

  return {
    id: record.id,
    category: record.category,
    split: record.split,
    filename: record.filename,
    imageHash: record.imageHash,
    imageUrl: `/api/files/datasets/${record.storedFilename}`,
    width: record.width,
    height: record.height,
    lighting: record.lighting,
    cameraAngle: record.cameraAngle,
    background: record.background,
    createdAt: now,
  };
}

export function listDatasetImages(category?: string, split?: string): Array<DatasetImageRecord & { storedFilename: string }> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (category && category !== 'ALL') {
    clauses.push('category = ?');
    params.push(category);
  }
  if (split && split !== 'ALL') {
    clauses.push('split = ?');
    params.push(split);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM dataset_images ${where} ORDER BY created_at DESC`)
    .all(...params) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: String(r.id),
    category: String(r.category),
    split: r.split as DatasetSplit,
    filename: String(r.filename),
    imageHash: String(r.image_hash),
    storedFilename: String(r.stored_filename),
    imageUrl: `/api/files/datasets/${String(r.stored_filename)}`,
    width: Number(r.width),
    height: Number(r.height),
    lighting: String(r.lighting),
    cameraAngle: String(r.camera_angle),
    background: String(r.background),
    createdAt: String(r.created_at),
  }));
}

export function findDatasetDuplicate(category: string, imageHash: string): boolean {
  const row = db
    .prepare('SELECT id FROM dataset_images WHERE category = ? AND image_hash = ? LIMIT 1')
    .get(category, imageHash);
  return Boolean(row);
}

export function deleteDatasetImage(id: string): { deleted: boolean; storedFilename?: string } {
  const row = db
    .prepare('SELECT stored_filename FROM dataset_images WHERE id = ?')
    .get(id) as { stored_filename: string } | undefined;
  if (!row) return { deleted: false };
  db.prepare('DELETE FROM dataset_images WHERE id = ?').run(id);
  return { deleted: true, storedFilename: row.stored_filename };
}

export function saveMemoryBank(bank: PatchMemoryBankData, version: string, inputSize: number): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO memory_banks (category, version, trained_at, normal_image_count, coreset_patch_count, bank_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    bank.category,
    version,
    now,
    bank.normalImageCount,
    bank.coreset.length,
    JSON.stringify(bank)
  );

  db.prepare(`
    INSERT INTO model_versions (id, name, architecture, category, version, dataset_name, input_size, normal_samples, evaluation_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `mv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    `PROMETHEUS-X ${bank.category}`,
    'PatchCore Multi-Scale + Gemini Vision Hybrid',
    bank.category,
    version,
    'Industrial MVTec-Compatible Dataset',
    inputSize,
    bank.normalImageCount,
    bank.calibration.evaluation ? JSON.stringify(bank.calibration.evaluation) : null,
    now
  );
}

export function getMemoryBank(category: string): (PatchMemoryBankData & { version: string; trainedAt: string }) | null {
  const row = db
    .prepare('SELECT version, trained_at, bank_json FROM memory_banks WHERE category = ?')
    .get(category) as { version: string; trained_at: string; bank_json: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.bank_json) as PatchMemoryBankData;
    return { ...parsed, version: row.version, trainedAt: row.trained_at };
  } catch {
    return null;
  }
}

export function listCategoryModelStatuses(): CategoryModelStatus[] {
  const rows = db.prepare('SELECT * FROM memory_banks ORDER BY trained_at DESC').all() as Array<{
    category: string;
    version: string;
    trained_at: string;
    normal_image_count: number;
    coreset_patch_count: number;
    bank_json: string;
  }>;

  return rows.map((r) => {
    const parsed = JSON.parse(r.bank_json) as PatchMemoryBankData;
    return {
      category: r.category,
      trainedAt: r.trained_at,
      normalImageCount: r.normal_image_count,
      coresetPatchCount: r.coreset_patch_count,
      referenceFeatureStats: parsed.referenceStats,
      calibrationReady: parsed.calibration.calibrated,
      evaluation: parsed.calibration.evaluation,
      version: r.version,
    };
  });
}

export function listModelVersions(): Array<{
  id: string;
  name: string;
  architecture: string;
  category: string;
  version: string;
  datasetName: string;
  inputSize: number;
  normalSamples: number;
  evaluation: unknown;
  createdAt: string;
}> {
  const rows = db
    .prepare('SELECT * FROM model_versions ORDER BY created_at DESC LIMIT 30')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    architecture: String(r.architecture),
    category: String(r.category),
    version: String(r.version),
    datasetName: String(r.dataset_name),
    inputSize: Number(r.input_size),
    normalSamples: Number(r.normal_samples),
    evaluation: r.evaluation_json ? JSON.parse(String(r.evaluation_json)) : null,
    createdAt: String(r.created_at),
  }));
}

// Users, RBAC & Audit Logs
export function countAdmins(): number {
  return (db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'Admin'`).get() as { c: number }).c;
}

export function createUser(user: {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}): AuthUser {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(user.id, user.username, user.email, user.passwordHash, user.role, now);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: now,
  };
}

export function findUserByUsernameOrEmail(
  identifier: string
): (AuthUser & { passwordHash: string }) | null {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1')
    .get(identifier, identifier) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    username: String(row.username),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    role: row.role as UserRole,
    createdAt: String(row.created_at),
  };
}

export function listUsers(): AuthUser[] {
  const rows = db
    .prepare('SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    username: String(r.username),
    email: String(r.email),
    role: r.role as UserRole,
    createdAt: String(r.created_at),
  }));
}

export function updateUserRole(userId: string, role: UserRole): boolean {
  const res = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  return res.changes > 0;
}

export function logAudit(actor: string, role: string, action: string, target: string, details: string): void {
  db.prepare(
    'INSERT INTO audit_logs (id, actor, role, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    actor,
    role,
    action,
    target,
    details,
    new Date().toISOString()
  );
}

export function listAuditLogs(limit = 100): AuditLogEntry[] {
  const rows = db
    .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    actor: String(r.actor),
    role: String(r.role),
    action: String(r.action),
    target: String(r.target),
    details: String(r.details),
    createdAt: String(r.created_at),
  }));
}

// Industrial Rules & Event Log
export function listIndustrialRules(): IndustrialRule[] {
  const rows = db.prepare('SELECT * FROM industrial_rules ORDER BY category ASC').all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    category: String(r.category),
    maxAnomalyScore: Number(r.max_anomaly_score),
    autoRejectSeverity: r.auto_reject_severity as IndustrialRule['autoRejectSeverity'],
    consecutiveDefectAlertCount: Number(r.consecutive_defect_alert_count),
    enabled: Boolean(r.enabled),
    updatedAt: String(r.updated_at),
  }));
}

export function upsertIndustrialRule(rule: Omit<IndustrialRule, 'updatedAt'>): IndustrialRule {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO industrial_rules (id, name, category, max_anomaly_score, auto_reject_severity, consecutive_defect_alert_count, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rule.id,
    rule.name,
    rule.category,
    rule.maxAnomalyScore,
    rule.autoRejectSeverity,
    rule.consecutiveDefectAlertCount,
    rule.enabled ? 1 : 0,
    now
  );
  return { ...rule, updatedAt: now };
}

export function addIndustrialEvent(event: Omit<IndustrialEvent, 'id' | 'timestamp'>): IndustrialEvent {
  const full: IndustrialEvent = {
    id: `ind-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...event,
  };
  db.prepare(`
    INSERT INTO industrial_events (id, timestamp, line_name, camera_adapter, event_type, message, inspection_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    full.id,
    full.timestamp,
    full.lineName,
    full.cameraAdapter,
    full.eventType,
    full.message,
    full.inspectionId
  );
  return full;
}

export function listIndustrialEvents(limit = 60): IndustrialEvent[] {
  const rows = db
    .prepare('SELECT * FROM industrial_events ORDER BY timestamp DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    timestamp: String(r.timestamp),
    lineName: String(r.line_name),
    cameraAdapter: String(r.camera_adapter),
    eventType: r.event_type as IndustrialEvent['eventType'],
    message: String(r.message),
    inspectionId: r.inspection_id ? String(r.inspection_id) : null,
  }));
}
