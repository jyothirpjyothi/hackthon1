import type {
  AnalyticsOverview,
  AuditLogEntry,
  AuthUser,
  CategoryModelStatus,
  DatasetImageRecord,
  DatasetSplit,
  IndustrialEvent,
  IndustrialRule,
  InspectionRecord,
  SampleSpecimen,
  SystemSettings,
  UserRole,
} from '../types/prometheus';

// Auth token is stored strictly in JS memory (never localStorage or sessionStorage)
let authTokenInMemory: string | null = null;

export function setAuthToken(token: string | null): void {
  authTokenInMemory = token;
}

export function getAuthToken(): string | null {
  return authTokenInMemory;
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (authTokenInMemory) {
    headers.Authorization = `Bearer ${authTokenInMemory}`;
  }
  return headers;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = buildHeaders(
    init?.body instanceof FormData
      ? {}
      : { 'Content-Type': 'application/json' }
  );
  const res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getHealth: () =>
    requestJson<{
      status: string;
      uptimeSeconds: number;
      databaseAvailable: boolean;
      geminiVisionAvailable: boolean;
      trainedCategories: number;
      apiErrors: number;
      inspectionFailures: number;
    }>('/api/health'),

  getSystemInfo: () =>
    requestJson<{
      platform: string;
      architecture: string;
      geminiModel: string | null;
      categories: string[];
      trainedCategoryCount: number;
      memoryRssMb: number;
      heapUsedMb: number;
      nodeVersion: string;
      databaseEngine: string;
      adminClaimed: boolean;
      envAdminPasscodeConfigured: boolean;
    }>('/api/system/info'),

  getSamples: () => requestJson<{ samples: SampleSpecimen[] }>('/api/samples'),

  inspectFile: (file: File, category: string, skipDuplicate = false) => {
    const fd = new FormData();
    fd.append('image', file);
    fd.append('category', category);
    fd.append('source', 'upload');
    fd.append('skipDuplicate', String(skipDuplicate));
    return requestJson<{ inspection: InspectionRecord; deduplicated: boolean }>('/api/inspect', {
      method: 'POST',
      body: fd,
    });
  },

  inspectSample: (sampleId: string, category: string) =>
    requestJson<{ inspection: InspectionRecord; deduplicated: boolean }>('/api/inspect', {
      method: 'POST',
      body: JSON.stringify({ sampleId, category, source: 'sample' }),
    }),

  inspectWebcamFrame: (imageBase64: string, category: string) =>
    requestJson<{ inspection: InspectionRecord; deduplicated: boolean }>('/api/inspect', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, category, source: 'webcam' }),
    }),

  inspectBatch: (files: File[], category: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('images', f));
    fd.append('category', category);
    return requestJson<{
      batchId: string;
      totalSubmitted: number;
      processedCount: number;
      skippedDuplicates: number;
      errorCount: number;
      totalBatchMs: number;
      inspections: InspectionRecord[];
      errors: Array<{ filename: string; error: string }>;
    }>('/api/inspect/batch', {
      method: 'POST',
      body: fd,
    });
  },

  listInspections: (params?: {
    category?: string;
    prediction?: string;
    severity?: string;
    reviewStatus?: string;
    search?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.prediction) qs.set('prediction', params.prediction);
    if (params?.severity) qs.set('severity', params.severity);
    if (params?.reviewStatus) qs.set('reviewStatus', params.reviewStatus);
    if (params?.search) qs.set('search', params.search);
    const query = qs.toString();
    return requestJson<{ inspections: InspectionRecord[] }>(
      `/api/inspections${query ? `?${query}` : ''}`
    );
  },

  getInspection: (id: string) =>
    requestJson<{ inspection: InspectionRecord }>(`/api/inspections/${encodeURIComponent(id)}`),

  deleteInspection: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/inspections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getAnalyticsOverview: () => requestJson<AnalyticsOverview>('/api/analytics/overview'),

  getDataset: (category?: string, split?: string) => {
    const qs = new URLSearchParams();
    if (category) qs.set('category', category);
    if (split) qs.set('split', split);
    const query = qs.toString();
    return requestJson<{
      images: DatasetImageRecord[];
      summaryByCategory: Array<{
        category: string;
        trainNormal: number;
        valNormal: number;
        valDefect: number;
        testDefect: number;
        total: number;
      }>;
    }>(`/api/dataset${query ? `?${query}` : ''}`);
  },

  uploadDatasetImages: (params: {
    files: File[];
    category: string;
    split: DatasetSplit;
    lighting: string;
    cameraAngle: string;
    background: string;
  }) => {
    const fd = new FormData();
    params.files.forEach((f) => fd.append('images', f));
    fd.append('category', params.category);
    fd.append('split', params.split);
    fd.append('lighting', params.lighting);
    fd.append('cameraAngle', params.cameraAngle);
    fd.append('background', params.background);
    return requestJson<{
      added: DatasetImageRecord[];
      duplicatesSkipped: number;
      rejected: Array<{ filename: string; reason: string }>;
    }>('/api/dataset/upload', {
      method: 'POST',
      body: fd,
    });
  },

  deleteDatasetImage: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/dataset/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getModelInfo: () =>
    requestJson<{
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
        evaluation: unknown;
        createdAt: string;
      }>;
    }>('/api/model/info'),

  trainModel: (category: string) =>
    requestJson<{
      trained: {
        category: string;
        version: string;
        normalImageCount: number;
        coresetPatchCount: number;
        evaluation: CategoryModelStatus['evaluation'];
      };
    }>('/api/model/train', {
      method: 'POST',
      body: JSON.stringify({ category }),
    }),

  getDriftStatus: () =>
    requestJson<{
      overallStatus: string;
      latestInspectionId: string | null;
      latestDrift: InspectionRecord['drift'] | null;
      categoryDrift: Array<{
        category: string;
        referenceStats: InspectionRecord['featureStats'] | null;
        latestStats: InspectionRecord['featureStats'] | null;
        latestDriftScore: number;
        latestStatus: string;
        alertCount: number;
      }>;
      recentSeries: Array<{
        index: number;
        id: string;
        category: string;
        driftScore: number;
        status: string;
        time: string;
      }>;
    }>('/api/drift/status'),

  getDriftHistory: () =>
    requestJson<{
      events: Array<{
        id: string;
        inspectionId: string | null;
        category: string;
        status: string;
        driftScore: number;
        causes: string[];
        recommendedActions: string[];
        featureDeltas: Array<{ feature: string; reference: number; current: number; zScore: number }>;
        createdAt: string;
      }>;
    }>('/api/drift/history'),

  getPendingReviews: () => requestJson<{ pending: InspectionRecord[] }>('/api/reviews/pending'),

  submitReviewDecision: (
    id: string,
    decision: 'APPROVED_NORMAL' | 'CONFIRMED_DEFECT' | 'FALSE_POSITIVE',
    notes: string
  ) =>
    requestJson<{ inspection: InspectionRecord }>(
      `/api/reviews/${encodeURIComponent(id)}/decision`,
      {
        method: 'POST',
        body: JSON.stringify({ decision, notes }),
      }
    ),

  getIndustrialStatus: () =>
    requestJson<{
      lineStatus: string;
      adapters: Array<{
        id: string;
        name: string;
        protocol: string;
        status: string;
        note: string;
      }>;
      metrics: {
        totalInspected: number;
        normalCount: number;
        defectCount: number;
        defectRatePct: number;
        avgTimeMs: number;
      };
      rules: IndustrialRule[];
      events: IndustrialEvent[];
    }>('/api/industrial/status'),

  saveIndustrialRule: (rule: Partial<IndustrialRule>) =>
    requestJson<{ rule: IndustrialRule }>('/api/industrial/rules', {
      method: 'POST',
      body: JSON.stringify(rule),
    }),

  getSettings: () => requestJson<{ settings: SystemSettings }>('/api/settings'),

  saveSettings: (settings: SystemSettings) =>
    requestJson<{ settings: SystemSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  getAuthStatus: () =>
    requestJson<{
      authenticated: boolean;
      user: AuthUser | null;
      adminClaimed: boolean;
      envPasscodeActive: boolean;
    }>('/api/auth/status'),

  bootstrapAdmin: (payload: { username: string; email: string; password: string }) =>
    requestJson<{ token: string; user: AuthUser }>('/api/auth/bootstrap-admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { username: string; password: string }) =>
    requestJson<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listUsers: () => requestJson<{ users: AuthUser[] }>('/api/users'),

  createUser: (payload: { username: string; email: string; password: string; role: UserRole }) =>
    requestJson<{ user: AuthUser }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateUserRole: (id: string, role: UserRole) =>
    requestJson<{ updated: boolean }>(`/api/users/${encodeURIComponent(id)}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  listAuditLogs: () => requestJson<{ logs: AuditLogEntry[] }>('/api/audit-logs'),

  downloadAuthenticatedBackup: async () => {
    const res = await fetch('/api/database/backup', {
      headers: buildHeaders(),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || 'Backup download failed.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prometheus-x-backup-${new Date().toISOString().slice(0, 10)}.db`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
