import React, { useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  BellRing,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  CloudUpload,
  CreditCard,
  HandCoins,
  Info,
  LayoutDashboard,
  Lightbulb,
  ListOrdered,
  Lock,
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
  Wrench,
  X,
} from 'lucide-react';
import { auth } from '../firebase';
import { useFinance } from '../context/FinanceContext';
import { FinTrackNotification, NavSection } from '../types/finance';
import { NAV_ITEMS } from '../utils/constants';
import { isRunningInIframe } from '../services/notificationService';

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
  securityConfigured?: boolean;
  onLockApp?: () => void;
  onPreviewMaintenance?: () => void;
  children: React.ReactNode;
}

export function LayoutShell({
  activeSection,
  onSelectSection,
  onQuickAddTransaction,
  securityConfigured = false,
  onLockApp,
  onPreviewMaintenance,
  children,
}: LayoutShellProps) {
  const {
    user,
    isGuest,
    isAdmin,
    maintenanceEnabled,
    maintenanceUpdating,
    setMaintenanceEnabledMode,
    profile,
    currency,
    theme,
    toggleTheme,
    exitGuestMode,
    pendingGuestMigrationCount,
    migrateGuestToCloud,
    dismissGuestMigration,
    notificationPrefs,
    notifications,
    unreadNotificationCount,
    notificationPermission,
    enableMobileNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification,
    restoreDismissedNotifications,
  } = useFinance();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState('');
  const notifContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!notifOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (notifContainerRef.current && !notifContainerRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNotifOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [notifOpen]);

  const handleEnableMobileAlerts = async () => {
    setRequestingPerm(true);
    try {
      await enableMobileNotifications();
    } finally {
      setRequestingPerm(false);
    }
  };

  const handleNotificationClick = (item: FinTrackNotification) => {
    markNotificationRead(item.signature);
    onSelectSection(item.actionSection);
    setNotifOpen(false);
  };

  const readSet = new Set(notificationPrefs.readSignatures);
  const urgentUnread = notifications.filter(
    (n) => n.severity === 'critical' && !readSet.has(n.signature)
  );
  const inIframe = isRunningInIframe();

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

            {/* Notification Bell & Dropdown */}
            <div className="relative" ref={notifContainerRef}>
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                aria-label="Open notifications"
                className="relative p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Bell className="w-4 h-4" />
                {unreadNotificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                    {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="fixed sm:absolute left-3 right-3 sm:left-auto sm:right-0 top-[70px] sm:top-full sm:mt-2 sm:w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <BellRing className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">
                        Notifications
                      </span>
                      {unreadNotificationCount > 0 && (
                        <span className="text-[11px] font-mono font-semibold text-red-600 dark:text-red-400">
                          ({unreadNotificationCount} new)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {unreadNotificationCount > 0 && (
                        <button
                          type="button"
                          onClick={markAllNotificationsRead}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                          Read all
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setNotifOpen(false);
                          onSelectSection('settings');
                        }}
                        aria-label="Notification settings"
                        className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Mobile / Device Notification Bar Permission Banner */}
                  <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950/70 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                    {notificationPermission === 'granted' ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {notificationPrefs.pushToDeviceBar
                            ? 'Mobile notification bar alerts active'
                            : 'Device permission granted (paused in Settings)'}
                        </span>
                      </div>
                    ) : notificationPermission === 'default' ? (
                      <>
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">
                          Show alerts in your phone&apos;s notification bar
                        </span>
                        <button
                          type="button"
                          disabled={requestingPerm}
                          onClick={handleEnableMobileAlerts}
                          className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 whitespace-nowrap shrink-0"
                        >
                          {requestingPerm ? 'Allowing...' : 'Turn On'}
                        </button>
                      </>
                    ) : notificationPermission === 'denied' ? (
                      <span className="text-[11px] text-amber-700 dark:text-amber-400">
                        {inIframe
                          ? 'Open app in a mobile browser tab to enable phone notification bar alerts.'
                          : 'Blocked in browser site settings. Enable notifications in site permissions.'}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        In-app alerts active (browser tray unsupported here).
                      </span>
                    )}
                  </div>

                  {/* Notifications List */}
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {!notificationPrefs.enabled ? (
                      <div className="p-6 text-center space-y-2">
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Notifications are currently turned off.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setNotifOpen(false);
                            onSelectSection('settings');
                          }}
                          className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                        >
                          Enable in Settings
                        </button>
                      </div>
                    ) : notifications.length === 0 ? (
                      <div className="p-6 text-center space-y-2">
                        <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          You&apos;re all caught up!
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Alerts for bills, budgets, loans, savings goals, and spending spikes appear here.
                        </p>
                        {notificationPrefs.dismissedSignatures.length > 0 && (
                          <button
                            type="button"
                            onClick={restoreDismissedNotifications}
                            className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                          >
                            Restore dismissed alerts
                          </button>
                        )}
                      </div>
                    ) : (
                      notifications.map((item) => {
                        const isUnread = !readSet.has(item.signature);
                        const SeverityIcon =
                          item.severity === 'critical' || item.severity === 'warning'
                            ? AlertTriangle
                            : item.severity === 'positive'
                            ? CheckCircle2
                            : Info;
                        const iconColor =
                          item.severity === 'critical'
                            ? 'text-red-600 dark:text-red-400'
                            : item.severity === 'warning'
                            ? 'text-amber-600 dark:text-amber-400'
                            : item.severity === 'positive'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-blue-600 dark:text-blue-400';

                        return (
                          <div
                            key={item.id}
                            className={`px-4 py-3 flex items-start gap-3 transition-colors ${
                              isUnread ? 'bg-emerald-50/40 dark:bg-emerald-950/15' : ''
                            } hover:bg-slate-50 dark:hover:bg-slate-800/60`}
                          >
                            <SeverityIcon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
                            <button
                              type="button"
                              onClick={() => handleNotificationClick(item)}
                              className="flex-1 text-left min-w-0 space-y-0.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                  {item.title}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400 shrink-0">
                                  {item.timestampLabel}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                                {item.body}
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() => dismissNotification(item.signature)}
                              aria-label="Dismiss notification"
                              className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {isAdmin && (
              <button
                type="button"
                disabled={maintenanceUpdating}
                onClick={() => setMaintenanceEnabledMode(!maintenanceEnabled)}
                title={
                  maintenanceEnabled
                    ? 'Turn Off Scheduled Maintenance Mode'
                    : 'Turn On Scheduled Maintenance Mode'
                }
                className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                  maintenanceEnabled
                    ? 'bg-amber-500 text-slate-950 border-amber-500 hover:bg-amber-400'
                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50'
                }`}
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>
                  {maintenanceUpdating
                    ? 'Updating...'
                    : maintenanceEnabled
                    ? 'Maintenance: ON'
                    : 'Maintenance'}
                </span>
              </button>
            )}

            {securityConfigured && onLockApp && (
              <button
                type="button"
                onClick={onLockApp}
                title="Lock FinTrack"
                aria-label="Lock FinTrack"
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Lock className="w-4 h-4" />
              </button>
            )}

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
          {isAdmin && maintenanceEnabled && (
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                <Wrench className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  <span className="font-semibold">Scheduled Maintenance is ON:</span> Regular users and visitors see the Maintenance page. You are viewing with Admin access.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {onPreviewMaintenance && (
                  <button
                    type="button"
                    onClick={onPreviewMaintenance}
                    className="px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 whitespace-nowrap"
                  >
                    View Maintenance Page
                  </button>
                )}
                <button
                  type="button"
                  disabled={maintenanceUpdating}
                  onClick={() => setMaintenanceEnabledMode(false)}
                  className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
                >
                  Turn Off Maintenance
                </button>
              </div>
            </div>
          )}

          {notificationPrefs.enabled &&
            notificationPrefs.showTopAlertBanner &&
            urgentUnread.length > 0 && (
              <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => handleNotificationClick(urgentUnread[0])}
                  className="flex items-center gap-2.5 text-left min-w-0 flex-1"
                >
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                  <div className="min-w-0 text-xs">
                    <span className="font-semibold text-red-900 dark:text-red-200">
                      {urgentUnread[0].title}:
                    </span>{' '}
                    <span className="text-red-700 dark:text-red-300">{urgentUnread[0].body}</span>
                    {urgentUnread.length > 1 && (
                      <span className="ml-1.5 font-semibold text-red-800 dark:text-red-200">
                        (+{urgentUnread.length - 1} more alert{urgentUnread.length - 1 > 1 ? 's' : ''})
                      </span>
                    )}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => dismissNotification(urgentUnread[0].signature)}
                  aria-label="Dismiss urgent alert"
                  className="p-1 rounded-md text-red-500 hover:text-red-800 dark:hover:text-red-200 shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
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
