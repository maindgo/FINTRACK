import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { CheckCircle2, Edit2, History, PiggyBank, Plus, Trash2, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useFinance } from '../context/FinanceContext';
import { SavingsContribution, SavingsGoal } from '../types/finance';
import { FIELD_LIMITS, SAVINGS_CATEGORIES } from '../utils/constants';
import { daysBetween, formatCurrency, formatReadableDate, getTodayStr } from '../utils/formatters';
import {
  addSavingsDeposit,
  createSavingsGoal,
  deleteSavingsGoal,
  updateSavingsGoal,
} from '../services/firestoreService';
import { getGuestSavingsContributions, GUEST_EVENT } from '../services/guestStore';

export function SavingsPage() {
  const { user, isGuest, savingsGoals, transactions, currency } = useFinance();
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [depositGoal, setDepositGoal] = useState<SavingsGoal | null>(null);
  const [historyGoal, setHistoryGoal] = useState<SavingsGoal | null>(null);
  const [contributions, setContributions] = useState<SavingsContribution[]>([]);

  // Goal Form State
  const [name, setName] = useState('');
  const [category, setCategory] = useState(SAVINGS_CATEGORIES[0]);
  const [targetAmount, setTargetAmount] = useState('');
  const [savedAmount, setSavedAmount] = useState('0');
  const [targetDate, setTargetDate] = useState(getTodayStr());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Deposit Form State
  const [depAmount, setDepAmount] = useState('');
  const [depDate, setDepDate] = useState(getTodayStr());
  const [depNote, setDepNote] = useState('');

  useEffect(() => {
    if (!user || !historyGoal) {
      setContributions([]);
      return;
    }

    if (isGuest) {
      const syncGuestContributions = () => {
        setContributions(getGuestSavingsContributions(historyGoal.id));
      };
      syncGuestContributions();
      window.addEventListener(GUEST_EVENT, syncGuestContributions);
      return () => window.removeEventListener(GUEST_EVENT, syncGuestContributions);
    }

    const unsub = onSnapshot(
      query(
        collection(db, 'users', user.uid, 'savingsGoals', historyGoal.id, 'contributions'),
        where('userId', '==', user.uid)
      ),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SavingsContribution));
        list.sort((a, b) => b.date.localeCompare(a.date));
        setContributions(list);
      },
      (err) =>
        handleFirestoreError(
          err,
          OperationType.LIST,
          `users/${user.uid}/savingsGoals/${historyGoal.id}/contributions`
        )
    );
    return () => unsub();
  }, [user, isGuest, historyGoal]);

  const totals = useMemo(() => {
    const target = savingsGoals.reduce((s, g) => s + g.targetAmount, 0);
    const saved = savingsGoals.reduce((s, g) => s + g.savedAmount, 0);
    const remaining = Math.max(0, target - saved);
    const completed = savingsGoals.filter((g) => g.status === 'completed').length;
    const allIncome = transactions
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + t.amount, 0);
    const allExpenses = transactions
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0);
    const cashReserve = Math.max(0, allIncome - allExpenses);
    const totalSavingRightNow = cashReserve + saved;
    return { target, saved, remaining, completed, cashReserve, totalSavingRightNow };
  }, [savingsGoals, transactions]);

  const openCreateModal = () => {
    setEditingGoal(null);
    setName('');
    setCategory(SAVINGS_CATEGORIES[0]);
    setTargetAmount('');
    setSavedAmount('0');
    setTargetDate(getTodayStr());
    setNotes('');
    setShowGoalModal(true);
  };

  const openEditModal = (goal: SavingsGoal) => {
    setEditingGoal(goal);
    setName(goal.name);
    setCategory(goal.category);
    setTargetAmount(String(goal.targetAmount));
    setSavedAmount(String(goal.savedAmount));
    setTargetDate(goal.targetDate);
    setNotes(goal.notes);
    setShowGoalModal(true);
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const tAmt = Number(targetAmount);
    const sAmt = Number(savedAmount || 0);
    if (!Number.isFinite(tAmt) || tAmt <= 0 || !name.trim()) return;

    setSaving(true);
    try {
      if (editingGoal) {
        await updateSavingsGoal(
          user.uid,
          editingGoal.id,
          { name: name.trim(), targetAmount: tAmt, targetDate, category, notes },
          editingGoal.savedAmount
        );
      } else {
        await createSavingsGoal(user.uid, {
          name: name.trim(),
          targetAmount: tAmt,
          savedAmount: Number.isFinite(sAmt) && sAmt >= 0 ? sAmt : 0,
          targetDate,
          category,
          notes,
        });
      }
      setShowGoalModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !depositGoal) return;
    const amt = Number(depAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;

    setSaving(true);
    try {
      await addSavingsDeposit(user.uid, depositGoal, amt, depDate, depNote);
      setDepositGoal(null);
      setDepAmount('');
      setDepNote('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Savings Goals
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Set target amounts, record deposits, and track completion dates across multiple goals.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          New Savings Goal
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="col-span-2 lg:col-span-1 bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4">
          <div className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
            Total Saving Right Now
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300 mt-1">
            {formatCurrency(totals.totalSavingRightNow, currency)}
          </div>
          <div className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">
            Cash {formatCurrency(totals.cashReserve, currency)} + Goals {formatCurrency(totals.saved, currency)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Saved in Goals</div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
            {formatCurrency(totals.saved, currency)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Combined Targets</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
            {formatCurrency(totals.target, currency)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Remaining to Goal</div>
          <div className="text-xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400 mt-1">
            {formatCurrency(totals.remaining, currency)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Goals Completed</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
            {totals.completed} / {savingsGoals.length}
          </div>
        </div>
      </div>

      {/* Goals Grid */}
      {savingsGoals.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
          <PiggyBank className="w-10 h-10 text-slate-400 mx-auto" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            No savings goals yet
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Create an emergency fund, travel reserve, or home down-payment goal and add deposits over time.
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            Create First Goal
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {savingsGoals.map((goal) => {
            const pct = Math.min(100, (goal.savedAmount / goal.targetAmount) * 100);
            const remaining = Math.max(0, goal.targetAmount - goal.savedAmount);
            const daysLeft = daysBetween(getTodayStr(), goal.targetDate);
            const isCompleted = goal.status === 'completed';

            return (
              <div
                key={goal.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                        {goal.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {goal.category} · Target {formatReadableDate(goal.targetDate)}
                      </p>
                    </div>
                    {isCompleted && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                        Done
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                        {formatCurrency(goal.savedAmount, currency)}
                      </span>
                      <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        of {formatCurrency(goal.targetAmount, currency)} ({pct.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isCompleted ? 'bg-emerald-600' : 'bg-blue-600'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>Remaining: <strong className="font-mono tabular-nums text-slate-800 dark:text-slate-200">{formatCurrency(remaining, currency)}</strong></span>
                    <span>
                      {isCompleted
                        ? 'Target reached'
                        : daysLeft >= 0
                        ? `${daysLeft} days left`
                        : `${Math.abs(daysLeft)} days overdue`}
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {!isCompleted && (
                      <button
                        type="button"
                        onClick={() => {
                          setDepositGoal(goal);
                          setDepAmount('');
                          setDepDate(getTodayStr());
                          setDepNote('');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                      >
                        + Add Money
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setHistoryGoal(goal)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <History className="w-3.5 h-3.5" />
                      History
                    </button>
                  </div>

                  <div className="flex items-center gap-1">
                    {!isCompleted && (
                      <button
                        type="button"
                        onClick={() => openEditModal(goal)}
                        aria-label="Edit goal"
                        className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => user && deleteSavingsGoal(user.uid, goal.id)}
                      aria-label="Delete goal"
                      className="p-1.5 rounded-md text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Goal Modal */}
      {showGoalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingGoal ? 'Edit Savings Goal' : 'Create Savings Goal'}
              </h3>
              <button type="button" onClick={() => setShowGoalModal(false)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveGoal} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Goal Name *
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., 6-Month Emergency Fund"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  >
                    {SAVINGS_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Target Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Target Amount *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={targetAmount}
                    onChange={(e) => setTargetAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>

                {!editingGoal && (
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Initial Saved
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={savedAmount}
                      onChange={(e) => setSavedAmount(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Notes
                </label>
                <textarea
                  rows={2}
                  maxLength={FIELD_LIMITS.DESCRIPTION_MAX}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowGoalModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                >
                  {saving ? 'Saving...' : 'Save Goal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Money Modal */}
      {depositGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                Add to {depositGoal.name}
              </h3>
              <button type="button" onClick={() => setDepositGoal(null)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleDeposit} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Deposit Amount *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={depAmount}
                  onChange={(e) => setDepAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Date *
                </label>
                <input
                  type="date"
                  required
                  value={depDate}
                  onChange={(e) => setDepDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Note
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.SHORT_NOTE_MAX}
                  value={depNote}
                  onChange={(e) => setDepNote(e.target.value)}
                  placeholder="Monthly allocation"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDepositGoal(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  {saving ? 'Adding...' : 'Confirm Deposit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Contribution History Modal */}
      {historyGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {historyGoal.name} · Deposits
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Total saved: {formatCurrency(historyGoal.savedAmount, currency)}
                </p>
              </div>
              <button type="button" onClick={() => setHistoryGoal(null)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 p-5">
              {contributions.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-6">
                  No individual deposits recorded yet.
                </p>
              ) : (
                contributions.map((c) => (
                  <div key={c.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-mono text-slate-500 dark:text-slate-400">
                        {formatReadableDate(c.date)}
                      </div>
                      {c.note && <div className="text-slate-800 dark:text-slate-200 mt-0.5">{c.note}</div>}
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                      +{formatCurrency(c.amount, currency)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
