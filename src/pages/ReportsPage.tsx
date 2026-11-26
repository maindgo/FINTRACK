import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { CHART_COLORS } from '../utils/constants';
import {
  formatCurrency,
  formatCurrencyAscii,
  formatMonthLabel,
  formatReadableDate,
  getCurrentMonthStr,
  getTodayStr,
} from '../utils/formatters';
import { aggregateByCategory, buildMonthlySeries } from '../utils/analytics';
import {
  buildArApSchedule,
  buildBalanceSheetStatement,
  buildFinancialStatsSnapshot,
  buildGeneralLedgerRows,
  buildTrialBalance,
} from '../utils/erpAnalytics';
import {
  exportArApScheduleToExcel,
  exportArApScheduleToPDF,
  exportBalanceSheetToExcel,
  exportBalanceSheetToPDF,
  exportErpFullReportToPDF,
  exportErpFullWorkbookToExcel,
  exportFinancialStatsToExcel,
  exportFinancialStatsToPDF,
  exportGeneralLedgerToExcel,
  exportGeneralLedgerToPDF,
  exportGenericReportToPDF,
  exportProfitLossToExcel,
  exportProfitLossToPDF,
  exportTransactionsToCSV,
  exportTransactionsToExcel,
  exportTrialBalanceToExcel,
  exportTrialBalanceToPDF,
} from '../utils/exporters';

type ReportTab =
  | 'monthly'
  | 'yearly'
  | 'income'
  | 'expense'
  | 'profit-loss'
  | 'balance-sheet'
  | 'general-ledger'
  | 'trial-balance'
  | 'ar-ap'
  | 'savings'
  | 'category-expense'
  | 'cash-flow';

const REPORT_TABS: { id: ReportTab; label: string }[] = [
  { id: 'monthly', label: 'Monthly Financial' },
  { id: 'yearly', label: 'Yearly Financial' },
  { id: 'profit-loss', label: 'Profit & Loss' },
  { id: 'balance-sheet', label: 'Balance Sheet' },
  { id: 'general-ledger', label: 'General Ledger' },
  { id: 'trial-balance', label: 'Trial Balance' },
  { id: 'ar-ap', label: 'AR / AP & Aging' },
  { id: 'cash-flow', label: 'Cash Flow' },
  { id: 'income', label: 'Income Report' },
  { id: 'expense', label: 'Expense Report' },
  { id: 'category-expense', label: 'Category Expense' },
  { id: 'savings', label: 'Savings Report' },
];

