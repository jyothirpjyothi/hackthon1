import crypto from 'crypto';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { UserRole } from '../../src/types/prometheus';

// Session signing key: read from process.env or generate ephemeral per-boot random 32-byte key in memory
const SESSION_SIGNING_KEY =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto.randomBytes(32).toString('hex');

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface SessionPayload {
  userId: string;
  username: string;
  email: string;
  role: UserRole;
  exp: number;
}

export interface AuthenticatedRequest extends Request {
  user?: SessionPayload;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const stored = Buffer.from(keyHex, 'hex');
    if (derived.length !== stored.length) return false;
    return crypto.timingSafeEqual(derived, stored);
  } catch {
    return false;
  }
}

export function verifyEnvAdminPasscode(candidate: string): boolean {
  const configured = process.env.PROMETHEUS_ADMIN_PASSCODE;
  if (!configured || configured.trim().length === 0) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function hasEnvAdminPasscode(): boolean {
  return Boolean(process.env.PROMETHEUS_ADMIN_PASSCODE && process.env.PROMETHEUS_ADMIN_PASSCODE.trim().length > 0);
}

export function signSessionToken(payload: Omit<SessionPayload, 'exp'>, ttlSeconds = 60 * 60 * 8): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SIGNING_KEY).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SIGNING_KEY)
    .update(encoded)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (!parsed.userId || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim();
}

export function attachOptionalUser(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (token) {
    const verified = verifySessionToken(token);
    if (verified) req.user = verified;
  }
  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Sign in via Security & Access.' });
    return;
  }
  const verified = verifySessionToken(token);
  if (!verified) {
    res.status(401).json({ error: 'Session token is invalid or expired. Please sign in again.' });
    return;
  }
  req.user = verified;
  next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Insufficient permissions. Requires one of: ${allowedRoles.join(', ')}.`,
      });
      return;
    }
    next();
  };
}

export function validateImageBuffer(
  buffer: Buffer,
  declaredMime?: string
): { valid: boolean; mimeType?: 'image/jpeg' | 'image/png'; error?: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Uploaded image file is empty.' };
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { valid: false, error: 'Image exceeds maximum allowed size of 10 MB.' };
  }
  // Verify magic bytes for JPEG (FF D8 FF) or PNG (89 50 4E 47 0D 0A 1A 0A)
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  if (!isJpeg && !isPng) {
    return { valid: false, error: 'Unsupported file signature. Only valid JPG/JPEG and PNG images are accepted.' };
  }
  const detectedMime = isJpeg ? 'image/jpeg' : 'image/png';
  if (
    declaredMime &&
    !['image/jpeg', 'image/jpg', 'image/png', 'application/octet-stream'].includes(declaredMime.toLowerCase())
  ) {
    return { valid: false, error: 'Unsupported MIME type. Only image/jpeg and image/png are allowed.' };
  }
  return { valid: true, mimeType: detectedMime };
}

export function resolveSafePath(baseDir: string, unsafeSegment: string): string | null {
  const sanitized = path.basename(unsafeSegment).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!sanitized || sanitized === '.' || sanitized === '..') return null;
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, sanitized);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    return null;
  }
  return resolvedTarget;
}

export function computeBufferSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export const SettingsUpdateSchema = z
  .object({
    anomalyThreshold: z.number().min(0.1).max(0.95),
    reviewLowerThreshold: z.number().min(0.05).max(0.9),
    severityLowAreaPct: z.number().min(0.1).max(30),
    severityMediumAreaPct: z.number().min(0.5).max(50),
    severityHighAreaPct: z.number().min(1).max(80),
    severityHighIntensity: z.number().min(0.3).max(0.99),
    driftWarningThreshold: z.number().min(0.5).max(10),
    driftCriticalThreshold: z.number().min(1.0).max(15),
    calibrationUncertaintyCutoff: z.number().min(0.05).max(0.8),
    preprocessingSize: z.union([z.literal(256), z.literal(320), z.literal(384)]),
    defaultMarkerShape: z.enum(['rectangle', 'circle']),
    foregroundSuppression: z.boolean(),
    useGeminiVision: z.boolean(),
    calibrationMethod: z.enum(['platt_scaling', 'temperature_scaling']),
    activeModelArchitecture: z.enum([
      'PatchCore + Gemini Vision Hybrid',
      'PatchCore Multi-Scale',
      'EfficientAD Lightweight',
    ]),
  })
  .refine((v) => v.reviewLowerThreshold < v.anomalyThreshold, {
    message: 'Review lower threshold must be strictly less than anomaly threshold.',
  })
  .refine((v) => v.severityLowAreaPct < v.severityMediumAreaPct && v.severityMediumAreaPct < v.severityHighAreaPct, {
    message: 'Severity area thresholds must be strictly increasing (Low < Medium < High).',
  })
  .refine((v) => v.driftWarningThreshold < v.driftCriticalThreshold, {
    message: 'Drift warning threshold must be less than drift critical threshold.',
  });

export const ReviewDecisionSchema = z.object({
  decision: z.enum(['APPROVED_NORMAL', 'CONFIRMED_DEFECT', 'FALSE_POSITIVE']),
  notes: z.string().max(1000).optional().default(''),
});

export const BootstrapAdminSchema = z.object({
  username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().email().max(120),
  password: z.string().min(8).max(128),
});

export const LoginSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(128),
});

export const CreateUserSchema = z.object({
  username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  email: z.string().email().max(120),
  password: z.string().min(8).max(128),
  role: z.enum(['Admin', 'Engineer', 'Operator']),
});
