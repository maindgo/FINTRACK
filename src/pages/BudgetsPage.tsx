import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, Edit2, Plus, Target, Trash2, X } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { BudgetRecord } from '../types/finance';
import { EXPENSE_CATEGORIES, FIELD_LIMITS } from '../utils/constants';
import { formatCurrency, formatMonthLabel, getCurrentMonthStr } from '../utils/formatters';
import {
  createBudget,
  deleteBudget,
  updateBudget,
  updateUserProfile,
} from '../services/firestoreService';

export function BudgetsPage() {
  const { user, profile, budgets, transactions, currency } = useFinance();
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthStr());
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BudgetRecord | null>(null);

  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [limitAmount, setLimitAmount] = useState('');
  const [alertThreshold, setAlertThreshold] = useState('80');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [overallLimitInput, setOverallLimitInput] = useState(
    String(profile?.monthlyBudgetLimit || '')
  );
  const [savingOverall, setSavingOverall] = useState(false);

  const monthExpenses = useMemo(
    () =>
      transactions.filter(
        (t) => t.type === 'expense' && t.date.startsWith(selectedMonth)
      ),
    [transactions, selectedMonth]
  );

  const totalMonthSpent = useMemo(
    () => monthExpenses.reduce((s, t) => s + t.amount, 0),
    [monthExpenses]
  );

  const spentByCategory = useMemo(() => {
    const map = new Map<string, number>();
    monthExpenses.forEach((t) => {
      map.set(t.category, (map.get(t.category) || 0) + t.amount);
    });
    return map;
  }, [monthExpenses]);

  const monthBudgets = useMemo(
    () => budgets.filter((b) => b.month === selectedMonth),
    [budgets, selectedMonth]
  );

  const enrichedBudgets = useMemo(
    () =>
      monthBudgets.map((b) => {
        const spent =
          b.category === 'Monthly Overall'
            ? totalMonthSpent
            : spentByCategory.get(b.category) || 0;
        const remaining = b.limitAmount - spent;
        const utilization = (spent / b.limitAmount) * 100;
        const status: 'normal' | 'warning' | 'exceeded' =
          utilization > 100
            ? 'exceeded'
            : utilization >= b.alertThreshold
            ? 'warning'
            : 'normal';
        return { ...b, spent, remaining, utilization, status };
      }),
    [monthBudgets, totalMonthSpent, spentByCategory]
  );

  const overspentAlerts = enrichedBudgets.filter((b) => b.status !== 'normal');
  const overallLimit = profile?.monthlyBudgetLimit || 0;
  const overallUtilization = overallLimit > 0 ? (totalMonthSpent / overallLimit) * 100 : 0;

  const openCreate = () => {
    setEditing(null);
    setCategory(EXPENSE_CATEGORIES[0]);
    setLimitAmount('');
    setAlertThreshold('80');
    setNotes('');
    setShowModal(true);
  };

  const openEdit = (b: BudgetRecord) => {
    setEditing(b);
    setCategory(b.category);
    setLimitAmount(String(b.limitAmount));
    setAlertThreshold(String(b.alertThreshold));
    setNotes(b.notes);
    setShowModal(true);
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const lim = Number(limitAmount);
    const thresh = Number(alertThreshold || 80);
    if (!Number.isFinite(lim) || lim <= 0) return;

    setSaving(true);
    try {
      if (editing) {
        await updateBudget(user.uid, editing.id, {
          category,
          month: selectedMonth,
          limitAmount: lim,
          alertThreshold: thresh,
          notes,
        });
      } else {
        await createBudget(user.uid, {
          category,
          month: selectedMonth,
          limitAmount: lim,
          alertThreshold: thresh,
          notes,
        });
      }
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOverallLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const val = Number(overallLimitInput || 0);
    if (!Number.isFinite(val) || val < 0) return;
    setSavingOverall(true);
    try {
      await updateUserProfile(user.uid, { monthlyBudgetLimit: val });
    } finally {
      setSavingOverall(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Budget Management
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure monthly spending limits, category caps, and overspending alerts for{' '}
            {formatMonthLabel(selectedMonth)}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
          />
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Category Budget
          </button>
        </div>
      </div>

      {/* Overspending Alerts */}
      {(overspentAlerts.length > 0 || (overallLimit > 0 && overallUtilization >= 85)) && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Budget Alerts for {formatMonthLabel(selectedMonth)}</span>
          </div>
          <ul className="text-xs text-amber-800 dark:text-amber-200/90 space-y-1 pl-6 list-disc">
            {overallLimit > 0 && overallUtilization >= 85 && (
              <li>
                Overall monthly limit is at {overallUtilization.toFixed(1)}% (
                {formatCurrency(totalMonthSpent, currency)} of{' '}
                {formatCurrency(overallLimit, currency)}).
              </li>
            )}
            {overspentAlerts.map((b) => (
              <li key={b.id}>
                <strong>{b.category}</strong> is at {b.utilization.toFixed(1)}% utilization (
                {b.status === 'exceeded'
                  ? `Exceeded by ${formatCurrency(Math.abs(b.remaining), currency)}`
                  : `Approaching ${b.alertThreshold}% threshold`}
                ).
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Overall Monthly Spending Limit Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="space-y-2 flex-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              Monthly Overall Spending Limit
            </span>
            {overallLimit > 0 && (
              <span
                className={`text-xs font-mono font-semibold ${
                  overallUtilization > 100
                    ? 'text-red-600 dark:text-red-400'
                    : overallUtilization >= 85
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {overallUtilization.toFixed(1)}% used
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Spent in {formatMonthLabel(selectedMonth)}:{' '}
            <strong className="font-mono tabular-nums text-slate-900 dark:text-white">
              {formatCurrency(totalMonthSpent, currency)}
            </strong>
            {overallLimit > 0 && (
              <>
                {' '}
                / Limit{' '}
                <strong className="font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatCurrency(overallLimit, currency)}
                </strong>{' '}
                · Remaining:{' '}
                <strong className="font-mono tabular-nums">
                  {formatCurrency(Math.max(0, overallLimit - totalMonthSpent), currency)}
                </strong>
              </>
            )}
          </div>
          {overallLimit > 0 && (
            <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  overallUtilization > 100
                    ? 'bg-red-600'
                    : overallUtilization >= 85
                    ? 'bg-amber-500'
                    : 'bg-emerald-600'
                }`}
                style={{ width: `${Math.min(100, overallUtilization)}%` }}
              />
            </div>
          )}
        </div>

        <form onSubmit={handleSaveOverallLimit} className="flex items-center gap-2 shrink-0">
          <input
            type="number"
            min="0"
            step="1"
            value={overallLimitInput}
            onChange={(e) => setOverallLimitInput(e.target.value)}
            placeholder="Set monthly cap"
            className="w-36 px-3 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
          />
          <button
            type="submit"
            disabled={savingOverall}
            className="px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap"
          >
            {savingOverall ? 'Saving...' : 'Update Limit'}
          </button>
        </form>
      </div>

      {/* Budget vs Actual Chart */}
      {enrichedBudgets.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Budget vs Actual Comparison ({formatMonthLabel(selectedMonth)})
          </h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={enrichedBudgets}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatCurrency(Number(v), currency, true)}
                />
                <Tooltip
                  formatter={(val) => formatCurrency(Number(val ?? 0), currency)}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid #1e293b',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="limitAmount" name="Budget Limit" fill="#64748b" radius={[4, 4, 0, 0]} />
                <Bar dataKey="spent" name="Actual Spent" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Category Budgets Grid */}
      {enrichedBudgets.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-3">
          <Target className="w-10 h-10 text-slate-400 mx-auto" />
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            No category budgets for {formatMonthLabel(selectedMonth)}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Create budgets for categories like Food, Transport, Shopping, or Utilities to monitor monthly utilization automatically.
          </p>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            Create Budget
          </button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {enrichedBudgets.map((b) => (
            <div
              key={b.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-white">{b.category}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Alert at {b.alertThreshold}% ·{' '}
                    <span
                      className={
                        b.status === 'exceeded'
                          ? 'text-red-600 dark:text-red-400 font-semibold'
                          : b.status === 'warning'
                          ? 'text-amber-600 dark:text-amber-400 font-semibold'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }
                    >
                      {b.status === 'exceeded'
                        ? 'Overspent'
                        : b.status === 'warning'
                        ? 'Near Limit'
                        : 'On Track'}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(b)}
                    aria-label="Edit budget"
                    className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => user && deleteBudget(user.uid, b.id)}
                    aria-label="Delete budget"
                    className="p-1.5 rounded text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between text-xs font-mono tabular-nums">
                  <span className="font-bold text-slate-900 dark:text-white">
                    {formatCurrency(b.spent, currency)}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    of {formatCurrency(b.limitAmount, currency)} ({b.utilization.toFixed(0)}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      b.status === 'exceeded'
                        ? 'bg-red-600'
                        : b.status === 'warning'
                        ? 'bg-amber-500'
                        : 'bg-emerald-600'
                    }`}
                    style={{ width: `${Math.min(100, b.utilization)}%` }}
                  />
                </div>
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>
                  {b.remaining >= 0 ? 'Remaining' : 'Over by'}:{' '}
                  <strong className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                    {formatCurrency(Math.abs(b.remaining), currency)}
                  </strong>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editing ? 'Edit Category Budget' : 'New Category Budget'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveBudget} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                >
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Monthly Limit *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={limitAmount}
                    onChange={(e) => setLimitAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Alert Threshold (%)
                  </label>
                  <input
                    type="number"
                    min="50"
                    max="100"
                    value={alertThreshold}
                    onChange={(e) => setAlertThreshold(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Notes
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.SHORT_NOTE_MAX}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold"
                >
                  {saving ? 'Saving...' : 'Save Budget'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