export function ReportsPage() {
  const {
    user,
    profile,
    transactions,
    savingsGoals,
    budgets,
    debtRecords,
    bills,
    recordPayments,
    recurringTransactions,
    currency,
  } = useFinance();

  const [activeTab, setActiveTab] = useState<ReportTab>('monthly');
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthStr());
  const [selectedYear, setSelectedYear] = useState(getTodayStr().slice(0, 4));

  const availableYears = useMemo(() => {
    const set = new Set<string>([getTodayStr().slice(0, 4)]);
    transactions.forEach((t) => set.add(t.date.slice(0, 4)));
    return Array.from(set).sort().reverse();
  }, [transactions]);

  const scopedTransactions = useMemo(() => {
    if (activeTab === 'monthly') {
      return transactions.filter((t) => t.date.startsWith(selectedMonth));
    }
    if (activeTab === 'yearly') {
      return transactions.filter((t) => t.date.startsWith(selectedYear));
    }
    if (activeTab === 'income') {
      return transactions.filter((t) => t.type === 'income');
    }
    if (activeTab === 'expense' || activeTab === 'category-expense') {
      return transactions.filter((t) => t.type === 'expense');
    }
    return transactions;
  }, [transactions, activeTab, selectedMonth, selectedYear]);

  const totals = useMemo(() => {
    const income = scopedTransactions
      .filter((t) => t.type === 'income')
      .reduce((s, t) => s + t.amount, 0);
    const expenses = scopedTransactions
      .filter((t) => t.type === 'expense')
      .reduce((s, t) => s + t.amount, 0);
    return { income, expenses, net: income - expenses };
  }, [scopedTransactions]);

  const yearlyBreakdown = useMemo(() => {
    return Array.from({ length: 12 }, (_, idx) => {
      const m = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
      const label = new Date(Number(selectedYear), idx, 1).toLocaleDateString('en-IN', {
        month: 'short',
      });
      let income = 0;
      let expenses = 0;
      transactions.forEach((t) => {
        if (t.date.startsWith(m)) {
          if (t.type === 'income') income += t.amount;
          else expenses += t.amount;
        }
      });
      return { month: m, label, income, expenses, profit: income - expenses };
    });
  }, [transactions, selectedYear]);

  const monthlySeries = useMemo(() => buildMonthlySeries(transactions, 12), [transactions]);
  const incomeCats = useMemo(() => aggregateByCategory(scopedTransactions, 'income'), [scopedTransactions]);
  const expenseCats = useMemo(() => aggregateByCategory(scopedTransactions, 'expense'), [scopedTransactions]);

  const balanceSheet = useMemo(
    () =>
      buildBalanceSheetStatement(
        transactions,
        savingsGoals,
        debtRecords,
        bills,
        profile?.openingBankBalance || 0,
        profile?.openingCashBalance || 0
      ),
    [
      transactions,
      savingsGoals,
      debtRecords,
      bills,
      profile?.openingBankBalance,
      profile?.openingCashBalance,
    ]
  );
  const generalLedger = useMemo(() => buildGeneralLedgerRows(transactions), [transactions]);
  const trialBalance = useMemo(() => buildTrialBalance(transactions), [transactions]);
  const arApSchedule = useMemo(() => buildArApSchedule(debtRecords, bills), [debtRecords, bills]);
  const statsSnapshot = useMemo(
    () =>
      buildFinancialStatsSnapshot({
        periodLabel: 'All-Time & Current Positions',
        periodStart: '0000-01-01',
        periodEnd: '9999-12-31',
        allTransactions: transactions,
        savingsGoals,
        budgets,
        debtRecords,
        bills,
        recordPayments,
        recurringTransactions,
        openingBankBalance: profile?.openingBankBalance || 0,
        openingCashBalance: profile?.openingCashBalance || 0,
      }),
    [
      transactions,
      savingsGoals,
      budgets,
      debtRecords,
      bills,
      recordPayments,
      recurringTransactions,
      profile?.openingBankBalance,
      profile?.openingCashBalance,
    ]
  );

  const savingsChartData = useMemo(
    () =>
      savingsGoals.map((g) => ({
        name: g.name.slice(0, 18),
        saved: g.savedAmount,
        remaining: Math.max(0, g.targetAmount - g.savedAmount),
        target: g.targetAmount,
      })),
    [savingsGoals]
  );

  const fullErpInput = {
    ownerName: profile?.displayName || user?.displayName || 'FinTrack User',
    currency,
    transactions,
    savingsGoals,
    budgets,
    debtRecords,
    bills,
    recordPayments,
    recurringTransactions,
  };

  const handleExportActiveExcel = () => {
    if (activeTab === 'balance-sheet') {
      exportBalanceSheetToExcel(transactions, savingsGoals, debtRecords, bills, currency);
      return;
    }
    if (activeTab === 'general-ledger') {
      exportGeneralLedgerToExcel(transactions, currency);
      return;
    }
    if (activeTab === 'trial-balance') {
      exportTrialBalanceToExcel(transactions, currency);
      return;
    }
    if (activeTab === 'ar-ap') {
      exportArApScheduleToExcel(debtRecords, bills, currency);
      return;
    }
    if (activeTab === 'profit-loss') {
      exportProfitLossToExcel(transactions, currency);
      return;
    }
    exportTransactionsToExcel(scopedTransactions, currency, `fintrack-${activeTab}`);
  };

  const handleExportActivePDF = () => {
    if (activeTab === 'balance-sheet') {
      exportBalanceSheetToPDF(transactions, savingsGoals, debtRecords, bills, currency);
      return;
    }
    if (activeTab === 'general-ledger') {
      exportGeneralLedgerToPDF(transactions, currency);
      return;
    }
    if (activeTab === 'trial-balance') {
      exportTrialBalanceToPDF(transactions, currency);
      return;
    }
    if (activeTab === 'ar-ap') {
      exportArApScheduleToPDF(debtRecords, bills, currency);
      return;
    }
    if (activeTab === 'profit-loss') {
      exportProfitLossToPDF(transactions, currency);
      return;
    }

    const title = (REPORT_TABS.find((t) => t.id === activeTab)?.label || 'Financial') + ' Report';
    if (activeTab === 'savings') {
      const totalSaved = savingsGoals.reduce((s, g) => s + g.savedAmount, 0);
      const totalTarget = savingsGoals.reduce((s, g) => s + g.targetAmount, 0);
      exportGenericReportToPDF(
        title,
        [
          { label: 'Total Saved', value: formatCurrencyAscii(totalSaved, currency) },
          { label: 'Total Target', value: formatCurrencyAscii(totalTarget, currency) },
        ],
        ['Goal Name', 'Category', 'Target Date', 'Saved', 'Target', 'Status'],
        savingsGoals.map((g) => [
          g.name,
          g.category,
          g.targetDate,
          formatCurrencyAscii(g.savedAmount, currency),
          formatCurrencyAscii(g.targetAmount, currency),
          g.status,
        ]),
        'fintrack-savings-report'
      );
      return;
    }

    if (activeTab === 'category-expense') {
      exportGenericReportToPDF(
        title,
        [{ label: 'Total Expenses', value: formatCurrencyAscii(totals.expenses, currency) }],
        ['Category', 'Transactions', 'Total Amount', 'Share (%)'],
        expenseCats.map((c) => [
          c.category,
          c.count,
          formatCurrencyAscii(c.amount, currency),
          `${c.percentage.toFixed(1)}%`,
        ]),
        'fintrack-category-expense-report'
      );
      return;
    }

    exportGenericReportToPDF(
      title,
      [
        { label: 'Income', value: formatCurrencyAscii(totals.income, currency) },
        { label: 'Expenses', value: formatCurrencyAscii(totals.expenses, currency) },
        { label: 'Net P&L', value: formatCurrencyAscii(totals.net, currency) },
        { label: 'Entries', value: String(scopedTransactions.length) },
      ],
      ['Date', 'Type', 'Title', 'Category', 'Method', 'Amount'],
      scopedTransactions.map((t) => [
        t.date,
        t.type,
        t.title.slice(0, 32),
        t.category,
        t.paymentMethod,
        formatCurrencyAscii(t.amount, currency),
      ]),
      `fintrack-${activeTab}-report`
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Reports, Analytics &amp; ERP Statements
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Interactive charts plus audit-ready General Ledger, Balance Sheet, Trial Balance, P&amp;L, and AR/AP schedules.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {activeTab === 'monthly' && (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
            />
          )}
          {activeTab === 'yearly' && (
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="px-3 py-1.5 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => exportTransactionsToCSV(scopedTransactions, currency, `fintrack-${activeTab}`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            type="button"
            onClick={handleExportActiveExcel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            Excel
          </button>
          <button
            type="button"
            onClick={handleExportActivePDF}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
          </button>
        </div>
      </div>

      {/* ERP Statement & Financial Stats Export Center */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-0.5">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            ERP Financial Export Suite
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Download complete multi-sheet Excel workbooks or multi-section PDF packages covering Financial Stats, P&amp;L, Balance Sheet, Trial Balance, General Ledger, Cash Flow, and AR/AP Aging.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => exportFinancialStatsToExcel(statsSnapshot, transactions, currency)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            Financial Stats (Excel)
          </button>
          <button
            type="button"
            onClick={() => exportFinancialStatsToPDF(statsSnapshot, transactions, currency)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            Financial Stats (PDF)
          </button>
          <button
            type="button"
            onClick={() => exportErpFullWorkbookToExcel(fullErpInput)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/50 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Full ERP Pack (Excel)
          </button>
          <button
            type="button"
            onClick={() => exportErpFullReportToPDF(fullErpInput)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Full ERP Pack (PDF)
          </button>
        </div>
      </div>

      {/* Report Tabs */}
      <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active Report Content */}
      {activeTab === 'monthly' && (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-3 gap-4">
            <MetricBox label={`Income (${formatMonthLabel(selectedMonth)})`} value={formatCurrency(totals.income, currency)} tone="positive" />
            <MetricBox label={`Expenses (${formatMonthLabel(selectedMonth)})`} value={formatCurrency(totals.expenses, currency)} tone="neutral" />
            <MetricBox label="Monthly Net Surplus / Deficit" value={formatCurrency(totals.net, currency)} tone={totals.net >= 0 ? 'positive' : 'negative'} />
          </div>
          <div className="grid lg:grid-cols-2 gap-6">
            <ChartCard title="Expense Distribution" subtitle={formatMonthLabel(selectedMonth)}>
              <CategoryPieChart data={expenseCats} currency={currency} />
            </ChartCard>
            <ChartCard title="Income Distribution" subtitle={formatMonthLabel(selectedMonth)}>
              <CategoryPieChart data={incomeCats} currency={currency} />
            </ChartCard>
          </div>
        </div>
      )}

      {activeTab === 'yearly' && (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-3 gap-4">
            <MetricBox label={`${selectedYear} Total Income`} value={formatCurrency(totals.income, currency)} tone="positive" />
            <MetricBox label={`${selectedYear} Total Expenses`} value={formatCurrency(totals.expenses, currency)} tone="neutral" />
            <MetricBox label={`${selectedYear} Net P&L`} value={formatCurrency(totals.net, currency)} tone={totals.net >= 0 ? 'positive' : 'negative'} />
          </div>
          <ChartCard title={`${selectedYear} Monthly Performance`} subtitle="Income vs Expenses across all 12 months">
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yearlyBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(Number(v), currency, true)} />
                  <Tooltip formatter={(val) => formatCurrency(Number(val ?? 0), currency)} contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '12px' }} />
                  <Bar dataKey="income" name="Income" fill="#16A34A" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#2563EB" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}

      {activeTab === 'income' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <ChartCard title="Income by Category" subtitle="All-time share by source category">
            <CategoryPieChart data={incomeCats} currency={currency} />
          </ChartCard>
          <ChartCard title="Monthly Income Trend" subtitle="Trailing 12 months">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(Number(v), currency, true)} />
                  <Tooltip formatter={(val) => formatCurrency(Number(val ?? 0), currency)} contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '12px' }} />
                  <Line type="monotone" dataKey="income" name="Income" stroke="#16A34A" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}

      {(activeTab === 'expense' || activeTab === 'category-expense') && (
        <div className="grid lg:grid-cols-2 gap-6">
          <ChartCard title="Category-wise Expense Share" subtitle="Percentage breakdown across categories">
            <CategoryPieChart data={expenseCats} currency={currency} />
          </ChartCard>
          <ChartCard title="Category Spending Comparison" subtitle="Sorted highest to lowest">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={expenseCats} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => formatCurrency(Number(v), currency, true)} />
                  <YAxis type="category" dataKey="category" width={100} tick={{ fontSize: 11, fill: '#64748b' }} />
                  <Tooltip formatter={(val) => formatCurrency(Number(val ?? 0), currency)} contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '12px' }} />
                  <Bar dataKey="amount" name="Spent" fill="#2563EB" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>
      )}

      {activeTab === 'profit-loss' && (
        <ChartCard title="12-Month Net Profit & Loss" subtitle="Monthly surplus and deficit performance (use Excel/PDF buttons above for structured P&L Statement)">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(Number(v), currency, true)} />
                <Tooltip formatter={(val) => formatCurrency(Number(val ?? 0), currency)} contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '12px' }} />
                <Bar dataKey="profit" name="Net P&L">
                  {monthlySeries.map((entry, idx) => (
                    <Cell key={idx} fill={entry.profit >= 0 ? '#16A34A' : '#DC2626'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}

      {activeTab === 'balance-sheet' && (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-3 gap-4">
            <MetricBox label="Total Assets" value={formatCurrency(balanceSheet.totalAssets, currency)} tone="positive" />
            <MetricBox label="Total Liabilities" value={formatCurrency(balanceSheet.totalLiabilities, currency)} tone={balanceSheet.totalLiabilities > 0 ? 'negative' : 'neutral'} />
            <MetricBox label="Owner Net Worth (Equity)" value={formatCurrency(balanceSheet.netWorth, currency)} tone={balanceSheet.netWorth >= 0 ? 'positive' : 'negative'} />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Assets</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">As of {formatReadableDate(balanceSheet.asOfDate)}</p>
                </div>
                <span className="text-xs font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(balanceSheet.totalAssets, currency)}
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {balanceSheet.assets.map((item) => (
                  <div key={item.code} className="px-5 py-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">
                        <span className="font-mono text-xs text-slate-400 mr-2">{item.code}</span>
                        {item.label}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{item.group} · {item.note}</div>
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-sm text-slate-900 dark:text-white whitespace-nowrap">
                      {formatCurrency(item.amount, currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Liabilities &amp; Net Worth</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Assets = Liabilities + Net Worth</p>
                </div>
                <span className="text-xs font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                  {formatCurrency(balanceSheet.totalLiabilities + balanceSheet.netWorth, currency)}
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {balanceSheet.liabilities.map((item) => (
                  <div key={item.code} className="px-5 py-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">
                        <span className="font-mono text-xs text-slate-400 mr-2">{item.code}</span>
                        {item.label}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{item.group} · {item.note}</div>
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-sm text-red-600 dark:text-red-400 whitespace-nowrap">
                      {formatCurrency(item.amount, currency)}
                    </span>
                  </div>
                ))}
                <div className="px-5 py-3.5 flex items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-950/40">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      <span className="font-mono text-xs text-slate-400 mr-2">E-300</span>
                      Owner Net Worth (Equity)
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Total Assets minus Total Liabilities</div>
                  </div>
                  <span className={`font-mono tabular-nums font-bold text-sm whitespace-nowrap ${balanceSheet.netWorth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {formatCurrency(balanceSheet.netWorth, currency)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'general-ledger' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                General Ledger (Chronological Running Balance)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {generalLedger.length} posted journal vouchers with Debit, Credit, and Running Cash Balance
              </p>
            </div>
          </div>
          {generalLedger.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No transactions recorded yet. Add income or expenses to populate the General Ledger.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4">Voucher</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Account</th>
                    <th className="py-3 px-4">Particulars</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4 text-right">Debit (Out)</th>
                    <th className="py-3 px-4 text-right">Credit (In)</th>
                    <th className="py-3 px-5 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                  {generalLedger.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">{r.voucherNo}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">{formatReadableDate(r.date)}</td>
                      <td className="py-2.5 px-4 text-slate-700 dark:text-slate-200">{r.account}</td>
                      <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-white">{r.particulars}</td>
                      <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">{r.paymentMethod}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-red-600 dark:text-red-400 whitespace-nowrap">
                        {r.debit > 0 ? formatCurrency(r.debit, currency) : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {r.credit > 0 ? formatCurrency(r.credit, currency) : '—'}
                      </td>
                      <td className="py-2.5 px-5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        {formatCurrency(r.runningBalance, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'trial-balance' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Trial Balance
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Reconciliation across Cash Ledger, Income Accounts, and Expense Accounts
              </p>
            </div>
            <span className={`text-xs font-semibold ${trialBalance.isBalanced ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {trialBalance.isBalanced ? 'Balanced (Debits = Credits)' : 'Variance'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-3 px-5">Code</th>
                  <th className="py-3 px-4">Account Name</th>
                  <th className="py-3 px-4">Group</th>
                  <th className="py-3 px-4 text-right">Entries</th>
                  <th className="py-3 px-4 text-right">Debit</th>
                  <th className="py-3 px-5 text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                {trialBalance.rows.map((r) => (
                  <tr key={r.accountCode} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-5 font-mono text-slate-500 dark:text-slate-400">{r.accountCode}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-white">{r.accountName}</td>
                    <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">{r.accountGroup}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">{r.entryCount}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                      {r.debit > 0 ? formatCurrency(r.debit, currency) : '—'}
                    </td>
                    <td className="py-2.5 px-5 text-right font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                      {r.credit > 0 ? formatCurrency(r.credit, currency) : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 dark:bg-slate-950/60 font-semibold">
                  <td className="py-3 px-5 font-mono text-slate-900 dark:text-white">TOTAL</td>
                  <td className="py-3 px-4 text-slate-900 dark:text-white" colSpan={3}>
                    General Ledger Totals
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                    {formatCurrency(trialBalance.totalDebits, currency)}
                  </td>
                  <td className="py-3 px-5 text-right font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                    {formatCurrency(trialBalance.totalCredits, currency)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'ar-ap' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Accounts Receivable, Payables, Loans &amp; Bills Aging Register
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {arApSchedule.length} tracked obligation and recovery records sorted by overdue aging
            </p>
          </div>
          {arApSchedule.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No loans, receivables, payables, or bills recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4">Ref</th>
                    <th className="py-3 px-4">Direction</th>
                    <th className="py-3 px-4">Party / Provider</th>
                    <th className="py-3 px-4">Title</th>
                    <th className="py-3 px-4">Due Date</th>
                    <th className="py-3 px-4 text-right">Total</th>
                    <th className="py-3 px-4 text-right">Remaining</th>
                    <th className="py-3 px-5">Aging Bucket</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                  {arApSchedule.map((r) => (
                    <tr key={r.refCode} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono text-slate-500 dark:text-slate-400">{r.refCode}</td>
                      <td className={`py-2.5 px-4 font-semibold ${r.direction === 'Receivable' ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`}>
                        {r.direction}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700 dark:text-slate-200">{r.partyOrProvider}</td>
                      <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-white">{r.title}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">{formatReadableDate(r.dueDate)}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatCurrency(r.totalAmount, currency)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        {formatCurrency(r.remainingAmount, currency)}
                      </td>
                      <td className={`py-2.5 px-5 whitespace-nowrap font-medium ${r.daysOverdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-400'}`}>
                        {r.agingBucket}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'savings' && (
        <ChartCard title="Savings Goals Progress Report" subtitle="Saved vs remaining amounts per goal">
          {savingsChartData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-xs text-slate-500">
              No savings goals created yet.
            </div>
          ) : (
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={savingsChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(Number(v), currency, true)} />
                  <Tooltip formatter={(val) => formatCurrency(Number(val ?? 0), currency)} contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '12px' }} />
                  <Bar dataKey="saved" stackId="a" name="Saved" fill="#16A34A" />
                  <Bar dataKey="remaining" stackId="a" name="Remaining" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      )}

      {activeTab === 'cash-flow' && (
        <ChartCard title="12-Month Cash Flow Report" subtitle="Inflows vs outflows area comparison">
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatCurrency(Number(v), currency, true)} />
                <Tooltip formatter={(val) => formatCurrency(Number(val ?? 0), currency)} contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '12px' }} />
                <Area type="monotone" dataKey="income" name="Inflow" stroke="#16A34A" fill="#16A34A" fillOpacity={0.18} strokeWidth={2} />
                <Area type="monotone" dataKey="expenses" name="Outflow" stroke="#2563EB" fill="#2563EB" fillOpacity={0.14} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      )}
    </div>
  );
}

function MetricBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div
        className={`text-xl font-bold font-mono tabular-nums mt-1 ${
          tone === 'positive'
            ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'negative'
            ? 'text-red-600 dark:text-red-400'
            : 'text-slate-900 dark:text-white'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function CategoryPieChart({
  data,
  currency,
}: {
  data: { category: string; amount: number; percentage: number }[];
  currency: ReturnType<typeof useFinance>['currency'];
}) {
  if (data.length === 0) {
    return (
      <div className="h-72 flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
        No data recorded for this period.
      </div>
    );
  }
  return (
    <div className="grid sm:grid-cols-2 items-center gap-4">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="amount" nameKey="category" cx="50%" cy="50%" innerRadius={48} outerRadius={80} paddingAngle={2}>
              {data.map((_, idx) => (
                <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(val) => formatCurrency(Number(val ?? 0), currency)} contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc', fontSize: '12px' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {data.map((d, idx) => (
          <div key={d.category} className="flex items-center justify-between text-xs gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-xs shrink-0" style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
              <span className="truncate text-slate-700 dark:text-slate-300">{d.category}</span>
            </div>
            <span className="font-mono tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
              {formatCurrency(d.amount, currency)} ({d.percentage.toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
