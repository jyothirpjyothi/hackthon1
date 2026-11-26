import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Camera,
  Cpu,
  Database,
  History,
  LayoutDashboard,
  Menu,
  Radar,
  ScanSearch,
  Settings,
  Shield,
  SlidersHorizontal,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  AnalyticsOverview,
  AuthUser,
  InspectionRecord,
  SystemSettings,
} from './types/prometheus';
import { api } from './services/api';
import { LandingPage } from './pages/LandingPage';
import { DashboardPage } from './pages/DashboardPage';
import { InspectionStudioPage } from './pages/InspectionStudioPage';
import { LocalizationPage } from './pages/LocalizationPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { HistoryPage } from './pages/HistoryPage';
import { DriftMonitorPage } from './pages/DriftMonitorPage';
import { HumanReviewPage } from './pages/HumanReviewPage';
import { DatasetModelPage } from './pages/DatasetModelPage';
import { IndustrialPage } from './pages/IndustrialPage';
import { SettingsPage } from './pages/SettingsPage';
import { SecurityPage } from './pages/SecurityPage';

type WorkspaceTab =
  | 'dashboard'
  | 'studio'
  | 'localization'
  | 'analytics'
  | 'history'
  | 'drift'
  | 'review'
  | 'dataset'
  | 'model'
  | 'industrial'
  | 'settings'
  | 'security';

const NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  group: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Dashboard', group: 'Inspection', icon: LayoutDashboard },
  { id: 'studio', label: 'AI Inspection Studio', group: 'Inspection', icon: ScanSearch },
  { id: 'localization', label: 'Defect Localization', group: 'Inspection', icon: SlidersHorizontal },
  { id: 'review', label: 'Human Review Center', group: 'Inspection', icon: UserCheck },
  { id: 'history', label: 'Inspection History', group: 'Intelligence', icon: History },
  { id: 'analytics', label: 'Analytics & Speed', group: 'Intelligence', icon: BarChart3 },
  { id: 'drift', label: 'Distribution Shift', group: 'Intelligence', icon: Radar },
  { id: 'dataset', label: 'Dataset Manager', group: 'ML Pipeline', icon: Database },
  { id: 'model', label: 'Model & Calibration', group: 'ML Pipeline', icon: Cpu },
  { id: 'industrial', label: 'Industrial Line', group: 'Operations', icon: Camera },
  { id: 'security', label: 'Security & Access', group: 'Operations', icon: Shield },
  { id: 'settings', label: 'Settings', group: 'Operations', icon: Settings },
];

