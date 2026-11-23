import React, { useState } from 'react';
import { signOut } from 'firebase/auth';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  CloudUpload,
  CreditCard,
  HandCoins,
  LayoutDashboard,
  Lightbulb,
  ListOrdered,
  LogIn,
  LogOut,
  Menu,
  Moon,
  PiggyBank,
  Plus,
  Settings,
  Sun,
  Target,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { auth } from '../firebase';
import { useFinance } from '../context/FinanceContext';
import { NavSection } from '../types/finance';
import { NAV_ITEMS } from '../utils/constants';

const NAV_ICONS: Record<NavSection, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  income: ArrowDownLeft,
  expenses: ArrowUpRight,
  transactions: ListOrdered,
  'profit-loss': TrendingUp,
  savings: PiggyBank,
  budgets: Target,
  'loans-debts': HandCoins,
  'bills-emis': CalendarClock,
  reports: BarChart3,
  insights: Lightbulb,
  settings: Settings,
};

interface LayoutShellProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  onQuickAddTransaction: (type: 'income' | 'expense') => void;
  children: React.ReactNode;
}

export function LayoutShell({
  activeSection,
  onSelectSection,
  onQuickAddTransaction,
  children,
}: LayoutShellProps) {
  const {
    user,
    isGuest,
    profile,
    currency,
    theme,
    toggleTheme,
    exitGuestMode,
    pendingGuestMigrationCount,
    migrateGuestToCloud,
    dismissGuestMigration,
  } = useFinance();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState('');

  const handleMigrateToCloud = async () => {
    setMigrating(true);
    setMigrationError('');
    try {
      await migrateGuestToCloud();
    } catch (err: unknown) {
      setMigrationError((err as Error)?.message || 'Failed to import guest records.');
    } finally {
      setMigrating(false);
    }
  };

  const activeLabel = NAV_ITEMS.find((n) => n.id === activeSection)?.label || 'Dashboard';

  const handleNavClick = (section: NavSection) => {
    onSelectSection(section);
    setMobileOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100 border-r border-slate-800">
      {/* Brand Header */}
      <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white shrink-0">
            <Wallet className="w-4 h-4" />
          </div>
          <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
            FinTrack
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = NAV_ICONS[item.id];
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Account Footer */}
      <div className="p-3 border-t border-slate-800 space-y-2 shrink-0">
        <div className="px-3 py-2 rounded-lg bg-slate-800/60 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-xs font-bold text-emerald-400 shrink-0">
            {(profile?.displayName || user?.displayName || user?.email || 'U')
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-white truncate">
              {profile?.displayName || user?.displayName || 'FinTrack User'}
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {isGuest ? 'Guest Mode · Local Storage' : user?.email}
            </div>
          </div>
        </div>
        {isGuest ? (
          <button
            type="button"
            onClick={exitGuestMode}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"
          >
            <LogIn className="w-3.5 h-3.5 shrink-0" />
            Sign In / Sync to Cloud
          </button>
        ) : (
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            Sign Out
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">{sidebarContent}</div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="hidden sm:inline text-slate-400 dark:text-slate-500 whitespace-nowrap">
                FinTrack
              </span>
              <span className="hidden sm:inline text-slate-300 dark:text-slate-700">/</span>
              <h1 className="font-semibold text-slate-900 dark:text-white truncate">
                {activeLabel}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
              <CreditCard className="w-3.5 h-3.5" />
              {currency}
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => onQuickAddTransaction('expense')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Entry</span>
            </button>
          </div>
        </header>

        {/* Page Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto space-y-5">
          {isGuest && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-xs text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-900 dark:text-white">Guest Mode active:</span>{' '}
                All records are saved locally in this browser. Sign in anytime to sync across devices.
              </div>
              <button
                type="button"
                onClick={exitGuestMode}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap self-start sm:self-auto shrink-0"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In to Sync
              </button>
            </div>
          )}

          {!isGuest && pendingGuestMigrationCount > 0 && (
            <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                  Found {pendingGuestMigrationCount} local Guest Mode record{pendingGuestMigrationCount === 1 ? '' : 's'}
                </div>
                <div className="text-xs text-emerald-700 dark:text-emerald-300">
                  Import your browser-saved entries into your private cloud ledger, or discard them.
                </div>
                {migrationError && (
                  <div className="text-xs text-red-600 dark:text-red-400">{migrationError}</div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={migrating}
                  onClick={handleMigrateToCloud}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <CloudUpload className="w-3.5 h-3.5" />
                  {migrating ? 'Importing...' : 'Import to Cloud'}
                </button>
                <button
                  type="button"
                  disabled={migrating}
                  onClick={dismissGuestMigration}
                  className="px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-xs font-medium text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 whitespace-nowrap"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          {children}
        </main>
      </div>
    </div>
  );
}
