import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  PiggyBank,
  Plus,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { DashboardDateFilter, NavSection } from '../types/finance';
import { CHART_COLORS } from '../utils/constants';
import {
  formatCurrency,
  formatReadableDate,
  getDateRangeForFilter,
  getTodayStr,
} from '../utils/formatters';
import { aggregateByCategory, buildMonthlySeries } from '../utils/analytics';

interface DashboardPageProps {
  onNavigate: (section: NavSection) => void;
  onAddTransaction: (type: 'income' | 'expense') => void;
}

export function DashboardPage({ onNavigate, onAddTransaction }: DashboardPageProps) {
  const {
    transactions,
    savingsGoals,
    bills,
    debtRecords,
    recordPayments,
    currency,
    dataLoading,
  } = useFinance();

  const [filter, setFilter] = useState<DashboardDateFilter>('month');
  const [customStart, setCustomStart] = useState(getTodayStr().slice(0, 8) + '01');
  const [customEnd, setCustomEnd] = useState(getTodayStr());

  const dateRange = useMemo(
    () => getDateRangeForFilter(filter, customStart, customEnd),
    [filter, customStart, customEnd]
  );

  const filteredTx = useMemo(
    () =>
      transactions.filter(
        (t) => t.date >= dateRange.start && t.date <= dateRange.end
      ),
    [transactions, dateRange]
  );

  const metrics = useMemo(() => {
    const totalIncome = filteredTx
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + t.amount, 0);
    const totalExpenses = filteredTx
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0);
    const netProfit = totalIncome - totalExpenses;

    const allIncome = transactions
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + t.amount, 0);
    const allExpenses = transactions
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0);
    const currentBalance = allIncome - allExpenses;

    const totalSavings = savingsGoals.reduce((s, g) => s + g.savedAmount, 0);

    const pendingBills = bills
      .filter((b) => b.status !== 'paid')
      .reduce((s, b) => s + Math.max(0, b.amount - b.paidAmount), 0);

    const pendingPayableDebts = debtRecords
      .filter((d) => (d.recordType === 'borrowed' || d.recordType === 'payable' || d.recordType === 'loan') && d.status !== 'paid')
      .reduce((s, d) => s + Math.max(0, d.totalAmount - d.paidAmount), 0);

    const pendingPayments = pendingBills + pendingPayableDebts;

    // Total money received (income in range + receivable/lent repayments in range)
    const debtReceivableIds = new Set(
      debtRecords
        .filter((d) => d.recordType === 'lent' || d.recordType === 'receivable')
        .map((d) => d.id)
    );
    const debtRepaymentsReceived = recordPayments
      .filter(
        (p) =>
          p.parentKind === 'debt' &&
          debtReceivableIds.has(p.parentId) &&
          p.date >= dateRange.start &&
          p.date <= dateRange.end
      )
      .reduce((s, p) => s + p.amount, 0);

    const debtPayableIds = new Set(
      debtRecords
        .filter((d) => d.recordType === 'borrowed' || d.recordType === 'payable' || d.recordType === 'loan')
        .map((d) => d.id)
    );
    const debtAndBillPaymentsOut = recordPayments
      .filter(
        (p) =>
          ((p.parentKind === 'debt' && debtPayableIds.has(p.parentId)) ||
            p.parentKind === 'bill') &&
          p.date >= dateRange.start &&
          p.date <= dateRange.end
      )
      .reduce((s, p) => s + p.amount, 0);

    const totalMoneyReceived = totalIncome + debtRepaymentsReceived;
    const totalMoneySpent = totalExpenses + debtAndBillPaymentsOut;

    return {
      totalIncome,
      totalExpenses,
      netProfit,
      currentBalance,
      totalSavings,
      pendingPayments,
      totalMoneyReceived,
      totalMoneySpent,
    };
  }, [filteredTx, transactions, savingsGoals, bills, debtRecords, recordPayments, dateRange]);

  const monthlySeries = useMemo(() => buildMonthlySeries(transactions, 6), [transactions]);
  const expenseCategories = useMemo(
    () => aggregateByCategory(filteredTx, 'expense'),
    [filteredTx]
  );

  const recentTransactions = filteredTx.slice(0, 7);

  if (dataLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-64 bg-slate-200 dark:bg-slate-800 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Date Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Financial Overview
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Showing figures for {dateRange.label} · {filteredTx.length} transaction{filteredTx.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {(
              [
                { id: 'today', label: 'Today' },
                { id: 'week', label: 'This Week' },
                { id: 'month', label: 'This Month' },
                { id: 'year', label: 'This Year' },
                { id: 'custom', label: 'Custom' },
              ] as { id: DashboardDateFilter; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  filter === opt.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {filter === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
              />
            </div>
          )}
        </div>
      </div>

      {/* 8 Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Income"
          value={formatCurrency(metrics.totalIncome, currency)}
          subtext={dateRange.label}
          tone="positive"
          icon={ArrowDownLeft}
        />
        <SummaryCard
          label="Total Expenses"
          value={formatCurrency(metrics.totalExpenses, currency)}
          subtext={dateRange.label}
          tone="negative"
          icon={ArrowUpRight}
        />
        <SummaryCard
          label="Net Profit / Loss"
          value={formatCurrency(metrics.netProfit, currency)}
          subtext={metrics.netProfit >= 0 ? 'Net Surplus' : 'Net Deficit'}
          tone={metrics.netProfit >= 0 ? 'positive' : 'negative'}
          icon={metrics.netProfit >= 0 ? TrendingUp : TrendingDown}
        />
        <SummaryCard
          label="Current Balance"
          value={formatCurrency(metrics.currentBalance, currency)}
          subtext="All-time cumulative net"
          tone={metrics.currentBalance >= 0 ? 'neutral' : 'negative'}
          icon={Wallet}
        />
        <SummaryCard
          label="Total Savings"
          value={formatCurrency(metrics.totalSavings, currency)}
          subtext={`${savingsGoals.length} active or completed goal${savingsGoals.length === 1 ? '' : 's'}`}
          tone="blue"
          icon={PiggyBank}
        />
        <SummaryCard
          label="Pending Payments"
          value={formatCurrency(metrics.pendingPayments, currency)}
          subtext="Unpaid bills, EMIs & payables"
          tone={metrics.pendingPayments > 0 ? 'warning' : 'neutral'}
          icon={Clock}
        />
        <SummaryCard
          label="Total Money Received"
          value={formatCurrency(metrics.totalMoneyReceived, currency)}
          subtext="Income + debt recoveries"
          tone="positive"
          icon={ArrowDownLeft}
        />
        <SummaryCard
          label="Total Money Spent"
          value={formatCurrency(metrics.totalMoneySpent, currency)}
          subtext="Expenses + bill/debt settlements"
          tone="neutral"
          icon={ArrowUpRight}
        />
      </div>

      {/* Empty State Prompt if user has zero records */}
      {transactions.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 mx-auto">
            <Wallet className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Your financial ledger is ready
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Record your first income or expense to populate live cash flow charts, category breakdowns, and profit &amp; loss tracking.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => onAddTransaction('income')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
            >
              <Plus className="w-4 h-4" />
              Add First Income
            </button>
            <button
              type="button"
              onClick={() => onAddTransaction('expense')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold hover:opacity-90"
            >
              <Plus className="w-4 h-4" />
              Add First Expense
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Interactive Charts Row */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    6-Month Cash Flow
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Monthly Income vs Expenses comparison
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('reports')}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                >
                  Full Reports
                </button>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlySeries} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
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
                    <Bar dataKey="income" name="Income" fill="#16A34A" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenses" name="Expenses" fill="#2563EB" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Expense Mix ({dateRange.label})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Distribution across spending categories
                </p>
              </div>
              {expenseCategories.length === 0 ? (
                <div className="h-72 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                  No expenses recorded for {dateRange.label.toLowerCase()}.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={expenseCategories.slice(0, 6)}
                          dataKey="amount"
                          nameKey="category"
                          cx="50%"
                          cy="50%"
                          innerRadius={48}
                          outerRadius={76}
                          paddingAngle={2}
                        >
                          {expenseCategories.slice(0, 6).map((_, index) => (
                            <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
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
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {expenseCategories.slice(0, 4).map((item, idx) => (
                      <div key={item.category} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-xs shrink-0"
                            style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                          />
                          <span className="text-slate-700 dark:text-slate-300 truncate">{item.category}</span>
                        </div>
                        <span className="font-mono tabular-nums text-slate-900 dark:text-white">
                          {formatCurrency(item.amount, currency)} ({item.percentage.toFixed(0)}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Recent Transactions Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Recent Transactions
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Latest entries in {dateRange.label.toLowerCase()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('transactions')}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
              >
                View All Transactions
              </button>
            </div>

            {recentTransactions.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                No transactions found for {dateRange.label.toLowerCase()}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                      <th className="py-3 px-5">Date</th>
                      <th className="py-3 px-4">Title</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4">Method</th>
                      <th className="py-3 px-5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                    {recentTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-5 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {formatReadableDate(tx.date)}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900 dark:text-slate-100">
                          {tx.title}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-400">
                          {tx.category}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400">
                          {tx.paymentMethod}
                        </td>
                        <td
                          className={`py-3 px-5 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                            tx.type === 'income'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {tx.type === 'income' ? '+' : '-'}
                          {formatCurrency(tx.amount, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  subtext: string;
  tone: 'positive' | 'negative' | 'warning' | 'blue' | 'neutral';
  icon: React.ComponentType<{ className?: string }>;
}

function SummaryCard({ label, value, subtext, tone, icon: Icon }: SummaryCardProps) {
  const toneClasses = {
    positive: 'text-emerald-600 dark:text-emerald-400',
    negative: 'text-red-600 dark:text-red-400',
    warning: 'text-amber-600 dark:text-amber-400',
    blue: 'text-blue-600 dark:text-blue-400',
    neutral: 'text-slate-700 dark:text-slate-300',
  }[tone];

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <Icon className={`w-4 h-4 shrink-0 ${toneClasses}`} />
      </div>
      <div>
        <div className={`text-xl font-bold font-mono tabular-nums tracking-tight ${tone === 'positive' || tone === 'negative' ? toneClasses : 'text-slate-900 dark:text-white'}`}>
          {value}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{subtext}</div>
      </div>
    </div>
  );
}