const FALLBACK_SETTINGS: SystemSettings = {
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

export default function App() {
  const [showLanding, setShowLanding] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('autostart') !== '1';
  });
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [selectedLocalizationId, setSelectedLocalizationId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SystemSettings>(FALLBACK_SETTINGS);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, list, setRes, authRes] = await Promise.all([
        api.getAnalyticsOverview(),
        api.listInspections(),
        api.getSettings(),
        api.getAuthStatus(),
      ]);
      setOverview(ov);
      setInspections(list.inspections);
      setSettings(setRes.settings);
      setCurrentUser(authRes.user);
    } catch {
      // handled per page
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!showLanding) {
      refreshWorkspace();
    }
  }, [showLanding, refreshWorkspace]);

  const handleLaunch = (target?: string) => {
    setShowLanding(false);
    if (target && NAV_ITEMS.some((i) => i.id === target)) {
      setActiveTab(target as WorkspaceTab);
    } else {
      setActiveTab('studio');
    }
  };

  const handleNavigate = (tab: string, inspectionId?: string) => {
    if (inspectionId) setSelectedLocalizationId(inspectionId);
    if (NAV_ITEMS.some((i) => i.id === tab)) {
      setActiveTab(tab as WorkspaceTab);
    }
    setMobileMenuOpen(false);
  };

  const handleInspectionCompleted = (record: InspectionRecord) => {
    setSelectedLocalizationId(record.id);
    refreshWorkspace();
  };

  if (showLanding) {
    return <LandingPage onLaunch={handleLaunch} />;
  }

  const activeNavItem = NAV_ITEMS.find((i) => i.id === activeTab) ?? NAV_ITEMS[0];
  const groups = ['Inspection', 'Intelligence', 'ML Pipeline', 'Operations'];

  return (
    <div className="flex min-h-screen bg-[#080d18] text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-800/80 bg-[#0b1222] lg:flex lg:flex-col">
        <div className="flex h-16 items-center justify-between border-b border-slate-800/80 px-5">
          <button
            type="button"
            onClick={() => setShowLanding(true)}
            className="font-display text-base font-bold tracking-tight text-white hover:text-sky-400 transition-colors"
          >
            PROMETHEUS-X
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Workspace navigation">
          {groups.map((group) => (
            <div key={group}>
              <p className="px-3 text-[11px] font-medium text-slate-500">{group}</p>
              <div className="mt-1.5 space-y-0.5">
                {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNavigate(item.id)}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-sky-600/15 text-sky-300'
                          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2.5 truncate">
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.id === 'review' && (overview?.pendingReviewCount ?? 0) > 0 && (
                        <span className="font-mono text-[11px] tabular-nums text-amber-400">
                          {overview!.pendingReviewCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-800/80 p-4 text-xs">
          <button
            type="button"
            onClick={() => handleNavigate('security')}
            className="w-full text-left text-slate-400 hover:text-white"
          >
            <p className="font-medium text-slate-200">
              {currentUser ? currentUser.username : 'Operator Mode'}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {currentUser ? `${currentUser.role} Session` : 'Sign in for Admin / Engineer RBAC'}
            </p>
          </button>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 flex w-72 flex-col border-r border-slate-800 bg-[#0b1222]">
            <div className="flex h-16 items-center justify-between border-b border-slate-800 px-5">
              <span className="font-display text-base font-bold text-white">PROMETHEUS-X</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                className="rounded p-1 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      isActive ? 'bg-sky-600/15 text-sky-300' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Clean Contextual Top Bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-slate-800/80 bg-[#080d18]/90 px-4 backdrop-blur-md lg:px-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="rounded-lg border border-slate-800 p-2 text-slate-300 hover:text-white lg:hidden"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-400 truncate">
              <span className="hidden sm:inline">{activeNavItem.group}</span>
              <span className="hidden sm:inline" aria-hidden="true">/</span>
              <h1 className="font-display text-sm font-semibold text-white truncate">
                {activeNavItem.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => refreshWorkspace()}
              aria-label="Refresh workspace metrics"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-600 hover:text-white whitespace-nowrap shrink-0"
            >
              <Activity className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
              <span className="hidden sm:inline">Sync</span>
            </button>
            {activeTab !== 'studio' && (
              <button
                type="button"
                onClick={() => handleNavigate('studio')}
                className="rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 whitespace-nowrap shrink-0"
              >
                New Inspection
              </button>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">
          {activeTab === 'dashboard' && (
            <DashboardPage
              overview={overview}
              recentInspections={inspections}
              loading={loading}
              onNavigate={handleNavigate}
            />
          )}

          {activeTab === 'studio' && (
            <InspectionStudioPage
              defaultShape={settings.defaultMarkerShape}
              onInspectionCompleted={handleInspectionCompleted}
              onOpenLocalization={(id) => handleNavigate('localization', id)}
            />
          )}

          {activeTab === 'localization' && (
            <LocalizationPage
              inspections={inspections}
              selectedId={selectedLocalizationId}
              onSelectId={setSelectedLocalizationId}
              defaultShape={settings.defaultMarkerShape}
              onGoToStudio={() => handleNavigate('studio')}
            />
          )}

          {activeTab === 'analytics' && (
            <AnalyticsPage
              overview={overview}
              onGoToStudio={() => handleNavigate('studio')}
            />
          )}

          {activeTab === 'history' && (
            <HistoryPage
              inspections={inspections}
              onRefresh={refreshWorkspace}
              onOpenLocalization={(id) => handleNavigate('localization', id)}
            />
          )}

          {activeTab === 'drift' && <DriftMonitorPage />}

          {activeTab === 'review' && (
            <HumanReviewPage
              overview={overview}
              defaultShape={settings.defaultMarkerShape}
              onDecisionSaved={refreshWorkspace}
            />
          )}

          {(activeTab === 'dataset' || activeTab === 'model') && (
            <DatasetModelPage initialSection={activeTab} />
          )}

          {activeTab === 'industrial' && (
            <IndustrialPage
              defaultShape={settings.defaultMarkerShape}
              onInspectionCompleted={handleInspectionCompleted}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsPage
              settings={settings}
              onSettingsUpdated={(next) => setSettings(next)}
            />
          )}

          {activeTab === 'security' && (
            <SecurityPage
              currentUser={currentUser}
              onUserChanged={(u) => setCurrentUser(u)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
