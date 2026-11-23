import React, { useState } from 'react';
import { deleteUser, signOut } from 'firebase/auth';
import {
  AlertTriangle,
  Check,
  Database,
  Download,
  Moon,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { auth } from '../firebase';
import { useFinance } from '../context/FinanceContext';
import { CurrencyCode } from '../types/finance';
import { CURRENCIES, FIELD_LIMITS } from '../utils/constants';
import {
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
  } = useFinance();

  const [displayName, setDisplayName] = useState(profile?.displayName || user?.displayName || '');
  const [monthlyLimit, setMonthlyLimit] = useState(String(profile?.monthlyBudgetLimit || 0));
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const [restoreMsg, setRestoreMsg] = useState('');

  // Account Deletion state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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
      await wipeAllUserFirestoreData(user.uid);
      await deleteUser(user);
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
              value={user?.email || ''}
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
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span>{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
          </button>

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
        </div>

        {restoreMsg && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
            {restoreMsg}
          </div>
        )}
      </div>

      {/* Danger Zone: Account Deletion */}
      <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/60 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <AlertTriangle className="w-4 h-4" />
          <h3 className="text-sm font-semibold">Account Deletion</h3>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Permanently delete your FinTrack account along with all stored transactions, savings goals, budgets, loans, bills, and recurring schedules. This action cannot be undone.
        </p>

        {!showDeleteConfirm ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete My Account
            </button>
            <button
              type="button"
              onClick={() => signOut(auth)}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              Sign Out
            </button>
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 space-y-3">
            <p className="text-xs font-medium text-red-800 dark:text-red-300">
              Type <span className="font-mono font-bold">DELETE</span> to permanently erase all your data and account:
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
                {deleting ? 'Deleting...' : 'Confirm Permanent Deletion'}
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
    </div>
  );
}
