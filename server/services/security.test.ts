import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  SettingsUpdateSchema,
  hashPassword,
  resolveSafePath,
  signSessionToken,
  validateImageBuffer,
  verifyPassword,
  verifySessionToken,
} from './security';

test('scrypt password hashing and verification work securely', () => {
  const hash = hashPassword('IndustrialQC#2026');
  assert.ok(hash.includes(':'));
  assert.equal(verifyPassword('IndustrialQC#2026', hash), true);
  assert.equal(verifyPassword('wrong-password', hash), false);
});

test('Bearer session token signs and verifies payload and rejects tampering', () => {
  const token = signSessionToken({
    userId: 'u-1',
    username: 'lead-engineer',
    email: 'lead@prometheus.local',
    role: 'Admin',
  });
  const verified = verifySessionToken(token);
  assert.ok(verified);
  assert.equal(verified?.role, 'Admin');
  assert.equal(verifySessionToken(token + 'tampered'), null);
});

test('Image magic-byte validation accepts valid JPEG/PNG and rejects disguised text files', () => {
  const jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const fakeBuf = Buffer.from('<script>alert(1)</script>');

  assert.equal(validateImageBuffer(jpegBuf, 'image/jpeg').valid, true);
  assert.equal(validateImageBuffer(pngBuf, 'image/png').valid, true);
  assert.equal(validateImageBuffer(fakeBuf, 'image/jpeg').valid, false);
});

test('Path confinement strips traversal sequences and keeps paths inside base directory', () => {
  const base = path.resolve('/tmp/prometheus-test');
  const safe = resolveSafePath(base, '../../etc/passwd');
  assert.ok(safe?.startsWith(base + path.sep));
  assert.equal(resolveSafePath(base, '..'), null);
});

test('Settings schema rejects invalid threshold ordering', () => {
  const invalid = SettingsUpdateSchema.safeParse({
    anomalyThreshold: 0.3,
    reviewLowerThreshold: 0.5, // invalid: >= anomalyThreshold
    severityLowAreaPct: 1.5,
    severityMediumAreaPct: 5.0,
    severityHighAreaPct: 12.0,
    severityHighIntensity: 0.78,
    driftWarningThreshold: 2.2,
    driftCriticalThreshold: 3.8,
    calibrationUncertaintyCutoff: 0.4,
    preprocessingSize: 256,
    defaultMarkerShape: 'rectangle',
    foregroundSuppression: true,
    useGeminiVision: true,
    calibrationMethod: 'platt_scaling',
    activeModelArchitecture: 'PatchCore + Gemini Vision Hybrid',
  });
  assert.equal(invalid.success, false);
});
