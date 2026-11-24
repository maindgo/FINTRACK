import React, { useEffect, useState } from 'react';
import { deleteUser, signOut } from 'firebase/auth';
import {
  AlertTriangle,
  Bell,
  BellRing,
  Check,
  Database,
  Download,
  Fingerprint,
  Lock,
  LogIn,
  Moon,
  Send,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import { auth } from '../firebase';
import { useFinance } from '../context/FinanceContext';
import { GUEST_UID } from '../services/guestStore';
import { isRunningInIframe } from '../services/notificationService';
import { PinSetupModal } from '../components/PinSetupModal';
import { PWAInstallButton } from '../components/PWAInstallButton';
import {
  clearSecurityConfig,
  isAppSecurityConfigured,
  loadSecurityConfig,
  saveSecurityConfig,
  SECURITY_EVENT,
  SecurityLockConfig,
} from '../services/securityService';
import { CurrencyCode, NotificationCategoryPrefs } from '../types/finance';
import { CURRENCIES, FIELD_LIMITS } from '../utils/constants';
import {
  exportErpFullReportToPDF,
  exportErpFullWorkbookToExcel,
  exportJsonBackup,
  exportTransactionsToCSV,
  exportTransactionsToExcel,
  exportTransactionsToPDF,
} from '../utils/exporters';
import {
  createBudget,
  createSavingsGoal,
  createTransaction,
  updateUserProfile,
  wipeAllUserFirestoreData,
} from '../services/firestoreService';

export function SettingsPage() {
  const {
    user,
    firebaseUser,
    isGuest,
    exitGuestMode,
    profile,
    currency,
    theme,
    toggleTheme,
    setCurrency,
    transactions,
    savingsGoals,
    budgets,
    debtRecords,
    bills,
    recurringTransactions,
    recordPayments,
    notificationPrefs,
    notificationPermission,
    enableMobileNotifications,
    updateNotificationPrefs,
    sendTestNotification,
    isAdmin,
    maintenanceEnabled,
    maintenanceUpdating,
    setMaintenanceEnabledMode,
  } = useFinance();

  const [displayName, setDisplayName] = useState(profile?.displayName || user?.displayName || '');
  const [monthlyLimit, setMonthlyLimit] = useState(String(profile?.monthlyBudgetLimit || 0));
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [restoreMsg, setRestoreMsg] = useState('');
  const [notifFeedback, setNotifFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [requestingNotif, setRequestingNotif] = useState(false);
  const [securityConfig, setSecurityConfig] = useState<SecurityLockConfig>(() =>
    loadSecurityConfig()
  );
  const [securityModalOpen, setSecurityModalOpen] = useState(false);

  useEffect(() => {
    const sync = () => setSecurityConfig(loadSecurityConfig());
    window.addEventListener(SECURITY_EVENT, sync);
    return () => window.removeEventListener(SECURITY_EVENT, sync);
  }, []);

  // Account Deletion state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName || user?.displayName || '');
      setMonthlyLimit(String(profile.monthlyBudgetLimit || 0));
    }
  }, [profile, user?.displayName]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSavingProfile(true);
    setSavedNotice('');
    try {
      await updateUserProfile(user.uid, {
        displayName: displayName.trim() || 'FinTrack User',
        monthlyBudgetLimit: Math.max(0, Number(monthlyLimit) || 0),
      });
      setSavedNotice('Preferences saved.');
      setTimeout(() => setSavedNotice(''), 3000);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDownloadBackup = () => {
    exportJsonBackup({
      exportedAt: new Date().toISOString(),
      app: 'FinTrack – Smart Money Manager',
      profile,
      transactions,
      savingsGoals,
      budgets,
      debtRecords,
      bills,
      recurringTransactions,
      recordPayments,
    });
  };

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setRestoreMsg('');
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      let restoredCount = 0;

      if (Array.isArray(parsed.transactions)) {
        for (const t of parsed.transactions) {
          if (t && t.title && t.amount > 0 && t.date && (t.type === 'income' || t.type === 'expense')) {
            await createTransaction(user.uid, {
              type: t.type,
              amount: Number(t.amount),
              title: String(t.title),
              category: t.category,
              date: String(t.date),
              time: String(t.time || '12:00'),
              paymentMethod: t.paymentMethod || 'Other',
              description: String(t.description || ''),
              notes: String(t.notes || ''),
              receiptName: String(t.receiptName || ''),
              receiptDataUrl: '',
              recurringId: '',
            });
            restoredCount++;
          }
        }
      }

      if (Array.isArray(parsed.savingsGoals)) {
        for (const g of parsed.savingsGoals) {
          if (g && g.name && g.targetAmount > 0 && g.targetDate) {
            await createSavingsGoal(user.uid, {
              name: String(g.name),
              targetAmount: Number(g.targetAmount),
              savedAmount: Number(g.savedAmount || 0),
              targetDate: String(g.targetDate),
              category: String(g.category || 'General Savings'),
              notes: String(g.notes || ''),
            });
            restoredCount++;
          }
        }
      }

      if (Array.isArray(parsed.budgets)) {
        for (const b of parsed.budgets) {
          if (b && b.category && b.month && b.limitAmount > 0) {
            await createBudget(user.uid, {
              category: String(b.category),
              month: String(b.month),
              limitAmount: Number(b.limitAmount),
              alertThreshold: Number(b.alertThreshold || 80),
              notes: String(b.notes || ''),
            });
            restoredCount++;
          }
        }
      }

      setRestoreMsg(`Restored ${restoredCount} records from backup.`);
    } catch {
      setRestoreMsg('Invalid backup JSON file.');
    }
    e.target.value = '';
  };

  const handleDeleteAccount = async () => {
    if (!user || deleteText !== 'DELETE') return;
    setDeleting(true);
    setDeleteError('');
    try {
      if (isGuest) {
        await wipeAllUserFirestoreData(GUEST_UID);
        setShowDeleteConfirm(false);
        setDeleteText('');
        setDeleting(false);
        return;
      }
      if (!firebaseUser) return;
      await wipeAllUserFirestoreData(firebaseUser.uid);
      await deleteUser(firebaseUser);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/requires-recent-login') {
        setDeleteError(
          'Your Firestore records have been deleted. For security, please sign out, sign back in, and click Delete Account again to remove your Auth login.'
        );
      } else {
        setDeleteError((err as Error)?.message || 'Failed to delete account.');
      }
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Settings &amp; Data Control
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Manage your profile, currency formatting, theme, backups, exports, and account security.
        </p>
      </div>

      {/* Profile & Preferences */}
      <form
        onSubmit={handleSaveProfile}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5"
      >
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Profile &amp; Workspace Preferences
        </h3>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Display Name
            </label>
            <input
              type="text"
              maxLength={FIELD_LIMITS.DISPLAY_NAME_MAX}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Account Email
            </label>
            <input
              type="text"
              disabled
              value={isGuest ? 'Guest Mode (Local Browser Storage)' : user?.email || ''}
              className="w-full px-3 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Display Currency (Default INR)
            </label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} · {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Monthly Spending Limit
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={monthlyLimit}
              onChange={(e) => setMonthlyLimit(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
            </button>
            <PWAInstallButton variant="full" />
          </div>

          <div className="flex items-center gap-3">
            {savedNotice && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="w-3.5 h-3.5" />
                {savedNotice}
              </span>
            )}
            <button
              type="submit"
              disabled={savingProfile}
              className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90"
            >
              {savingProfile ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </div>
      </form>

      {/* Notifications & Mobile Notification Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Notifications &amp; Mobile Notification Bar
            </h3>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold w-fit ${
              notificationPermission === 'granted'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : notificationPermission === 'denied'
                ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
            }`}
          >
            <Bell className="w-3 h-3" />
            {notificationPermission === 'granted'
              ? 'Phone Permission: Granted'
              : notificationPermission === 'denied'
              ? 'Phone Permission: Blocked'
              : notificationPermission === 'default'
              ? 'Phone Permission: Not Enabled'
              : 'Device Notification API Unsupported'}
          </span>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Turn on browser notification permission on your phone to display overdue bills, upcoming EMIs,
          budget warnings, loan due dates, savings milestones, and unusual spending alerts directly in your
          mobile notification bar.
        </p>

        {isRunningInIframe() && notificationPermission !== 'granted' && (
          <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
            Note: Mobile browsers often block system notification prompts inside embedded preview frames.
            If tapping &ldquo;Allow Phone Notifications&rdquo; does not prompt, open FinTrack directly in
            Chrome/Safari on your mobile phone.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {notificationPermission !== 'granted' && notificationPermission !== 'unsupported' && (
            <button
              type="button"
              disabled={requestingNotif || notificationPermission === 'denied'}
              onClick={async () => {
                setRequestingNotif(true);
                setNotifFeedback(null);
                try {
                  const res = await enableMobileNotifications();
                  if (res === 'granted') {
                    setNotifFeedback({
                      ok: true,
                      text: 'Permission granted! Alerts will now appear in your phone notification bar.',
                    });
                  } else if (res === 'denied') {
                    setNotifFeedback({
                      ok: false,
                      text: 'Permission was blocked. Allow notifications for this site in your mobile browser settings.',
                    });
                  }
                } finally {
                  setRequestingNotif(false);
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              <BellRing className="w-3.5 h-3.5" />
              {requestingNotif
                ? 'Requesting...'
                : notificationPermission === 'denied'
                ? 'Blocked in Browser Settings'
                : 'Allow Phone Notifications'}
            </button>
          )}

          <button
            type="button"
            onClick={async () => {
              const res = await sendTestNotification();
              setNotifFeedback({ ok: res.ok, text: res.message });
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Send className="w-3.5 h-3.5" />
            Send Test Notification
          </button>
        </div>

        {notifFeedback && (
          <div
            className={`p-3 rounded-lg text-xs border ${
              notifFeedback.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
            }`}
          >
            {notifFeedback.text}
          </div>
        )}

        {/* Master & Delivery Toggles */}
        <div className="grid sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={notificationPrefs.enabled}
              onChange={(e) =>
                updateNotificationPrefs((prev) => ({ ...prev, enabled: e.target.checked }))
              }
              className="mt-0.5 accent-emerald-600"
            />
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                Enable Smart Alerts
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Compute financial alerts &amp; bell badge
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={notificationPrefs.pushToDeviceBar}
              disabled={!notificationPrefs.enabled}
              onChange={(e) =>
                updateNotificationPrefs((prev) => ({ ...prev, pushToDeviceBar: e.target.checked }))
              }
              className="mt-0.5 accent-emerald-600"
            />
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                Mobile Notification Bar
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Push alerts to phone status bar when allowed
              </div>
            </div>
          </label>

          <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={notificationPrefs.showTopAlertBanner}
              disabled={!notificationPrefs.enabled}
              onChange={(e) =>
                updateNotificationPrefs((prev) => ({
                  ...prev,
                  showTopAlertBanner: e.target.checked,
                }))
              }
              className="mt-0.5 accent-emerald-600"
            />
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                Urgent Top Banner
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Highlight overdue or critical alerts at top
              </div>
            </div>
          </label>
        </div>

        {/* Category Preferences */}
        <div className="space-y-2.5">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Alert Categories
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {(
              [
                {
                  key: 'bills',
                  label: 'Bills, EMIs & Subscriptions',
                  desc: 'Overdue & due within 3 days',
                },
                {
                  key: 'budgets',
                  label: 'Budgets & Monthly Cap',
                  desc: 'Threshold warnings & overspend',
                },
                {
                  key: 'debts',
                  label: 'Loans, Debts & Collections',
                  desc: 'Repayment & collection due dates',
                },
                {
                  key: 'insights',
                  label: 'Spending Spikes & Cash Flow',
                  desc: 'Unusual expenses & monthly deficit',
                },
                {
                  key: 'savings',
                  label: 'Savings Goal Milestones',
                  desc: '100% funded & 7-day target reminders',
                },
                {
                  key: 'recurring',
                  label: 'Recurring Schedules',
                  desc: 'Entries scheduled today or tomorrow',
                },
              ] as { key: keyof NotificationCategoryPrefs; label: string; desc: string }[]
            ).map((cat) => (
              <label
                key={cat.key}
                className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <input
                  type="checkbox"
                  disabled={!notificationPrefs.enabled}
                  checked={notificationPrefs.categories[cat.key]}
                  onChange={(e) =>
                    updateNotificationPrefs((prev) => ({
                      ...prev,
                      categories: {
                        ...prev.categories,
                        [cat.key]: e.target.checked,
                      },
                    }))
                  }
                  className="mt-0.5 accent-emerald-600"
                />
                <div>
                  <div className="text-xs font-medium text-slate-900 dark:text-white">
                    {cat.label}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{cat.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* App Security: PIN Lock & Biometric Auth */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              App Security · PIN Lock &amp; Biometric Auth
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                securityConfig.pinEnabled
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}
            >
              <Lock className="w-3 h-3" />
              {securityConfig.pinEnabled ? `${securityConfig.pinLength}-Digit PIN On` : 'PIN Off'}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                securityConfig.biometricEnabled
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}
            >
              <Fingerprint className="w-3 h-3" />
              {securityConfig.biometricEnabled ? 'Biometrics On' : 'Biometrics Off'}
            </span>
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Require a 4–6 digit PIN code and/or device Fingerprint / Face ID before logging in and whenever FinTrack reopens.
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              disabled={!isAppSecurityConfigured(securityConfig)}
              checked={securityConfig.lockBeforeLogin}
              onChange={(e) => {
                const next = { ...securityConfig, lockBeforeLogin: e.target.checked };
                saveSecurityConfig(next);
                setSecurityConfig(next);
              }}
              className="mt-0.5 accent-emerald-600"
            />
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                Require Lock Before Login &amp; On Launch
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Show PIN / Biometric lock screen on startup before accessing login or ledger
              </div>
            </div>
          </label>

          <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
            <label className="block text-xs font-semibold text-slate-900 dark:text-white">
              Auto-Lock When Backgrounded
            </label>
            <select
              disabled={!isAppSecurityConfigured(securityConfig)}
              value={securityConfig.autoLockMinutes}
              onChange={(e) => {
                const next = { ...securityConfig, autoLockMinutes: Number(e.target.value) };
                saveSecurityConfig(next);
                setSecurityConfig(next);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
            >
              <option value={0}>On startup / manual lock only</option>
              <option value={1}>After 1 minute away</option>
              <option value={5}>After 5 minutes away</option>
              <option value={15}>After 15 minutes away</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setSecurityModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90"
          >
            <Fingerprint className="w-3.5 h-3.5" />
            {isAppSecurityConfigured(securityConfig)
              ? 'Manage PIN & Biometrics'
              : 'Set Up PIN & Biometrics'}
          </button>

          {isAppSecurityConfigured(securityConfig) && (
            <button
              type="button"
              onClick={() => {
                clearSecurityConfig();
                setSecurityConfig(loadSecurityConfig());
              }}
              className="px-3.5 py-2 rounded-lg border border-red-200 dark:border-red-900 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              Disable All App Locks
            </button>
          )}
        </div>
      </div>

      {/* Admin-Only Scheduled Maintenance Control */}
      {isAdmin && (
        <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Admin · Scheduled Maintenance Control
              </h3>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold w-fit border ${
                maintenanceEnabled
                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
              }`}
            >
              {maintenanceEnabled ? 'Maintenance Mode: ON' : 'App Status: Live'}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            When turned ON, FinTrack routes all visitors and regular users to the Scheduled Maintenance page displaying the upcoming AI &amp; Budget Forecasting update details and scrolling support banner.
          </p>
          <button
            type="button"
            disabled={maintenanceUpdating}
            onClick={() => setMaintenanceEnabledMode(!maintenanceEnabled)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
              maintenanceEnabled
                ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                : 'bg-amber-600 text-white hover:bg-amber-700'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            {maintenanceUpdating
              ? 'Updating Maintenance Status...'
              : maintenanceEnabled
              ? 'Turn Off Scheduled Maintenance'
              : 'Turn On Scheduled Maintenance'}
          </button>
        </div>
      )}

      {/* Data Backup & Export */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Data Backup &amp; Portability
          </h3>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Download a complete JSON backup of all your FinTrack data or export your transaction ledger for spreadsheets and accounting.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleDownloadBackup}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold hover:opacity-90"
          >
            <Download className="w-3.5 h-3.5" />
            Download Full JSON Backup
          </button>

          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Restore from JSON Backup</span>
            <input type="file" accept="application/json" onChange={handleRestoreBackup} className="hidden" />
          </label>

          <button
            type="button"
            onClick={() => exportTransactionsToCSV(transactions, currency)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
          >
            CSV Export
          </button>
          <button
            type="button"
            onClick={() => exportTransactionsToExcel(transactions, currency)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
          >
            Excel Export
          </button>
          <button
            type="button"
            onClick={() => exportTransactionsToPDF(transactions, currency)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
          >
            PDF Statement
          </button>
          <button
            type="button"
            onClick={() =>
              exportErpFullWorkbookToExcel({
                ownerName: profile?.displayName || user?.displayName || 'FinTrack User',
                currency,
                transactions,
                savingsGoals,
                budgets,
                debtRecords,
                bills,
                recordPayments,
                recurringTransactions,
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/50 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            ERP Full Pack (Excel)
          </button>
          <button
            type="button"
            onClick={() =>
              exportErpFullReportToPDF({
                ownerName: profile?.displayName || user?.displayName || 'FinTrack User',
                currency,
                transactions,
                savingsGoals,
                budgets,
                debtRecords,
                bills,
                recordPayments,
                recurringTransactions,
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            ERP Full Pack (PDF)
          </button>
        </div>

        {restoreMsg && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
            {restoreMsg}
          </div>
        )}
      </div>

      {/* Danger Zone: Account / Guest Data Control */}
      <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/60 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <AlertTriangle className="w-4 h-4" />
          <h3 className="text-sm font-semibold">
            {isGuest ? 'Guest Data & Cloud Sync' : 'Account Deletion'}
          </h3>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          {isGuest
            ? 'Your Guest Mode records are stored locally in this browser. Sign in to sync them to a private cloud account, or erase all local guest data and exit Guest Mode.'
            : 'Permanently delete your FinTrack account along with all stored transactions, savings goals, budgets, loans, bills, and recurring schedules. This action cannot be undone.'}
        </p>

        {!showDeleteConfirm ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isGuest ? 'Erase Local Guest Data' : 'Delete My Account'}
            </button>
            {isGuest ? (
              <button
                type="button"
                onClick={exitGuestMode}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5" />
                Sign In &amp; Sync to Cloud
              </button>
            ) : (
              <button
                type="button"
                onClick={() => signOut(auth)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium whitespace-nowrap"
              >
                Sign Out
              </button>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 space-y-3">
            <p className="text-xs font-medium text-red-800 dark:text-red-300">
              Type <span className="font-mono font-bold">DELETE</span> to permanently erase{' '}
              {isGuest ? 'all local guest records' : 'all your data and account'}:
            </p>
            <input
              type="text"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="Type DELETE"
              className="w-full max-w-xs px-3 py-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-950 border border-red-300 dark:border-red-800"
            />
            {deleteError && <p className="text-xs text-red-700 dark:text-red-300">{deleteError}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={deleteText !== 'DELETE' || deleting}
                onClick={handleDeleteAccount}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold disabled:opacity-40"
              >
                {deleting ? 'Deleting...' : isGuest ? 'Confirm Local Erasure' : 'Confirm Permanent Deletion'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteText('');
                }}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <PinSetupModal
        open={securityModalOpen}
        ownerLabel={profile?.displayName || user?.displayName || user?.email || 'FinTrack Owner'}
        onClose={() => setSecurityModalOpen(false)}
        onUpdated={(next) => setSecurityConfig(next)}
      />
    </div>
  );
}
