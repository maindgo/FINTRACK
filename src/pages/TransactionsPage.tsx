import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Calendar,
  Download,
  Edit2,
  Filter,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { TransactionRecord, TransactionType } from '../types/finance';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../utils/constants';
import {
  formatCurrency,
  formatReadableDate,
  getDateRangeForFilter,
  getTodayStr,
} from '../utils/formatters';
import {
  exportGeneralLedgerToExcel,
  exportGeneralLedgerToPDF,
  exportTransactionsToCSV,
  exportTransactionsToExcel,
  exportTransactionsToPDF,
} from '../utils/exporters';
import { deleteTransaction } from '../services/firestoreService';

interface TransactionsPageProps {
  onAddNew: (type: TransactionType) => void;
  onEdit: (record: TransactionRecord) => void;
  onViewReceipt: (record: TransactionRecord) => void;
}

export function TransactionsPage({
  onAddNew,
  onEdit,
  onViewReceipt,
}: TransactionsPageProps) {
  const { user, transactions, currency } = useFinance();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [datePreset, setDatePreset] = useState<'all' | 'today' | 'week' | 'month' | 'last30' | 'custom'>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'>(
    'date_desc'
  );

  const hasActiveFilters =
    search.trim() !== '' ||
    typeFilter !== 'all' ||
    categoryFilter !== 'All' ||
    datePreset !== 'all' ||
    startDate !== '' ||
    endDate !== '' ||
    minAmount !== '' ||
    maxAmount !== '';

  const resetAllFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setCategoryFilter('All');
    setDatePreset('all');
    setStartDate('');
    setEndDate('');
    setMinAmount('');
    setMaxAmount('');
    setSortBy('date_desc');
  };

  const resolvedDateRange = useMemo(() => {
    if (datePreset === 'all') return { start: '', end: '' };
    if (datePreset === 'custom') return { start: startDate, end: endDate };
    if (datePreset === 'last30') {
      const now = new Date();
      const past = new Date(now);
      past.setDate(now.getDate() - 29);
      const start = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(
        past.getDate()
      ).padStart(2, '0')}`;
      return { start, end: getTodayStr() };
    }
    const r = getDateRangeForFilter(datePreset);
    return { start: r.start, end: r.end };
  }, [datePreset, startDate, endDate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minVal = minAmount.trim() !== '' ? Number(minAmount) : null;
    const maxVal = maxAmount.trim() !== '' ? Number(maxAmount) : null;

    const list = transactions.filter((t) => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false;
      if (categoryFilter !== 'All' && t.category !== categoryFilter) return false;
      if (resolvedDateRange.start && t.date < resolvedDateRange.start) return false;
      if (resolvedDateRange.end && t.date > resolvedDateRange.end) return false;
      if (minVal !== null && Number.isFinite(minVal) && t.amount < minVal) return false;
      if (maxVal !== null && Number.isFinite(maxVal) && t.amount > maxVal) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.paymentMethod.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.notes.toLowerCase().includes(q) ||
        String(t.amount).includes(q)
      );
    });

    list.sort((a, b) => {
      if (sortBy === 'date_desc') {
        const cmp = b.date.localeCompare(a.date);
        return cmp !== 0 ? cmp : (b.time || '').localeCompare(a.time || '');
      }
      if (sortBy === 'date_asc') {
        const cmp = a.date.localeCompare(b.date);
        return cmp !== 0 ? cmp : (a.time || '').localeCompare(b.time || '');
      }
      if (sortBy === 'amount_desc') return b.amount - a.amount;
      return a.amount - b.amount;
    });

    return list;
  }, [
    transactions,
    search,
    typeFilter,
    categoryFilter,
    resolvedDateRange,
    minAmount,
    maxAmount,
    sortBy,
  ]);

  const filteredTotals = useMemo(() => {
    const inc = filtered.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = filtered.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { inc, exp, net: inc - exp };
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Transaction History
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Search, filter, sort, and export your complete income &amp; expense ledger.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => exportTransactionsToCSV(filtered, currency)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => exportTransactionsToExcel(filtered, currency)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
          <button
            type="button"
            onClick={() => exportTransactionsToPDF(filtered, currency, 'FinTrack Transaction Ledger')}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </button>
          <button
            type="button"
            onClick={() => exportGeneralLedgerToExcel(filtered, currency)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Ledger Excel
          </button>
          <button
            type="button"
            onClick={() => exportGeneralLedgerToPDF(filtered, currency)}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Ledger PDF
          </button>
          <button
            type="button"
            onClick={() => onAddNew('expense')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Entry
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, category, notes, amount..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
            />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            {(['all', 'income', 'expense'] as const).map((tp) => (
              <button
                key={tp}
                type="button"
                onClick={() => setTypeFilter(tp)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                  typeFilter === tp
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tp}
              </button>
            ))}
          </div>

          <div className="relative">
            <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
              className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
            >
              <option value="All">All Categories</option>
              {typeFilter !== 'expense' && (
                <optgroup label="Income Categories">
                  {INCOME_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              )}
              {typeFilter !== 'income' && (
                <optgroup label="Expense Categories">
                  {EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="relative">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              aria-label="Sort transactions"
              className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
            >
              <option value="date_desc">Date: Newest First</option>
              <option value="date_asc">Date: Oldest First</option>
              <option value="amount_desc">Amount: Highest First</option>
              <option value="amount_asc">Amount: Lowest First</option>
            </select>
          </div>
        </div>

        {/* Date Range & Amount Range Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="relative">
            <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value as typeof datePreset)}
              aria-label="Filter by date range"
              className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
            >
              <option value="all">Date Range: All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="last30">Last 30 Days</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </div>

          {datePreset === 'custom' ? (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Start date"
                className="w-full px-2.5 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
              />
              <span className="text-xs text-slate-400 shrink-0">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="End date"
                className="w-full px-2.5 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
              />
            </div>
          ) : (
            <div className="flex items-center px-3 py-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 rounded-lg bg-slate-50/60 dark:bg-slate-950/60 border border-slate-200/70 dark:border-slate-800">
              {resolvedDateRange.start && resolvedDateRange.end
                ? `${resolvedDateRange.start} → ${resolvedDateRange.end}`
                : 'Showing all dates'}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="any"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              placeholder={`Min ${currency}`}
              aria-label="Minimum amount"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
            />
            <span className="text-xs text-slate-400 shrink-0">–</span>
            <input
              type="number"
              min="0"
              step="any"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              placeholder={`Max ${currency}`}
              aria-label="Maximum amount"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700"
            />
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              disabled={!hasActiveFilters}
              onClick={resetAllFilters}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* Filtered Summary Bar */}
      <div className="flex flex-wrap items-center gap-6 px-4 py-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
        <span className="text-slate-500 dark:text-slate-400">
          Matches: <strong className="font-mono text-slate-900 dark:text-white">{filtered.length}</strong>
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          Income: <strong className="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(filteredTotals.inc, currency)}</strong>
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          Expenses: <strong className="font-mono tabular-nums text-slate-900 dark:text-white">{formatCurrency(filteredTotals.exp, currency)}</strong>
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          Net: <strong className={`font-mono tabular-nums ${filteredTotals.net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{formatCurrency(filteredTotals.net, currency)}</strong>
        </span>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            No transactions match your current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-3 px-5">Date &amp; Time</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Title</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                {filtered.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-5 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatReadableDate(tx.date)} {tx.time ? `· ${tx.time}` : ''}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium capitalize">
                      <span
                        className={
                          tx.type === 'income'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-600 dark:text-slate-300'
                        }
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-white flex items-center gap-2">
                        <span>{tx.title}</span>
                        {tx.receiptDataUrl && (
                          <button
                            type="button"
                            onClick={() => onViewReceipt(tx)}
                            className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center"
                            title="View receipt"
                          >
                            <Paperclip className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {(tx.description || tx.notes) && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs">
                          {tx.description || tx.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">
                      {tx.category}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400">
                      {tx.paymentMethod}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                        tx.type === 'income'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {tx.type === 'income' ? '+' : '-'}
                      {formatCurrency(tx.amount, currency)}
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEdit(tx)}
                          aria-label="Edit transaction"
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => user && deleteTransaction(user.uid, tx.id)}
                          aria-label="Delete transaction"
                          className="p-1.5 rounded-md text-red-500 hover:text-red-700"
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
