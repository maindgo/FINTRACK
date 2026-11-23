import React, { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Lightbulb,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { formatCurrency, formatReadableDate } from '../utils/formatters';
import { computeSmartInsights } from '../utils/analytics';

export function InsightsPage() {
  const {
    transactions,
    budgets,
    bills,
    debtRecords,
    savingsGoals,
    profile,
    currency,
  } = useFinance();

  const insights = useMemo(
    () =>
      computeSmartInsights(
        transactions,
        budgets,
        bills,
        debtRecords,
        savingsGoals,
        profile?.monthlyBudgetLimit || 0,
        currency
      ),
    [transactions, budgets, bills, debtRecords, savingsGoals, profile, currency]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Smart Financial Insights
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Automated analysis computed directly from your recorded transactions, budgets, and obligations.
        </p>
      </div>

      {/* Key Analytical Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1.5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Highest Spending Category</div>
          {insights.highestSpendingCategory ? (
            <>
              <div className="text-lg font-bold text-slate-900 dark:text-white">
                {insights.highestSpendingCategory.category}
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                {formatCurrency(insights.highestSpendingCategory.amount, currency)} ·{' '}
                {insights.highestSpendingCategory.percentage.toFixed(1)}% share
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-400">No expense data yet</div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1.5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Biggest Single Expense</div>
          {insights.biggestExpense ? (
            <>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {formatCurrency(insights.biggestExpense.amount, currency)}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-300 truncate">
                {insights.biggestExpense.title} · {formatReadableDate(insights.biggestExpense.date)}
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-400">No expense data yet</div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1.5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Monthly Savings Rate</div>
          {insights.monthlySavingsRate !== null ? (
            <>
              <div
                className={`text-lg font-bold font-mono tabular-nums ${
                  insights.monthlySavingsRate >= 20
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : insights.monthlySavingsRate >= 0
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {insights.monthlySavingsRate.toFixed(1)}%
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Current month income retained
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-400">Log this month&apos;s income</div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-1.5">
          <div className="text-xs text-slate-500 dark:text-slate-400">Budget Performance</div>
          {insights.budgetPerformance.totalBudgets > 0 ? (
            <>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {insights.budgetPerformance.withinLimit} / {insights.budgetPerformance.totalBudgets} On Track
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {insights.budgetPerformance.warningCount} warning · {insights.budgetPerformance.exceededCount} exceeded
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-400">No monthly budgets set</div>
          )}
        </div>
      </div>

      {/* Month-over-Month Growth & Category Spikes */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Income Growth &amp; Expense Trends
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                Income Growth
              </div>
              <div className="text-lg font-bold font-mono tabular-nums mt-1 text-slate-900 dark:text-white">
                {insights.incomeGrowthPct === null
                  ? 'N/A'
                  : `${insights.incomeGrowthPct >= 0 ? '+' : ''}${insights.incomeGrowthPct.toFixed(1)}%`}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5 text-blue-600" />
                Expense Trend
              </div>
              <div className="text-lg font-bold font-mono tabular-nums mt-1 text-slate-900 dark:text-white">
                {insights.expenseGrowthPct === null
                  ? 'N/A'
                  : `${insights.expenseGrowthPct >= 0 ? '+' : ''}${insights.expenseGrowthPct.toFixed(1)}%`}
              </div>
            </div>
          </div>

          {insights.categorySpikes.length > 0 && (
            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Categories Trending Upward vs Last Month
              </h4>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {insights.categorySpikes.map((spike) => (
                  <div key={spike.category} className="py-2 flex items-center justify-between">
                    <span className="text-slate-700 dark:text-slate-300">{spike.category}</span>
                    <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400 font-semibold">
                      +{spike.changePct.toFixed(0)}% ({formatCurrency(spike.current, currency)})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Unusual Spending */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Unusual Spending Detection
          </h3>
          {insights.unusualExpenses.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
              No unusually large expenses (above 2× your historical average) detected this month.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {insights.unusualExpenses.map((tx) => (
                <div key={tx.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-white">{tx.title}</div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {tx.category} · {formatReadableDate(tx.date)}
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-semibold text-red-600 dark:text-red-400">
                    {formatCurrency(tx.amount, currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actionable Suggestions */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Data-Driven Recommendations
          </h3>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {insights.suggestions.map((s) => {
            const Icon =
              s.severity === 'critical' || s.severity === 'warning'
                ? AlertTriangle
                : s.severity === 'positive'
                ? CheckCircle2
                : Info;
            const color =
              s.severity === 'critical'
                ? 'text-red-600 dark:text-red-400'
                : s.severity === 'warning'
                ? 'text-amber-600 dark:text-amber-400'
                : s.severity === 'positive'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-blue-600 dark:text-blue-400';

            return (
              <div key={s.id} className="py-3.5 flex items-start gap-3">
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
                <div className="space-y-0.5">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {s.title}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {s.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
