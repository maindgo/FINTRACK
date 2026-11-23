import React, { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { formatCurrency } from '../utils/formatters';
import { aggregateByCategory, buildMonthlySeries, computeProfitLoss } from '../utils/analytics';

export function ProfitLossPage() {
  const { transactions, currency } = useFinance();

  const pl = useMemo(() => computeProfitLoss(transactions), [transactions]);
  const monthlySeries = useMemo(() => buildMonthlySeries(transactions, 12), [transactions]);
  const incomeCats = useMemo(() => aggregateByCategory(transactions, 'income'), [transactions]);
  const expenseCats = useMemo(() => aggregateByCategory(transactions, 'expense'), [transactions]);

  const allTimeIncome = transactions
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const allTimeExpenses = transactions
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);
  const allTimeNet = allTimeIncome - allTimeExpenses;

  const formatGrowth = (pct: number | null) => {
    if (pct === null) return 'No prior month baseline';
    const sign = pct > 0 ? '+' : '';
    return `${sign}${pct.toFixed(1)}% vs last month`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Profit &amp; Loss Calculator
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Net Profit = Total Income − Total Expenses across daily, monthly, and yearly horizons.
        </p>
      </div>

      {/* Period P&L Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <PLCard
          title="Daily Profit / Loss"
          income={pl.dailyIncome}
          expenses={pl.dailyExpenses}
          net={pl.dailyProfit}
          currency={currency}
          footnote="Today's ledger"
        />
        <PLCard
          title="Monthly Profit / Loss"
          income={pl.monthlyIncome}
          expenses={pl.monthlyExpenses}
          net={pl.monthlyProfit}
          currency={currency}
          footnote={formatGrowth(pl.profitGrowthPct)}
        />
        <PLCard
          title="Yearly Profit / Loss"
          income={pl.yearlyIncome}
          expenses={pl.yearlyExpenses}
          net={pl.yearlyProfit}
          currency={currency}
          footnote="Current calendar year"
        />
        <PLCard
          title="All-Time Net P&L"
          income={allTimeIncome}
          expenses={allTimeExpenses}
          net={allTimeNet}
          currency={currency}
          footnote={`${transactions.length} total entries`}
        />
      </div>

      {/* Growth Metrics Strip */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Profit Growth (MoM)</div>
            <div
              className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                pl.profitGrowthPct === null
                  ? 'text-slate-600 dark:text-slate-300'
                  : pl.profitGrowthPct >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {pl.profitGrowthPct === null
                ? 'N/A'
                : `${pl.profitGrowthPct >= 0 ? '+' : ''}${pl.profitGrowthPct.toFixed(1)}%`}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Last month: {formatCurrency(pl.prevMonthProfit, currency)}
            </div>
          </div>
          {pl.profitGrowthPct !== null && pl.profitGrowthPct >= 0 ? (
            <TrendingUp className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <TrendingDown className="w-6 h-6 text-slate-400" />
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Expense Growth (MoM)</div>
            <div
              className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                pl.expenseGrowthPct === null
                  ? 'text-slate-600 dark:text-slate-300'
                  : pl.expenseGrowthPct <= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {pl.expenseGrowthPct === null
                ? 'N/A'
                : `${pl.expenseGrowthPct >= 0 ? '+' : ''}${pl.expenseGrowthPct.toFixed(1)}%`}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Last month: {formatCurrency(pl.prevMonthExpenses, currency)}
            </div>
          </div>
          <ArrowUpRight className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Income Growth (MoM)</div>
            <div
              className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                pl.incomeGrowthPct === null
                  ? 'text-slate-600 dark:text-slate-300'
                  : pl.incomeGrowthPct >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {pl.incomeGrowthPct === null
                ? 'N/A'
                : `${pl.incomeGrowthPct >= 0 ? '+' : ''}${pl.incomeGrowthPct.toFixed(1)}%`}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Last month: {formatCurrency(pl.prevMonthIncome, currency)}
            </div>
          </div>
          <ArrowDownRight className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Income vs Expenses (12 Months)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Side-by-side monthly cash inflows and outflows
            </p>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
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
              Net Profit / Loss Trajectory
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Monthly net surplus or deficit curve
            </p>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
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
                <Line
                  type="monotone"
                  dataKey="profit"
                  name="Net Profit/Loss"
                  stroke="#16A34A"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Category Ledger Summary */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Income Sources Breakdown
          </h3>
          {incomeCats.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4">No income recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {incomeCats.map((c) => (
                <div key={c.category} className="py-2.5 flex items-center justify-between">
                  <span className="text-slate-700 dark:text-slate-300">
                    {c.category} · {c.count} entr{c.count === 1 ? 'y' : 'ies'}
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(c.amount, currency)} ({c.percentage.toFixed(1)}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Expense Categories Breakdown
          </h3>
          {expenseCats.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4">No expenses recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {expenseCats.map((c) => (
                <div key={c.category} className="py-2.5 flex items-center justify-between">
                  <span className="text-slate-700 dark:text-slate-300">
                    {c.category} · {c.count} entr{c.count === 1 ? 'y' : 'ies'}
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                    {formatCurrency(c.amount, currency)} ({c.percentage.toFixed(1)}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PLCard({
  title,
  income,
  expenses,
  net,
  currency,
  footnote,
}: {
  title: string;
  income: number;
  expenses: number;
  net: number;
  currency: ReturnType<typeof useFinance>['currency'];
  footnote: string;
}) {
  const isPositive = net >= 0;
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{title}</span>
        <span
          className={`text-xs font-semibold ${
            isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {isPositive ? 'Surplus' : 'Deficit'}
        </span>
      </div>
      <div
        className={`text-2xl font-bold font-mono tabular-nums ${
          isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
        }`}
      >
        {isPositive ? '+' : ''}
        {formatCurrency(net, currency)}
      </div>
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
        <span>In: {formatCurrency(income, currency)}</span>
        <span>Out: {formatCurrency(expenses, currency)}</span>
      </div>
      <div className="text-[11px] text-slate-400">{footnote}</div>
    </div>
  );
}
