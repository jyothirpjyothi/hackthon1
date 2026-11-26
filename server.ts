import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { createServer as createViteServer } from 'vite';
import { PRODUCT_CATEGORIES, type DatasetSplit, type InspectionRecord, type UserRole } from './src/types/prometheus';
import {
  DATASETS_DIR,
  DB_PATH,
  RESULTS_DIR,
  UPLOADS_DIR,
  countAdmins,
  createUser,
  deleteDatasetImage,
  deleteInspection,
  findDatasetDuplicate,
  findRecentInspectionByHash,
  findUserByUsernameOrEmail,
  getAnalyticsOverview,
  getDriftHistory,
  getInspectionById,
  getMemoryBank,
  getPendingReviews,
  getSettings,
  insertDatasetImage,
  listAuditLogs,
  listCategoryModelStatuses,
  listDatasetImages,
  listIndustrialEvents,
  listIndustrialRules,
  listInspections,
  listModelVersions,
  listUsers,
  logAudit,
  saveReviewDecision,
  saveSettings,
  updateUserRole,
  upsertIndustrialRule,
} from './server/db/database';
import {
  BUNDLED_SPECIMENS,
  ensureStarterNormalBaseline,
  isGeminiConfigured,
  runInspectionPipeline,
  trainCategoryMemoryBank,
} from './server/ml/visionService';
import {
  BootstrapAdminSchema,
  CreateUserSchema,
  LoginSchema,
  MAX_IMAGE_BYTES,
  ReviewDecisionSchema,
  SettingsUpdateSchema,
  attachOptionalUser,
  computeBufferSha256,
  hasEnvAdminPasscode,
  hashPassword,
  requireAuth,
  requireRole,
  resolveSafePath,
  signSessionToken,
  validateImageBuffer,
  verifyEnvAdminPasscode,
  verifyPassword,
  type AuthenticatedRequest,
} from './server/services/security';

const PORT = Number(process.env.PORT || 3000);
const VALID_SPLITS: DatasetSplit[] = ['train_normal', 'val_normal', 'val_defect', 'test_defect'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: 12,
  },
});

const serverMetrics = {
  startedAt: new Date().toISOString(),
  apiErrors: 0,
  inspectionFailures: 0,
};

