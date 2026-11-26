import { ArrowRight, Layers, Radar, ShieldCheck, SlidersHorizontal } from 'lucide-react';

interface LandingPageProps {
  onLaunch: (targetTab?: string) => void;
}

export function LandingPage({ onLaunch }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-[#080d18] text-slate-100">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#080d18]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            PROMETHEUS-X
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
            <a href="#problem" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Problem
            </a>
            <a href="#capabilities" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Capabilities
            </a>
            <a href="#pipeline" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Architecture
            </a>
            <a href="#stack" className="hover:text-white transition-colors whitespace-nowrap shrink-0">
              Technology
            </a>
          </nav>

          <button
            type="button"
            onClick={() => onLaunch('studio')}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
          >
            Launch Platform
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <main id="top">
        {/* Hero Section — Balanced 2-Column Industrial Split */}
        <section className="mx-auto max-w-7xl px-6 pt-16 pb-20 lg:pt-24 lg:pb-24">
          <div className="grid grid-cols-1 items-stretch gap-12 lg:grid-cols-12">
            <div className="flex flex-col justify-center lg:col-span-6">
              <p className="text-xs font-medium tracking-wide text-sky-400">
                Open-Set Industrial Quality Inspection · Normal-Pattern Learning
              </p>
              <h1
                className="mt-4 font-display font-bold tracking-tight text-white leading-[1.08]"
                style={{ fontSize: 'clamp(2.25rem, 4.2vw, 3.6rem)', textWrap: 'balance' }}
              >
                Detect the Defect Your Model Has Never Seen.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-300">
                Intelligent industrial anomaly detection powered by normal-pattern learning, visual localization, and adaptive distribution monitoring.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => onLaunch('studio')}
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
                >
                  Open AI Inspection Studio
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onLaunch('dashboard')}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-medium text-slate-200 hover:border-slate-500 hover:text-white transition-colors whitespace-nowrap shrink-0"
                >
                  View Operations Dashboard
                </button>
              </div>
              <p className="mt-8 text-xs text-slate-500">
                MVTec AD Compatible Categories · PatchCore Memory Bank + Gemini Vision Fusion · SQLite Inspection Ledger
              </p>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-full min-h-[300px] overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                <img
                  src="/src/assets/images/hero_industrial_inspection_1795654732689.jpg"
                  alt="Automated optical inspection camera rig above machined industrial components"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#080d18]/90 via-[#080d18]/20 to-transparent" />
                <div className="absolute bottom-5 left-5 right-5 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-xs text-sky-300">Multi-Scale Optical Inspection</p>
                    <p className="mt-0.5 text-sm font-semibold text-white">
                      Pixel-Level Jet Heatmaps · Rectangle &amp; Circle Defect Localization
                    </p>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-slate-300">
                    256–384px Patch Grid
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Full-width Operational Architecture Strip below Hero Split */}
          <div className="mt-14 grid grid-cols-1 gap-6 border-t border-slate-800/80 pt-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="font-display text-lg font-semibold text-white">Normal-Only Training</p>
              <p className="mt-1.5 text-sm text-slate-400">
                Learns pristine manufacturing baselines without requiring labeled examples of every future defect.
              </p>
            </div>
            <div>
              <p className="font-display text-lg font-semibold text-white">Sub-Region Localization</p>
              <p className="mt-1.5 text-sm text-slate-400">
                Outputs Jet anomaly heatmaps, foreground-filtered masks, and crisp rectangle or circle defect markers.
              </p>
            </div>
            <div>
              <p className="font-display text-lg font-semibold text-white">Calibrated Uncertainty</p>
              <p className="mt-1.5 text-sm text-slate-400">
                Platt and temperature scaling with Expected Calibration Error tracking and human-review escalation.
              </p>
            </div>
            <div>
              <p className="font-display text-lg font-semibold text-white">Distribution Drift Watch</p>
              <p className="mt-1.5 text-sm text-slate-400">
                Separates lighting, camera, or material shifts from true part defects using baseline feature statistics.
              </p>
            </div>
          </div>
        </section>

        {/* Problem Statement */}
        <section id="problem" className="border-t border-slate-800/80 bg-[#0b1222]">
          <div className="mx-auto max-w-7xl px-6 py-20">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <p className="text-xs font-medium text-sky-400">The Industrial Challenge</p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-white">
                  Closed-set defect classifiers miss rare, unseen failures on the line.
                </h2>
              </div>
              <div className="lg:col-span-7 space-y-4 text-sm leading-relaxed text-slate-300">
                <p>
                  High-volume manufacturing lines inspect thousands of precision fasteners, semiconductors, cables, and milled surfaces every shift. Traditional supervised defect detectors only recognize flaw classes captured in historical training data—leaving production vulnerable when tooling wear, foreign contamination, or novel material fractures appear for the first time.
                </p>
                <p>
                  PROMETHEUS-X flips the paradigm. By indexing multi-scale normal patch features into a compact coreset memory bank and fusing them with open-set Gemini Vision localization, the platform flags deviations from normal appearance, estimates severity, detects sensor/lighting distribution shifts, and routes uncertain cases to engineers through a human-in-the-loop review queue.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Asymmetric Bento Capabilities */}
        <section id="capabilities" className="mx-auto max-w-7xl px-6 py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-medium text-sky-400">Core Inspection Capabilities</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-white">
              Six synchronized engines built for real manufacturing accountability.
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-2">
              <Layers className="h-5 w-5 text-sky-400" aria-hidden="true" />
              <h3 className="mt-4 font-display text-lg font-semibold text-white">
                01. Open-Set PatchCore Memory Bank &amp; Vision Fusion
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Extracts multi-scale color, gradient, Laplacian texture, and local neighborhood contrast descriptors from normal training specimens. During inspection, k-NN distance against the category memory bank is fused with Gemini Vision localization and foreground suppression—eliminating false background edge bleed while isolating micro-scratches, dents, and bent leads.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6">
              <SlidersHorizontal className="h-5 w-5 text-sky-400" aria-hidden="true" />
              <h3 className="mt-4 font-display text-lg font-semibold text-white">
                02. Rectangle &amp; Circle Localization
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Inspect every specimen through Original, Jet Pixel Anomaly Heatmap, toggleable Rectangle or Circle Defect Overlay, and Thresholded Binary Mask panels.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6">
              <Radar className="h-5 w-5 text-sky-400" aria-hidden="true" />
              <h3 className="mt-4 font-display text-lg font-semibold text-white">
                03. Distribution Shift Monitoring
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Tracks luminance, contrast, edge sharpness, color balance, and framing against baseline statistics so illumination changes trigger drift warnings instead of silent misclassifications.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-6 lg:col-span-2">
              <ShieldCheck className="h-5 w-5 text-sky-400" aria-hidden="true" />
              <h3 className="mt-4 font-display text-lg font-semibold text-white">
                04. Validation Calibration, Human Review &amp; RBAC Governance
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Fits Platt and Temperature scaling strictly on held-out validation splits to compute AUROC, Average Precision, F1, and Expected Calibration Error (ECE). Uncertain predictions route to the Human Review Center for false-positive tracking, backed by SQLite persistence, audit logs, and Admin/Engineer/Operator role controls.
              </p>
            </div>
          </div>
        </section>

        {/* How the AI Works — 4 Step Pipeline */}
        <section id="pipeline" className="border-t border-slate-800/80 bg-[#0b1222]">
          <div className="mx-auto max-w-7xl px-6 py-20">
            <p className="text-xs font-medium text-sky-400">Inspection Pipeline</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-white">
              From raw optical frame to calibrated quality decision.
            </h2>

            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  step: '01',
                  title: 'Ingest & Validate',
                  body: 'Magic-byte JPEG/PNG verification, SHA-256 deduplication, and resolution normalization via Sharp.',
                },
                {
                  step: '02',
                  title: 'Feature & Drift Check',
                  body: 'Extracts multi-scale patch descriptors, suppresses background borders, and measures baseline statistical drift.',
                },
                {
                  step: '03',
                  title: 'Hybrid Anomaly Fusion',
                  body: 'Combines PatchCore k-NN memory bank distance with Gemini Vision open-set defect localization.',
                },
                {
                  step: '04',
                  title: 'Calibrate & Route',
                  body: 'Applies severity thresholds and confidence calibration to output PASS, DEFECT, or Human REVIEW.',
                },
              ].map((item) => (
                <div key={item.step} className="border-t border-slate-700 pt-5">
                  <span className="font-mono text-xs font-semibold text-sky-400">{item.step}</span>
                  <h3 className="mt-2 font-display text-base font-semibold text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Technology Stack & Conversion */}
        <section id="stack" className="mx-auto max-w-7xl px-6 py-20">
          <div className="flex flex-col justify-between gap-10 rounded-xl border border-slate-800 bg-[#0f172a] p-8 lg:flex-row lg:items-center">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-sky-400">Production Architecture</p>
              <h2 className="mt-2 font-display text-2xl font-bold text-white">
                Built on TypeScript, Express, SQLite, Sharp, PatchCore Math &amp; Gemini Vision.
              </h2>
              <p className="mt-3 text-sm text-slate-400">
                React 19 · Tailwind CSS · Recharts · Node.js Express REST API · Better-SQLite3 WAL · Multi-Scale Coreset Memory Bank · Live Webcam Prototype · RBAC Audit Trail.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onLaunch('studio')}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
            >
              Start Inspecting Now
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800/80 py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 text-xs text-slate-500">
          <span>PROMETHEUS-X · Open-Set Industrial Anomaly Detection Platform</span>
          <span>Estimated visual inspection metrics do not substitute certified structural safety testing.</span>
        </div>
      </footer>
    </div>
  );
}
