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
import {
  CalendarClock,
  Edit2,
  Paperclip,
  Pause,
  Play,
  Plus,
  Repeat,
  Trash2,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import {
  ExpenseCategory,
  IncomeCategory,
  PaymentMethod,
  RecurringFrequency,
  TransactionRecord,
  TransactionType,
} from '../types/finance';
import {
  EXPENSE_CATEGORIES,
  FIELD_LIMITS,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
} from '../utils/constants';
import {
  formatCurrency,
  formatReadableDate,
  getCurrentMonthStr,
  getTodayStr,
} from '../utils/formatters';
import { aggregateByCategory } from '../utils/analytics';
import {
  createRecurringTransaction,
  deleteRecurringTransaction,
  deleteTransaction,
  runRecurringTransactionNow,
  toggleRecurringActive,
} from '../services/firestoreService';

interface LedgerCategoryPageProps {
  mode: TransactionType;
  onAddNew: (type: TransactionType) => void;
  onEdit: (record: TransactionRecord) => void;
  onViewReceipt: (record: TransactionRecord) => void;
}

export function LedgerCategoryPage({
  mode,
  onAddNew,
  onEdit,
  onViewReceipt,
}: LedgerCategoryPageProps) {
  const { user, transactions, recurringTransactions, currency } = useFinance();
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [showRecurringForm, setShowRecurringForm] = useState(false);

  // Recurring form state
  const [recTitle, setRecTitle] = useState('');
  const [recAmount, setRecAmount] = useState('');
  const [recCategory, setRecCategory] = useState<IncomeCategory | ExpenseCategory>(
    mode === 'income' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]
  );
  const [recMethod, setRecMethod] = useState<PaymentMethod>('Bank Transfer');
  const [recFreq, setRecFreq] = useState<RecurringFrequency>('monthly');
  const [recStartDate, setRecStartDate] = useState(getTodayStr());
  const [recDesc, setRecDesc] = useState('');
  const [recSaving, setRecSaving] = useState(false);

  const items = useMemo(
    () =>
      transactions.filter(
        (t) =>
          t.type === mode &&
          (selectedCategory === 'All' || t.category === selectedCategory)
      ),
    [transactions, mode, selectedCategory]
  );

  const allModeItems = useMemo(
    () => transactions.filter((t) => t.type === mode),
    [transactions, mode]
  );

  const recurringList = useMemo(
    () => recurringTransactions.filter((r) => r.type === mode),
    [recurringTransactions, mode]
  );

  const stats = useMemo(() => {
    const today = getTodayStr();
    const month = getCurrentMonthStr();
    const year = today.slice(0, 4);
    let todayTotal = 0;
    let monthTotal = 0;
    let yearTotal = 0;
    let allTotal = 0;

    allModeItems.forEach((t) => {
      allTotal += t.amount;
      if (t.date === today) todayTotal += t.amount;
      if (t.date.startsWith(month)) monthTotal += t.amount;
      if (t.date.startsWith(year)) yearTotal += t.amount;
    });

    return { todayTotal, monthTotal, yearTotal, allTotal };
  }, [allModeItems]);

  const categoryBreakdown = useMemo(
    () => aggregateByCategory(allModeItems, mode),
    [allModeItems, mode]
  );

  const categories = mode === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const handleDelete = async (id: string) => {
    if (!user) return;
    await deleteTransaction(user.uid, id);
  };

  const handleCreateRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const amt = Number(recAmount);
    if (!Number.isFinite(amt) || amt <= 0 || !recTitle.trim()) return;
    setRecSaving(true);
    try {
      await createRecurringTransaction(user.uid, {
        type: mode,
        title: recTitle.trim(),
        amount: amt,
        category: recCategory,
        paymentMethod: recMethod,
        frequency: recFreq,
        startDate: recStartDate,
        nextRunDate: recStartDate,
        isActive: true,
        description: recDesc,
      });
      setRecTitle('');
      setRecAmount('');
      setRecDesc('');
      setShowRecurringForm(false);
    } finally {
      setRecSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {mode === 'income' ? 'Income Management' : 'Expense Management'}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {mode === 'income'
              ? 'Record salary, freelancing, business revenue, and recurring income streams.'
              : 'Track daily spending, attach receipts, and automate recurring expenses.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setRecCategory(mode === 'income' ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
              setShowRecurringForm((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Repeat className="w-3.5 h-3.5" />
            Schedule Recurring
          </button>
          <button
            type="button"
            onClick={() => onAddNew(mode)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-xs font-semibold whitespace-nowrap ${
              mode === 'income'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-slate-900 dark:bg-blue-600 hover:opacity-90'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            Add {mode === 'income' ? 'Income' : 'Expense'}
          </button>
        </div>
      </div>

      {/* Period Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Today', value: stats.todayTotal },
          { label: 'This Month', value: stats.monthTotal },
          { label: 'This Year', value: stats.yearTotal },
          { label: 'All Time', value: stats.allTotal },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400">{s.label}</div>
            <div
              className={`text-lg font-bold font-mono tabular-nums mt-1 ${
                mode === 'income'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {formatCurrency(s.value, currency)}
            </div>
          </div>
        ))}
      </div>

      {/* Recurring Rules Drawer */}
      {(showRecurringForm || recurringList.length > 0) && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Recurring {mode === 'income' ? 'Income' : 'Expenses'} ({recurringList.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowRecurringForm((v) => !v)}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
            >
              {showRecurringForm ? 'Close Form' : '+ New Schedule'}
            </button>
          </div>

          {showRecurringForm && (
            <form
              onSubmit={handleCreateRecurring}
              className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 grid sm:grid-cols-2 lg:grid-cols-3 gap-3"
            >
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.TITLE_MAX}
                value={recTitle}
                onChange={(e) => setRecTitle(e.target.value)}
                placeholder={mode === 'income' ? 'Title (e.g., Monthly Salary)' : 'Title (e.g., Apartment Rent)'}
                className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
              />
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={recAmount}
                onChange={(e) => setRecAmount(e.target.value)}
                placeholder="Amount"
                className="px-3 py-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
              />
              <select
                value={recCategory}
                onChange={(e) => setRecCategory(e.target.value as IncomeCategory | ExpenseCategory)}
                className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={recFreq}
                onChange={(e) => setRecFreq(e.target.value as RecurringFrequency)}
                className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
              <select
                value={recMethod}
                onChange={(e) => setRecMethod(e.target.value as PaymentMethod)}
                className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                type="date"
                required
                value={recStartDate}
                onChange={(e) => setRecStartDate(e.target.value)}
                className="px-3 py-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
              />
              <input
                type="text"
                maxLength={FIELD_LIMITS.DESCRIPTION_MAX}
                value={recDesc}
                onChange={(e) => setRecDesc(e.target.value)}
                placeholder="Description (optional)"
                className="sm:col-span-2 px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
              />
              <button
                type="submit"
                disabled={recSaving}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90"
              >
                {recSaving ? 'Creating...' : 'Create Recurring Rule'}
              </button>
            </form>
          )}

          {recurringList.length > 0 && (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recurringList.map((rule) => (
                <div
                  key={rule.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                      <span>{rule.title}</span>
                      <span className="text-slate-400 font-normal">·</span>
                      <span className="font-mono text-slate-600 dark:text-slate-300 capitalize">
                        {rule.frequency}
                      </span>
                      {!rule.isActive && (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">· Paused</span>
                      )}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {rule.category} · {rule.paymentMethod} · Next run: {formatReadableDate(rule.nextRunDate)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                      {formatCurrency(rule.amount, currency)}
                    </span>
                    <button
                      type="button"
                      onClick={() => user && runRecurringTransactionNow(user.uid, rule)}
                      className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Run Now
                    </button>
                    <button
                      type="button"
                      onClick={() => user && toggleRecurringActive(user.uid, rule.id, !rule.isActive)}
                      aria-label={rule.isActive ? 'Pause rule' : 'Resume rule'}
                      className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                      {rule.isActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => user && deleteRecurringTransaction(user.uid, rule.id)}
                      aria-label="Delete recurring rule"
                      className="p-1.5 rounded text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Category Breakdown Chart */}
      {categoryBreakdown.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {mode === 'income' ? 'Income by Category' : 'Expenses by Category'}
          </h3>
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryBreakdown} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
                <Bar
                  dataKey="amount"
                  name={mode === 'income' ? 'Income' : 'Expense'}
                  fill={mode === 'income' ? '#16A34A' : '#2563EB'}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filter & Records Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            {mode === 'income' ? 'Income Records' : 'Expense Records'} ({items.length})
          </h3>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
          >
            <option value="All">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {items.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No {mode} entries found{selectedCategory !== 'All' ? ` in ${selectedCategory}` : ''}.
            </p>
            <button
              type="button"
              onClick={() => onAddNew(mode)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              Record {mode === 'income' ? 'Income' : 'Expense'}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-3 px-5">Date</th>
                  <th className="py-3 px-4">{mode === 'income' ? 'Source' : 'Title'}</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4">Receipt</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                {items.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-5 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatReadableDate(tx.date)}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-white">{tx.title}</div>
                      {tx.description && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                          {tx.description}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">
                      {tx.category}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400">
                      {tx.paymentMethod}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {tx.receiptDataUrl ? (
                        <button
                          type="button"
                          onClick={() => onViewReceipt(tx)}
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                          View
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                        mode === 'income'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {formatCurrency(tx.amount, currency)}
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEdit(tx)}
                          aria-label="Edit record"
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(tx.id)}
                          aria-label="Delete record"
                          className="p-1.5 rounded-md text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
