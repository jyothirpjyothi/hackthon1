# PROMETHEUS-X — Open-Set Industrial Anomaly Detection Platform

PROMETHEUS-X is a full-stack industrial quality inspection platform combining a **Multi-Scale PatchCore Normal-Pattern Memory Bank** with server-side **Gemini Vision (`gemini-4-hydrogen`)** open-set defect localization, Jet anomaly heatmaps, toggleable **Rectangle & Circle** defect annotations, severity estimation, validation-backed confidence calibration (Platt & Temperature scaling, ECE), statistical distribution shift monitoring, human-in-the-loop false-positive management, webcam acquisition prototype, and RBAC audit governance.

## Architecture

- **Frontend (`src/`)**: React 19, TypeScript, Vite, Tailwind CSS v4, Recharts, Lucide React
- **Backend (`server.ts`, `server/`)**: Express.js REST API, `better-sqlite3` (WAL mode), `sharp` image preprocessing and PNG heatmap/mask rendering, `@google/genai` server-side Gemini Vision integration, `multer` magic-byte upload validation, `express-rate-limit`, `zod` validation
- **Machine Learning (`server/ml/`)**:
  - `engine.ts`: Multi-scale patch feature extraction, foreground border suppression, greedy coreset memory bank, k-NN anomaly scoring, hybrid anomaly map fusion, Jet colormap renderer, severity estimation, Platt/Temperature calibration, AUROC/AP/F1/ECE validation evaluator, and Mahalanobis/Z-score distribution shift detector.
  - `visionService.ts`: End-to-end inspection pipeline, category memory-bank training, and Gemini Vision structured bounding localization.

## Local Development

```bash
npm install
npm run dev
```

Application and REST API run on `http://localhost:3000`.

## Running Tests & Build

```bash
npx --yes tsx --test server/ml/engine.test.ts server/services/security.test.ts
npm run lint
npm run build
```

## Key REST API Endpoints

- `GET /api/health`, `GET /api/system/info`, `GET /api/samples`
- `POST /api/inspect`, `POST /api/inspect/batch`, `GET /api/inspections`, `GET /api/inspections/:id`, `DELETE /api/inspections/:id`
- `GET /api/reports/:id`, `GET /api/reports/export/csv`
- `GET /api/analytics/overview`, `GET /api/analytics/severity`, `GET /api/analytics/trends`, `GET /api/analytics/false-positives`
- `GET /api/dataset`, `POST /api/dataset/upload`, `DELETE /api/dataset/:id`
- `GET /api/model/status`, `GET /api/model/info`, `POST /api/model/train`
- `GET /api/drift/status`, `GET /api/drift/history`
- `GET /api/reviews/pending`, `POST /api/reviews/:id/decision`
- `GET /api/industrial/status`, `POST /api/industrial/rules`
- `GET /api/settings`, `PUT /api/settings`
- `GET /api/auth/status`, `POST /api/auth/bootstrap-admin`, `POST /api/auth/login`, `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id/role`, `GET /api/audit-logs`, `GET /api/database/backup`
