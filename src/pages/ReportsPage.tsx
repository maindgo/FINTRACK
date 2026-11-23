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
import { Download } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { CHART_COLORS } from '../utils/constants';
import {
  formatCurrency,
  formatCurrencyAscii,
  formatMonthLabel,
  getCurrentMonthStr,
  getTodayStr,
} from '../utils/formatters';
import { aggregateByCategory, buildMonthlySeries } from '../utils/analytics';
import {
  exportGenericReportToPDF,
  exportTransactionsToCSV,
  exportTransactionsToExcel,
} from '../utils/exporters';

type ReportTab =
  | 'monthly'
  | 'yearly'
  | 'income'
  | 'expense'
  | 'profit-loss'
  | 'savings'
  | 'category-expense'
  | 'cash-flow';

const REPORT_TABS: { id: ReportTab; label: string }[] = [
  { id: 'monthly', label: 'Monthly Financial' },
  { id: 'yearly', label: 'Yearly Financial' },
  { id: 'income', label: 'Income Report' },
  { id: 'expense', label: 'Expense Report' },
  { id: 'profit-loss', label: 'Profit / Loss' },
  { id: 'savings', label: 'Savings Report' },
  { id: 'category-expense', label: 'Category-wise Expense' },
  { id: 'cash-flow', label: 'Cash Flow' },
];

export function ReportsPage() {
  const { transactions, savingsGoals, currency } = useFinance();
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
    const months = Array.from({ length: 12 }, (_, idx) => {
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
    return months;
  }, [transactions, selectedYear]);

  const monthlySeries = useMemo(() => buildMonthlySeries(transactions, 12), [transactions]);
  const incomeCats = useMemo(() => aggregateByCategory(scopedTransactions, 'income'), [scopedTransactions]);
  const expenseCats = useMemo(() => aggregateByCategory(scopedTransactions, 'expense'), [scopedTransactions]);

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

  const handleExportPDF = () => {
    const title = REPORT_TABS.find((t) => t.id === activeTab)?.label + ' Report';
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
            Reports &amp; Analytics
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Interactive financial reports built from your live transaction, budget, and savings data.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button
            type="button"
            onClick={() => exportTransactionsToExcel(scopedTransactions, currency, `fintrack-${activeTab}`)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90"
          >
            <Download className="w-3.5 h-3.5" />
            PDF
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
        <ChartCard title="12-Month Net Profit & Loss" subtitle="Monthly surplus and deficit performance">
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