function sanitizeCategory(raw: unknown): string {
  const str = String(raw || 'Metal Nut').trim();
  if ((PRODUCT_CATEGORIES as readonly string[]).includes(str)) return str;
  return 'Industrial Surface';
}

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function startServer() {
  await ensureStarterNormalBaseline();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '16mb' }));
  app.use(express.urlencoded({ extended: true, limit: '16mb' }));

  // Same-origin / configured APP_URL CORS only (never wildcard on authenticated routes)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigin = process.env.APP_URL;
    if (origin && (origin.startsWith('http://localhost:') || origin === allowedOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(attachOptionalUser);

  // Rate limiters
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please try again later.' },
  });

  const inspectLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Inspection rate limit reached. Wait a few seconds before submitting more images.' },
  });

  // =========================================================================
  // SYSTEM & HEALTH
  // =========================================================================
  app.get('/api/health', (_req, res) => {
    const banks = listCategoryModelStatuses();
    res.json({
      status: 'ok',
      service: 'PROMETHEUS-X Industrial Inspection Engine',
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: serverMetrics.startedAt,
      databaseAvailable: fs.existsSync(DB_PATH),
      geminiVisionAvailable: isGeminiConfigured(),
      trainedCategories: banks.length,
      apiErrors: serverMetrics.apiErrors,
      inspectionFailures: serverMetrics.inspectionFailures,
    });
  });

  app.get('/api/system/info', (_req, res) => {
    const settings = getSettings();
    const banks = listCategoryModelStatuses();
    const mem = process.memoryUsage();
    res.json({
      platform: 'PROMETHEUS-X',
      architecture: settings.activeModelArchitecture,
      geminiModel: isGeminiConfigured() ? 'gemini-4-hydrogen' : null,
      categories: PRODUCT_CATEGORIES,
      trainedCategoryCount: banks.length,
      memoryRssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
      heapUsedMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
      nodeVersion: process.version,
      databaseEngine: 'SQLite (WAL Mode)',
      adminClaimed: countAdmins() > 0 || hasEnvAdminPasscode(),
      envAdminPasscodeConfigured: hasEnvAdminPasscode(),
    });
  });

  app.get('/api/samples', (_req, res) => {
    res.json({ samples: BUNDLED_SPECIMENS });
  });

  // Safe file serving for uploads, generated heatmaps/masks, and dataset thumbnails
  app.get('/api/files/:bucket/:filename', (req, res) => {
    const bucket = req.params.bucket;
    const filename = req.params.filename;
    const dirMap: Record<string, string> = {
      uploads: UPLOADS_DIR,
      results: RESULTS_DIR,
      datasets: DATASETS_DIR,
    };
    const baseDir = dirMap[bucket];
    if (!baseDir) {
      res.status(400).json({ error: 'Invalid asset bucket.' });
      return;
    }
    const resolved = resolveSafePath(baseDir, filename);
    if (!resolved || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(resolved);
  });

  // =========================================================================
  // AUTHENTICATION, RBAC & AUDIT
  // =========================================================================
  app.get('/api/auth/status', (req: AuthenticatedRequest, res) => {
    res.json({
      authenticated: Boolean(req.user),
      user: req.user
        ? {
            id: req.user.userId,
            username: req.user.username,
            email: req.user.email,
            role: req.user.role,
          }
        : null,
      adminClaimed: countAdmins() > 0 || hasEnvAdminPasscode(),
      envPasscodeActive: hasEnvAdminPasscode(),
    });
  });

  app.post('/api/auth/bootstrap-admin', authLimiter, (req, res) => {
    if (hasEnvAdminPasscode()) {
      res.status(409).json({
        error: 'An environment admin passcode is configured. Sign in using the Admin login form.',
      });
      return;
    }
    if (countAdmins() > 0) {
      res.status(409).json({
        error: 'An administrator account has already been claimed. Please sign in.',
      });
      return;
    }

    const parsed = BootstrapAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid admin details.' });
      return;
    }

    try {
      const user = createUser({
        id: `usr-${crypto.randomUUID().slice(0, 8)}`,
        username: parsed.data.username,
        email: parsed.data.email.toLowerCase(),
        passwordHash: hashPassword(parsed.data.password),
        role: 'Admin',
      });
      const token = signSessionToken({
        userId: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      });
      logAudit(user.username, user.role, 'BOOTSTRAP_ADMIN', user.id, 'Claimed initial platform Admin account.');
      res.status(201).json({ token, user });
    } catch {
      res.status(409).json({ error: 'Username or email is already registered.' });
    }
  });

  app.post('/api/auth/login', authLimiter, (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const { username, password } = parsed.data;

    // Environment override passcode always works for Admin login when configured
    if (
      hasEnvAdminPasscode() &&
      (username.toLowerCase() === 'admin' || username.toLowerCase() === 'administrator') &&
      verifyEnvAdminPasscode(password)
    ) {
      const token = signSessionToken({
        userId: 'env-admin',
        username: 'admin',
        email: 'admin@prometheus.local',
        role: 'Admin',
      });
      logAudit('admin', 'Admin', 'LOGIN', 'env-admin', 'Signed in via configured environment admin passcode.');
      res.json({
        token,
        user: {
          id: 'env-admin',
          username: 'admin',
          email: 'admin@prometheus.local',
          role: 'Admin' as UserRole,
          createdAt: new Date().toISOString(),
        },
      });
      return;
    }

    const existing = findUserByUsernameOrEmail(username.trim());
    if (!existing || !verifyPassword(password, existing.passwordHash)) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const token = signSessionToken({
      userId: existing.id,
      username: existing.username,
      email: existing.email,
      role: existing.role,
    });
    logAudit(existing.username, existing.role, 'LOGIN', existing.id, 'Authenticated session issued.');
    res.json({
      token,
      user: {
        id: existing.id,
        username: existing.username,
        email: existing.email,
        role: existing.role,
        createdAt: existing.createdAt,
      },
    });
  });

  app.get('/api/users', requireAuth, requireRole(['Admin']), (_req, res) => {
    res.json({ users: listUsers() });
  });

  app.post('/api/users', requireAuth, requireRole(['Admin']), (req: AuthenticatedRequest, res) => {
    const parsed = CreateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid user payload.' });
      return;
    }
    try {
      const user = createUser({
        id: `usr-${crypto.randomUUID().slice(0, 8)}`,
        username: parsed.data.username,
        email: parsed.data.email.toLowerCase(),
        passwordHash: hashPassword(parsed.data.password),
        role: parsed.data.role,
      });
      logAudit(
        req.user!.username,
        req.user!.role,
        'CREATE_USER',
        user.id,
        `Created ${user.role} account for ${user.username}.`
      );
      res.status(201).json({ user });
    } catch {
      res.status(409).json({ error: 'Username or email already exists.' });
    }
  });

  app.patch('/api/users/:id/role', requireAuth, requireRole(['Admin']), (req: AuthenticatedRequest, res) => {
    const role = String(req.body?.role || '') as UserRole;
    if (!['Admin', 'Engineer', 'Operator'].includes(role)) {
      res.status(400).json({ error: 'Role must be Admin, Engineer, or Operator.' });
      return;
    }
    const ok = updateUserRole(req.params.id, role);
    if (!ok) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    logAudit(req.user!.username, req.user!.role, 'UPDATE_ROLE', req.params.id, `Updated role to ${role}.`);
    res.json({ updated: true });
  });

  app.get('/api/audit-logs', requireAuth, requireRole(['Admin', 'Engineer']), (_req, res) => {
    res.json({ logs: listAuditLogs(100) });
  });

  app.get('/api/database/backup', requireAuth, requireRole(['Admin']), (req: AuthenticatedRequest, res) => {
    if (!fs.existsSync(DB_PATH)) {
      res.status(404).json({ error: 'Database file unavailable.' });
      return;
    }
    logAudit(req.user!.username, req.user!.role, 'DB_BACKUP', 'prometheus.db', 'Downloaded SQLite database backup.');
    res.download(DB_PATH, `prometheus-x-backup-${new Date().toISOString().slice(0, 10)}.db`);
  });

  // =========================================================================
  // INSPECTION & BATCH PROCESSING
  // =========================================================================
  app.post('/api/inspect', inspectLimiter, upload.single('image'), async (req: AuthenticatedRequest, res) => {
    try {
      const category = sanitizeCategory(req.body?.category);
      const skipDuplicate = req.body?.skipDuplicate === 'true' || req.body?.skipDuplicate === true;
      const source = (['upload', 'batch', 'webcam', 'sample'].includes(String(req.body?.source))
        ? String(req.body?.source)
        : 'upload') as 'upload' | 'batch' | 'webcam' | 'sample';

      let imageBuffer: Buffer;
      let filename = 'specimen.jpg';
      let declaredMime: string | undefined;

      if (req.file) {
        imageBuffer = req.file.buffer;
        filename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'specimen.jpg';
        declaredMime = req.file.mimetype;
      } else if (typeof req.body?.sampleId === 'string') {
        const sample = BUNDLED_SPECIMENS.find((s) => s.id === req.body.sampleId);
        if (!sample) {
          res.status(404).json({ error: 'Requested sample specimen was not found.' });
          return;
        }
        const localPath = path.resolve(process.cwd(), sample.imageUrl.replace(/^\/+/, ''));
        if (!fs.existsSync(localPath)) {
          res.status(404).json({ error: 'Sample specimen file is unavailable.' });
          return;
        }
        imageBuffer = fs.readFileSync(localPath);
        filename = path.basename(localPath);
        declaredMime = 'image/jpeg';
      } else if (typeof req.body?.imageBase64 === 'string') {
        const match = req.body.imageBase64.match(/^data:(image\/(?:jpeg|jpg|png));base64,(.+)$/i);
        if (!match) {
          res.status(400).json({ error: 'Invalid base64 image payload. Must be image/jpeg or image/png.' });
          return;
        }
        declaredMime = match[1].toLowerCase();
        imageBuffer = Buffer.from(match[2], 'base64');
        filename = `webcam_${Date.now()}.jpg`;
      } else {
        res.status(400).json({ error: 'No image file, webcam frame, or sample specimen provided.' });
        return;
      }

      const check = validateImageBuffer(imageBuffer, declaredMime);
      if (!check.valid || !check.mimeType) {
        res.status(400).json({ error: check.error || 'Invalid image upload.' });
        return;
      }

      if (skipDuplicate) {
        const hash = computeBufferSha256(imageBuffer);
        const existing = findRecentInspectionByHash(hash, category);
        if (existing) {
          res.json({ inspection: existing, deduplicated: true });
          return;
        }
      }

      const inspection = await runInspectionPipeline({
        imageBuffer,
        mimeType: check.mimeType,
        filename,
        category,
        source,
      });

      if (req.user) {
        logAudit(
          req.user.username,
          req.user.role,
          'RUN_INSPECTION',
          inspection.id,
          `Inspected ${category} (${filename}) → ${inspection.prediction}`
        );
      }

      res.status(201).json({ inspection, deduplicated: false });
    } catch (err) {
      serverMetrics.inspectionFailures++;
      console.error('Inspection failed:', err);
      res.status(500).json({ error: 'Image inspection failed during processing. Please verify the image and try again.' });
    }
  });

  app.post('/api/inspect/batch', inspectLimiter, upload.array('images', 12), async (req: AuthenticatedRequest, res) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'Select at least one JPG or PNG image for batch inspection.' });
        return;
      }
      const category = sanitizeCategory(req.body?.category);
      const batchId = `BATCH-${Date.now().toString(36).toUpperCase()}`;
      const batchStart = performance.now();

      const results: InspectionRecord[] = [];
      const errors: Array<{ filename: string; error: string }> = [];
      const seenHashes = new Set<string>();
      let skippedDuplicates = 0;

      // Process in safe parallel chunks of 3
      const concurrency = 3;
      for (let i = 0; i < files.length; i += concurrency) {
        const chunk = files.slice(i, i + concurrency);
        const settled = await Promise.all(
          chunk.map(async (file) => {
            const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
            const validation = validateImageBuffer(file.buffer, file.mimetype);
            if (!validation.valid || !validation.mimeType) {
              errors.push({ filename: safeName, error: validation.error || 'Invalid image.' });
              return null;
            }
            const hash = computeBufferSha256(file.buffer);
            if (seenHashes.has(hash)) {
              skippedDuplicates++;
              return null;
            }
            seenHashes.add(hash);
            return runInspectionPipeline({
              imageBuffer: file.buffer,
              mimeType: validation.mimeType,
              filename: safeName,
              category,
              source: 'batch',
              batchId,
            });
          })
        );
        for (const item of settled) {
          if (item) results.push(item);
        }
      }

      const totalBatchMs = Number((performance.now() - batchStart).toFixed(1));
      res.status(201).json({
        batchId,
        totalSubmitted: files.length,
        processedCount: results.length,
        skippedDuplicates,
        errorCount: errors.length,
        totalBatchMs,
        inspections: results,
        errors,
      });
    } catch (err) {
      serverMetrics.inspectionFailures++;
      console.error('Batch inspection failed:', err);
      res.status(500).json({ error: 'Batch inspection failed.' });
    }
  });

  app.get('/api/inspections', (req, res) => {
    const inspections = listInspections({
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
      prediction: typeof req.query.prediction === 'string' ? req.query.prediction : undefined,
      severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
      reviewStatus: typeof req.query.reviewStatus === 'string' ? req.query.reviewStatus : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 200,
    });
    res.json({ inspections });
  });

  app.get('/api/inspections/:id', (req, res) => {
    const record = getInspectionById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Inspection record not found.' });
      return;
    }
    res.json({ inspection: record });
  });

  app.delete('/api/inspections/:id', (req: AuthenticatedRequest, res) => {
    // Enforce RBAC if an Admin has been claimed; allow Engineer/Admin to delete
    if ((countAdmins() > 0 || hasEnvAdminPasscode()) && (!req.user || !['Admin', 'Engineer'].includes(req.user.role))) {
      res.status(403).json({ error: 'Deleting inspection records requires Admin or Engineer sign-in.' });
      return;
    }
    const deleted = deleteInspection(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Inspection record not found.' });
      return;
    }
    if (req.user) {
      logAudit(req.user.username, req.user.role, 'DELETE_INSPECTION', req.params.id, 'Deleted inspection record.');
    }
    res.json({ deleted: true });
  });

  // =========================================================================
  // REPORTS (JSON & CSV)
  // =========================================================================
  app.get('/api/reports/export/csv', (_req, res) => {
    const all = listInspections({ limit: 500 });
    const header = [
      'Inspection ID',
      'Timestamp',
      'Category',
      'Filename',
      'Prediction',
      'Anomaly Score',
      'PatchCore Score',
      'Gemini Score',
      'Severity (Estimated)',
      'Affected Area %',
      'Defect Type',
      'Confidence Band',
      'Drift Status',
      'Drift Score',
      'Review Status',
      'Processing Time (ms)',
    ].join(',');

    const lines = all.map((r) =>
      [
        r.id,
        r.createdAt,
        r.category,
        r.filename,
        r.prediction,
        r.anomalyScore,
        r.patchCoreScore,
        r.geminiScore ?? '',
        r.severity,
        r.affectedAreaPct,
        r.defectType,
        r.calibration.confidenceBand,
        r.drift.status,
        r.drift.driftScore,
        r.reviewStatus,
        r.processingTimeMs,
      ]
        .map(escapeCsvCell)
        .join(',')
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="prometheus-x-qc-report-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send([header, ...lines].join('\n'));
  });

  app.get('/api/reports/:id', (req, res) => {
    const record = getInspectionById(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Inspection record not found.' });
      return;
    }
    if (req.query.format === 'csv') {
      const rows = [
        ['Field', 'Value'],
        ['Inspection ID', record.id],
        ['Timestamp', record.createdAt],
        ['Product Category', record.category],
        ['Filename', record.filename],
        ['Prediction', record.prediction],
        ['Anomaly Score', record.anomalyScore],
        ['PatchCore Score', record.patchCoreScore],
        ['Gemini Vision Score', record.geminiScore ?? 'Not Used'],
        ['Estimated Severity', record.severity],
        ['Severity Notice', record.severityDisclaimer],
        ['Affected Area (%)', record.affectedAreaPct],
        ['Defect Type', record.defectType],
        ['Calibration Status', record.calibration.label],
        ['Confidence Band', record.calibration.confidenceBand],
        ['Distribution Shift', `${record.drift.status} (${record.drift.driftScore}σ)`],
        ['Review Status', record.reviewStatus],
        ['Reviewer Notes', record.reviewerNotes ?? ''],
        ['Explanation', record.explanation],
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${record.id}-report.csv"`);
      res.send(rows.map((r) => r.map(escapeCsvCell).join(',')).join('\n'));
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${record.id}-report.json"`);
    res.json({
      generatedAt: new Date().toISOString(),
      platform: 'PROMETHEUS-X',
      inspection: record,
    });
  });

  // =========================================================================
  // ANALYTICS
  // =========================================================================
  app.get('/api/analytics/overview', (_req, res) => {
    res.json(getAnalyticsOverview());
  });

  app.get('/api/analytics/severity', (_req, res) => {
    const overview = getAnalyticsOverview();
    res.json({
      severity: [
        { level: 'HIGH', count: overview.highSeverityCount },
        { level: 'MEDIUM', count: overview.mediumSeverityCount },
        { level: 'LOW', count: overview.lowSeverityCount },
        { level: 'NONE', count: overview.normalCount },
      ],
    });
  });

  app.get('/api/analytics/trends', (_req, res) => {
    res.json({ trends: getAnalyticsOverview().trends });
  });

  app.get('/api/analytics/false-positives', (_req, res) => {
    const overview = getAnalyticsOverview();
    res.json({
      totalInspected: overview.totalInspected,
      falsePositiveCount: overview.falsePositiveCount,
      confirmedDefectCount: overview.confirmedDefectCount,
      humanReviewedCount: overview.humanReviewedCount,
      pendingReviewCount: overview.pendingReviewCount,
      falsePositiveRatePct: overview.falsePositiveRatePct,
    });
  });

  // =========================================================================
  // DATASET MANAGEMENT & MODEL TRAINING
  // =========================================================================
  app.get('/api/dataset', (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const split = typeof req.query.split === 'string' ? req.query.split : undefined;
    const images = listDatasetImages(category, split).map(({ storedFilename: _s, ...rest }) => rest);

    const summaryByCategory = PRODUCT_CATEGORIES.map((cat) => {
      const catImgs = images.filter((img) => img.category === cat);
      return {
        category: cat,
        trainNormal: catImgs.filter((i) => i.split === 'train_normal').length,
        valNormal: catImgs.filter((i) => i.split === 'val_normal').length,
        valDefect: catImgs.filter((i) => i.split === 'val_defect').length,
        testDefect: catImgs.filter((i) => i.split === 'test_defect').length,
        total: catImgs.length,
      };
    });

    res.json({ images, summaryByCategory });
  });

  app.post('/api/dataset/upload', upload.array('images', 12), async (req: AuthenticatedRequest, res) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'Upload at least one JPG or PNG image.' });
        return;
      }
      const category = sanitizeCategory(req.body?.category);
      const split = (VALID_SPLITS.includes(req.body?.split) ? req.body.split : 'train_normal') as DatasetSplit;
      const lighting = String(req.body?.lighting || 'Standard Ring Light').slice(0, 60);
      const cameraAngle = String(req.body?.cameraAngle || 'Top-Down 90°').slice(0, 60);
      const background = String(req.body?.background || 'Matte Inspection Stage').slice(0, 60);

      const added = [];
      let duplicatesSkipped = 0;
      const rejected: Array<{ filename: string; reason: string }> = [];

      for (const file of files) {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
        const check = validateImageBuffer(file.buffer, file.mimetype);
        if (!check.valid || !check.mimeType) {
          rejected.push({ filename: safeName, reason: check.error || 'Invalid file.' });
          continue;
        }
        const hash = computeBufferSha256(file.buffer);
        if (findDatasetDuplicate(category, hash)) {
          duplicatesSkipped++;
          continue;
        }
        const meta = await sharp(file.buffer).metadata();
        const id = `ds-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
        const ext = check.mimeType === 'image/png' ? 'png' : 'jpg';
        const storedFilename = `${id}.${ext}`;
        fs.writeFileSync(path.join(DATASETS_DIR, storedFilename), file.buffer);

        const record = insertDatasetImage({
          id,
          category,
          split,
          filename: safeName,
          imageHash: hash,
          storedFilename,
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          lighting,
          cameraAngle,
          background,
        });
        added.push(record);
      }

      if (req.user) {
        logAudit(
          req.user.username,
          req.user.role,
          'DATASET_UPLOAD',
          category,
          `Added ${added.length} images to ${split} (${duplicatesSkipped} duplicates skipped).`
        );
      }

      res.status(201).json({ added, duplicatesSkipped, rejected });
    } catch (err) {
      console.error('Dataset upload error:', err);
      res.status(500).json({ error: 'Failed to store dataset images.' });
    }
  });

  app.delete('/api/dataset/:id', (req: AuthenticatedRequest, res) => {
    const result = deleteDatasetImage(req.params.id);
    if (!result.deleted) {
      res.status(404).json({ error: 'Dataset image not found.' });
      return;
    }
    if (result.storedFilename) {
      const target = resolveSafePath(DATASETS_DIR, result.storedFilename);
      if (target && fs.existsSync(target)) {
        try {
          fs.unlinkSync(target);
        } catch {
          // ignore cleanup warning
        }
      }
    }
    res.json({ deleted: true });
  });

  app.get('/api/model/status', (_req, res) => {
    const settings = getSettings();
    const categories = listCategoryModelStatuses();
    res.json({
      ready: categories.length > 0 || isGeminiConfigured(),
      architecture: settings.activeModelArchitecture,
      geminiVisionConfigured: isGeminiConfigured(),
      geminiModel: isGeminiConfigured() ? 'gemini-4-hydrogen' : null,
      trainedCategories: categories,
    });
  });

  app.get('/api/model/info', (_req, res) => {
    const settings = getSettings();
    res.json({
      modelName: 'PROMETHEUS-X Open-Set Hybrid',
      architecture: settings.activeModelArchitecture,
      primaryBaseline: 'PatchCore Multi-Scale Coreset Memory Bank',
      visionFusion: isGeminiConfigured() ? 'Gemini Vision API (gemini-4-hydrogen)' : 'Unavailable (PatchCore Only)',
      datasetStandard: 'MVTec AD Compatible (Normal-Only Training)',
      inputSize: `${settings.preprocessingSize} × ${settings.preprocessingSize} RGB`,
      categories: listCategoryModelStatuses(),
      versions: listModelVersions(),
    });
  });

  app.post('/api/model/train', async (req: AuthenticatedRequest, res) => {
    try {
      const category = sanitizeCategory(req.body?.category);
      const trained = await trainCategoryMemoryBank(category);
      if (req.user) {
        logAudit(
          req.user.username,
          req.user.role,
          'TRAIN_MODEL',
          category,
          `Built PatchCore memory bank (${trained.normalImageCount} normal imgs, ${trained.coresetPatchCount} coreset patches).`
        );
      }
      res.json({ trained });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Training failed.';
      res.status(400).json({ error: message });
    }
  });

  // =========================================================================
  // DISTRIBUTION SHIFT MONITOR
  // =========================================================================
  app.get('/api/drift/status', (_req, res) => {
    const recent = listInspections({ limit: 40 });
    const categories = listCategoryModelStatuses();
    const latestWithRef = recent.find((r) => r.drift.referenceAvailable) ?? recent[0] ?? null;
    const categoryDrift = categories.map((cat) => {
      const catInspections = recent.filter((r) => r.category === cat.category);
      const latest = catInspections[0] ?? null;
      const alertCount = catInspections.filter((r) => r.drift.status !== 'STABLE').length;
      return {
        category: cat.category,
        referenceStats: cat.referenceFeatureStats,
        latestStats: latest?.featureStats ?? null,
        latestDriftScore: latest?.drift.driftScore ?? 0,
        latestStatus: latest?.drift.status ?? 'STABLE',
        alertCount,
      };
    });

    res.json({
      overallStatus: latestWithRef?.drift.status ?? 'STABLE',
      latestInspectionId: latestWithRef?.id ?? null,
      latestDrift: latestWithRef?.drift ?? null,
      categoryDrift,
      recentSeries: [...recent]
        .reverse()
        .slice(-20)
        .map((r, i) => ({
          index: i + 1,
          id: r.id,
          category: r.category,
          driftScore: r.drift.driftScore,
          status: r.drift.status,
          time: new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        })),
    });
  });

  app.get('/api/drift/history', (_req, res) => {
    res.json({ events: getDriftHistory(60) });
  });

  // =========================================================================
  // HUMAN REVIEW CENTER
  // =========================================================================
  app.get('/api/reviews/pending', (_req, res) => {
    res.json({ pending: getPendingReviews() });
  });

  app.post('/api/reviews/:id/decision', (req: AuthenticatedRequest, res) => {
    const parsed = ReviewDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid review decision.' });
      return;
    }
    const reviewer = req.user ? `${req.user.username} (${req.user.role})` : 'Quality Operator';
    const updated = saveReviewDecision(req.params.id, parsed.data.decision, parsed.data.notes, reviewer);
    if (!updated) {
      res.status(404).json({ error: 'Inspection record not found.' });
      return;
    }
    logAudit(
      reviewer,
      req.user?.role ?? 'Operator',
      'HUMAN_REVIEW',
      req.params.id,
      `Decision: ${parsed.data.decision}. Notes: ${parsed.data.notes.slice(0, 120)}`
    );
    res.json({ inspection: updated });
  });

  // =========================================================================
  // INDUSTRIAL DEPLOYMENT MODULE
  // =========================================================================
  app.get('/api/industrial/status', (_req, res) => {
    const overview = getAnalyticsOverview();
    const rules = listIndustrialRules();
    const events = listIndustrialEvents(40);
    res.json({
      lineStatus: 'READY_FOR_ACQUISITION',
      adapters: [
        {
          id: 'webcam-browser',
          name: 'Browser Webcam Prototype (WebRTC getUserMedia)',
          protocol: 'Local Browser Video Stream',
          status: 'SUPPORTED',
          note: 'Active prototype adapter for live frame capture and real-time inspection.',
        },
        {
          id: 'gige-vision',
          name: 'GigE Vision / GenICam Industrial Camera Adapter',
          protocol: 'GigE Vision 2.0 (Interface Ready)',
          status: 'HARDWARE_NOT_CONNECTED',
          note: 'Extensible REST ingestion interface ready; physical PLC/camera hardware not connected in this container.',
        },
        {
          id: 'usb3-vision',
          name: 'USB3 Vision / RTSP Conveyor Line Adapter',
          protocol: 'RTSP / Frame Webhook',
          status: 'HARDWARE_NOT_CONNECTED',
          note: 'Accepts automated multipart frame pushes at POST /api/inspect.',
        },
      ],
      metrics: {
        totalInspected: overview.totalInspected,
        normalCount: overview.normalCount,
        defectCount: overview.defectCount,
        defectRatePct: overview.defectDetectionRatePct,
        avgTimeMs: overview.performance.avgTimeMs,
      },
      rules,
      events,
    });
  });

  app.post('/api/industrial/rules', (req: AuthenticatedRequest, res) => {
    const body = req.body ?? {};
    const name = String(body.name || '').trim().slice(0, 80);
    const category = sanitizeCategory(body.category);
    const maxAnomalyScore = Number(body.maxAnomalyScore);
    const consecutiveDefectAlertCount = Math.max(1, Math.min(20, Number(body.consecutiveDefectAlertCount || 3)));
    const autoRejectSeverity = (['LOW', 'MEDIUM', 'HIGH'].includes(body.autoRejectSeverity)
      ? body.autoRejectSeverity
      : 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH';
    const enabled = Boolean(body.enabled ?? true);

    if (!name || !Number.isFinite(maxAnomalyScore) || maxAnomalyScore < 0.1 || maxAnomalyScore > 0.95) {
      res.status(400).json({ error: 'Provide a valid rule name and max anomaly score between 0.10 and 0.95.' });
      return;
    }

    const rule = upsertIndustrialRule({
      id: typeof body.id === 'string' && body.id.length > 2 ? body.id : `rule-${Date.now().toString(36)}`,
      name,
      category,
      maxAnomalyScore: Number(maxAnomalyScore.toFixed(2)),
      autoRejectSeverity,
      consecutiveDefectAlertCount,
      enabled,
    });
    res.json({ rule });
  });

  // =========================================================================
  // SETTINGS
  // =========================================================================
  app.get('/api/settings', (_req, res) => {
    res.json({ settings: getSettings() });
  });

  app.put('/api/settings', (req: AuthenticatedRequest, res) => {
    if ((countAdmins() > 0 || hasEnvAdminPasscode()) && (!req.user || !['Admin', 'Engineer'].includes(req.user.role))) {
      res.status(403).json({ error: 'Updating system settings requires Admin or Engineer sign-in.' });
      return;
    }
    const parsed = SettingsUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid settings configuration.',
      });
      return;
    }
    const saved = saveSettings(parsed.data);
    if (req.user) {
      logAudit(req.user.username, req.user.role, 'UPDATE_SETTINGS', 'global', 'Updated inspection and threshold settings.');
    }
    res.json({ settings: saved });
  });

  // Global error handler (never leaks internal paths or stack traces)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    serverMetrics.apiErrors++;
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'Uploaded image exceeds the 10 MB size limit.' });
        return;
      }
      res.status(400).json({ error: `File upload error: ${err.message}` });
      return;
    }
    console.error('Unhandled API error:', err);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  });

  // =========================================================================
  // VITE DEV MIDDLEWARE / PRODUCTION STATIC SERVING
  // =========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PROMETHEUS-X server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start PROMETHEUS-X server:', err);
  process.exit(1);
});
