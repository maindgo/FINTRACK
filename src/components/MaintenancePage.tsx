import React, { useState } from 'react';
import { signOut } from 'firebase/auth';
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Cpu,
  Lock,
  LogOut,
  Mail,
  Moon,
  Power,
  ShieldCheck,
  Sparkles,
  Sun,
  Wallet,
  Wrench,
} from 'lucide-react';
import { auth } from '../firebase';
import { useFinance } from '../context/FinanceContext';
import {
  MAINTENANCE_BANNER_TEXT,
  MAINTENANCE_UPDATE_ITEMS,
  SUPPORT_EMAIL,
} from '../utils/constants';

interface MaintenancePageProps {
  onRequestAdminSignIn: () => void;
  onAdminEnterApp?: () => void;
}

const UPDATE_META: Record<
  (typeof MAINTENANCE_UPDATE_ITEMS)[number],
  { icon: React.ComponentType<{ className?: string }>; desc: string }
> = {
  'AI Accountant soon': {
    icon: Bot,
    desc: 'Automated smart ledger categorization and accounting assistance.',
  },
  'Budget Forecasting': {
    icon: BarChart3,
    desc: 'Predictive monthly cash-flow projections and spending targets.',
  },
  'Including AI': {
    icon: Sparkles,
    desc: 'Intelligent financial insights across expenses, savings, and bills.',
  },
  'Fix Bugs': {
    icon: ShieldCheck,
    desc: 'Performance tuning, stability improvements, and issue resolutions.',
  },
};

function MarqueeBannerContent() {
  const parts = MAINTENANCE_BANNER_TEXT.split(SUPPORT_EMAIL);
  return (
    <span className="inline-flex items-center gap-3 px-6 text-xs sm:text-sm font-medium tracking-wide whitespace-nowrap">
      <Cpu className="w-4 h-4 text-emerald-400 shrink-0" />
      <span>
        {parts[0]}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="underline decoration-emerald-400/70 text-emerald-300 hover:text-emerald-200 font-semibold"
        >
          {SUPPORT_EMAIL}
        </a>
        {parts[1] ?? ''}
      </span>
      <span className="text-slate-600 mx-4" aria-hidden="true">
        •
      </span>
    </span>
  );
}

export function MaintenancePage({
  onRequestAdminSignIn,
  onAdminEnterApp,
}: MaintenancePageProps) {
  const {
    firebaseUser,
    isGuest,
    exitGuestMode,
    isAdmin,
    theme,
    toggleTheme,
    maintenanceUpdating,
    setMaintenanceEnabledMode,
  } = useFinance();
  const [actionError, setActionError] = useState('');

  const handleTurnOffMaintenance = async () => {
    setActionError('');
    try {
      await setMaintenanceEnabledMode(false);
    } catch (err: unknown) {
      setActionError((err as Error)?.message || 'Unable to turn off maintenance mode.');
    }
  };

  const handleSwitchAccount = async () => {
    if (isGuest) {
      exitGuestMode();
    } else if (firebaseUser) {
      await signOut(auth);
    }
    onRequestAdminSignIn();
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Right-to-Left Scrolling Announcement Banner */}
      <div
        role="region"
        aria-label="FinTrack announcement banner"
        className="w-full bg-slate-900 dark:bg-slate-900/95 text-slate-100 border-b border-slate-800 overflow-hidden py-2.5 select-none"
      >
        <div className="animate-marquee-rtl">
          <MarqueeBannerContent />
          <MarqueeBannerContent />
        </div>
      </div>

      {/* Top Brand Bar */}
      <header className="w-full max-w-5xl mx-auto px-4 sm:px-6 pt-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-xs">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <div className="text-base font-bold tracking-tight text-slate-900 dark:text-white leading-none">
              FinTrack
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Smart Money Manager
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </header>

      {/* Main Scheduled Maintenance Card */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
        <div className="w-full max-w-3xl space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                <Wrench className="w-6 h-6" />
              </div>
              <div className="space-y-2 flex-1">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Scheduled Maintenance
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Scheduled Maintenance in Progress
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                  We are upgrading FinTrack with smarter accounting and forecasting capabilities. All of your financial records remain safely encrypted and preserved. We will be back online shortly.
                </p>
              </div>
            </div>

            {/* What includes in this update */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                  What includes in this update:
                </h2>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  4 Improvements
                </span>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                {MAINTENANCE_UPDATE_ITEMS.map((item) => {
                  const meta = UPDATE_META[item];
                  const Icon = meta.icon;
                  return (
                    <div
                      key={item}
                      className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800"
                    >
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>{item}</span>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                          {meta.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Contact Support Box */}
            <div className="rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
                <Mail className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                <span>
                  Have any problem or suggestions to add on in FinTrack? Reach out freely at{' '}
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="font-semibold text-emerald-700 dark:text-emerald-400 underline"
                  >
                    {SUPPORT_EMAIL}
                  </a>
                  .
                </span>
              </div>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 whitespace-nowrap self-start sm:self-auto shrink-0"
              >
                <Mail className="w-3.5 h-3.5" />
                Contact Support
              </a>
            </div>

            {/* Admin or Visitor Actions */}
            {isAdmin ? (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                      Admin Controls Active ({firebaseUser?.email})
                    </div>
                    <div className="text-xs text-emerald-700 dark:text-emerald-300">
                      Scheduled Maintenance is currently live for all visitors and regular users.
                    </div>
                  </div>
                </div>
                {actionError && (
                  <div className="text-xs text-red-600 dark:text-red-400">{actionError}</div>
                )}
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    disabled={maintenanceUpdating}
                    onClick={handleTurnOffMaintenance}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Power className="w-3.5 h-3.5" />
                    {maintenanceUpdating ? 'Updating...' : 'Turn Off Maintenance Mode'}
                  </button>
                  {onAdminEnterApp && (
                    <button
                      type="button"
                      onClick={onAdminEnterApp}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold hover:opacity-90"
                    >
                      <span>Open Workspace (Admin)</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => signOut(auth)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 text-xs font-medium text-emerald-900 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              </div>
            ) : firebaseUser || isGuest ? (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Signed in as{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {isGuest ? 'Guest Mode' : firebaseUser?.email}
                  </span>
                  . Workspace access will resume once maintenance completes.
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleSwitchAccount}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    Admin Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => (isGuest ? exitGuestMode() : signOut(auth))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    {isGuest ? 'Exit Guest' : 'Sign Out'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Thanks for using FinTrack.
                </span>
                <button
                  type="button"
                  onClick={onRequestAdminSignIn}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Admin Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
