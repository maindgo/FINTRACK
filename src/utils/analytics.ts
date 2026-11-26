import {
  BillRecord,
  BudgetRecord,
  CurrencyCode,
  DebtRecord,
  RecordPayment,
  RecurringTransaction,
  SavingsGoal,
  TransactionRecord,
} from '../types/finance';
import { isCashPaymentMethod } from './constants';
import {
  formatCurrency,
  getCurrentMonthStr,
  getPreviousMonthStr,
  getTodayStr,
} from './formatters';

export interface ProfitLossSummary {
  dailyIncome: number;
  dailyExpenses: number;
  dailyProfit: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyProfit: number;
  prevMonthIncome: number;
  prevMonthExpenses: number;
  prevMonthProfit: number;
  yearlyIncome: number;
  yearlyExpenses: number;
  yearlyProfit: number;
  profitGrowthPct: number | null;
  expenseGrowthPct: number | null;
  incomeGrowthPct: number | null;
}

export function computeProfitLoss(transactions: TransactionRecord[]): ProfitLossSummary {
  const today = getTodayStr();
  const currentMonth = getCurrentMonthStr();
  const prevMonth = getPreviousMonthStr(currentMonth);
  const currentYear = today.slice(0, 4);

  let dailyIncome = 0;
  let dailyExpenses = 0;
  let monthlyIncome = 0;
  let monthlyExpenses = 0;
  let prevMonthIncome = 0;
  let prevMonthExpenses = 0;
  let yearlyIncome = 0;
  let yearlyExpenses = 0;

  for (const t of transactions) {
    if (t.date === today) {
      if (t.type === 'income') dailyIncome += t.amount;
      else dailyExpenses += t.amount;
    }
    if (t.date.startsWith(currentMonth)) {
      if (t.type === 'income') monthlyIncome += t.amount;
      else monthlyExpenses += t.amount;
    }
    if (t.date.startsWith(prevMonth)) {
      if (t.type === 'income') prevMonthIncome += t.amount;
      else prevMonthExpenses += t.amount;
    }
    if (t.date.startsWith(currentYear)) {
      if (t.type === 'income') yearlyIncome += t.amount;
      else yearlyExpenses += t.amount;
    }
  }

  const dailyProfit = dailyIncome - dailyExpenses;
  const monthlyProfit = monthlyIncome - monthlyExpenses;
  const prevMonthProfit = prevMonthIncome - prevMonthExpenses;
  const yearlyProfit = yearlyIncome - yearlyExpenses;

  const profitGrowthPct =
    prevMonthProfit !== 0
      ? ((monthlyProfit - prevMonthProfit) / Math.abs(prevMonthProfit)) * 100
      : null;

  const expenseGrowthPct =
    prevMonthExpenses > 0
      ? ((monthlyExpenses - prevMonthExpenses) / prevMonthExpenses) * 100
      : null;

  const incomeGrowthPct =
    prevMonthIncome > 0
      ? ((monthlyIncome - prevMonthIncome) / prevMonthIncome) * 100
      : null;

  return {
    dailyIncome,
    dailyExpenses,
    dailyProfit,
    monthlyIncome,
    monthlyExpenses,
    monthlyProfit,
    prevMonthIncome,
    prevMonthExpenses,
    prevMonthProfit,
    yearlyIncome,
    yearlyExpenses,
    yearlyProfit,
    profitGrowthPct,
    expenseGrowthPct,
    incomeGrowthPct,
  };
}

export interface CategoryAggregate {
  category: string;
  amount: number;
  percentage: number;
  count: number;
}

export function aggregateByCategory(
  transactions: TransactionRecord[],
  type: 'income' | 'expense'
): CategoryAggregate[] {
  const map = new Map<string, { amount: number; count: number }>();
  let total = 0;

  for (const t of transactions) {
    if (t.type !== type) continue;
    total += t.amount;
    const curr = map.get(t.category) || { amount: 0, count: 0 };
    map.set(t.category, { amount: curr.amount + t.amount, count: curr.count + 1 });
  }

  return Array.from(map.entries())
    .map(([category, data]) => ({
      category,
      amount: data.amount,
      count: data.count,
      percentage: total > 0 ? (data.amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export interface MonthlyCashFlowPoint {
  month: string;
  label: string;
  income: number;
  expenses: number;
  profit: number;
}

export function buildMonthlySeries(
  transactions: TransactionRecord[],
  monthsCount = 6
): MonthlyCashFlowPoint[] {
  const now = new Date();
  const points: MonthlyCashFlowPoint[] = [];

  for (let i = monthsCount - 1; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    const label = dt.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    let income = 0;
    let expenses = 0;

    for (const t of transactions) {
      if (t.date.startsWith(monthKey)) {
        if (t.type === 'income') income += t.amount;
        else expenses += t.amount;
      }
    }
    points.push({
      month: monthKey,
      label,
      income,
      expenses,
      profit: income - expenses,
    });
  }
  return points;
}

export interface MonthComparisonPoint {
  day: number;
  label: string;
  currentDaily: number | null;
  previousDaily: number;
  currentCumulative: number | null;
  previousCumulative: number;
}

export interface MonthSpendingComparison {
  currentMonthLabel: string;
  previousMonthLabel: string;
  currentTotal: number;
  previousSameDayTotal: number;
  previousFullTotal: number;
  paceDiffPct: number | null;
  points: MonthComparisonPoint[];
}

export function buildMonthSpendingComparison(
  transactions: TransactionRecord[]
): MonthSpendingComparison {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = now.getMonth();
  const currentDayOfMonth = now.getDate();

  const currentMonthKey = `${currentYear}-${String(currentMonthIdx + 1).padStart(2, '0')}`;
  const prevDate = new Date(currentYear, currentMonthIdx - 1, 1);
  const prevYear = prevDate.getFullYear();
  const prevMonthIdx = prevDate.getMonth();
  const prevMonthKey = `${prevYear}-${String(prevMonthIdx + 1).padStart(2, '0')}`;

  const daysInCurrent = new Date(currentYear, currentMonthIdx + 1, 0).getDate();
  const daysInPrev = new Date(prevYear, prevMonthIdx + 1, 0).getDate();
  const totalDays = Math.max(daysInCurrent, daysInPrev);

  const currByDay = new Array<number>(totalDays + 1).fill(0);
  const prevByDay = new Array<number>(totalDays + 1).fill(0);

  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    if (t.date.startsWith(currentMonthKey)) {
      const d = Number(t.date.slice(8, 10));
      if (d >= 1 && d <= totalDays) currByDay[d] += t.amount;
    } else if (t.date.startsWith(prevMonthKey)) {
      const d = Number(t.date.slice(8, 10));
      if (d >= 1 && d <= totalDays) prevByDay[d] += t.amount;
    }
  }

  const points: MonthComparisonPoint[] = [];
  let currCum = 0;
  let prevCum = 0;
  let previousSameDayTotal = 0;

  for (let day = 1; day <= totalDays; day++) {
    prevCum += prevByDay[day];
    if (day <= currentDayOfMonth) {
      currCum += currByDay[day];
      previousSameDayTotal = prevCum;
    }

    points.push({
      day,
      label: `Day ${day}`,
      currentDaily: day <= currentDayOfMonth ? Number(currByDay[day].toFixed(2)) : null,
      previousDaily: Number(prevByDay[day].toFixed(2)),
      currentCumulative: day <= currentDayOfMonth ? Number(currCum.toFixed(2)) : null,
      previousCumulative: Number(prevCum.toFixed(2)),
    });
  }

  const paceDiffPct =
    previousSameDayTotal > 0
      ? ((currCum - previousSameDayTotal) / previousSameDayTotal) * 100
      : null;

  return {
    currentMonthLabel: now.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
    previousMonthLabel: prevDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
    currentTotal: currCum,
    previousSameDayTotal,
    previousFullTotal: prevCum,
    paceDiffPct,
    points,
  };
}

export interface SmartInsightsData {
  highestSpendingCategory: CategoryAggregate | null;
  biggestExpense: TransactionRecord | null;
  monthlySavingsRate: number | null;
  incomeGrowthPct: number | null;
  expenseGrowthPct: number | null;
  unusualExpenses: TransactionRecord[];
  categorySpikes: { category: string; current: number; previous: number; changePct: number }[];
  budgetPerformance: {
    totalBudgets: number;
    withinLimit: number;
    warningCount: number;
    exceededCount: number;
  };
  suggestions: {
    id: string;
    severity: 'positive' | 'warning' | 'critical' | 'info';
    title: string;
    detail: string;
  }[];
}

export function computeSmartInsights(
  transactions: TransactionRecord[],
  budgets: BudgetRecord[],
  bills: BillRecord[],
  debts: DebtRecord[],
  savingsGoals: SavingsGoal[],
  overallMonthlyLimit: number,
  currency: CurrencyCode
): SmartInsightsData {
  const currentMonth = getCurrentMonthStr();
  const prevMonth = getPreviousMonthStr(currentMonth);
  const today = getTodayStr();

  const currentMonthTx = transactions.filter((t) => t.date.startsWith(currentMonth));
  const prevMonthTx = transactions.filter((t) => t.date.startsWith(prevMonth));

  const currentMonthExpenses = currentMonthTx.filter((t) => t.type === 'expense');
  const currentMonthIncome = currentMonthTx
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const currentMonthExpenseSum = currentMonthExpenses.reduce((s, t) => s + t.amount, 0);

  const prevMonthIncome = prevMonthTx
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const prevMonthExpenseSum = prevMonthTx
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  const allTimeCatAgg = aggregateByCategory(
    currentMonthExpenses.length > 0 ? currentMonthExpenses : transactions.filter((t) => t.type === 'expense'),
    'expense'
  );
  const highestSpendingCategory = allTimeCatAgg[0] || null;

  const expensePool = currentMonthExpenses.length > 0
    ? currentMonthExpenses
    : transactions.filter((t) => t.type === 'expense');
  const biggestExpense =
    expensePool.length > 0
      ? [...expensePool].sort((a, b) => b.amount - a.amount)[0]
      : null;

  const monthlySavingsRate =
    currentMonthIncome > 0
      ? ((currentMonthIncome - currentMonthExpenseSum) / currentMonthIncome) * 100
      : null;

  const incomeGrowthPct =
    prevMonthIncome > 0
      ? ((currentMonthIncome - prevMonthIncome) / prevMonthIncome) * 100
      : null;

  const expenseGrowthPct =
    prevMonthExpenseSum > 0
      ? ((currentMonthExpenseSum - prevMonthExpenseSum) / prevMonthExpenseSum) * 100
      : null;

  // Unusual spending: single expenses >= 2x average expense (minimum 3 expenses needed)
  const allExpenses = transactions.filter((t) => t.type === 'expense');
  const avgExpense =
    allExpenses.length > 0
      ? allExpenses.reduce((s, t) => s + t.amount, 0) / allExpenses.length
      : 0;
  const unusualExpenses =
    allExpenses.length >= 3
      ? currentMonthExpenses
          .filter((t) => t.amount >= avgExpense * 2)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5)
      : [];

  // Category spikes comparing current month vs previous month
  const currCatMap = new Map<string, number>();
  const prevCatMap = new Map<string, number>();
  currentMonthExpenses.forEach((t) => currCatMap.set(t.category, (currCatMap.get(t.category) || 0) + t.amount));
  prevMonthTx
    .filter((t) => t.type === 'expense')
    .forEach((t) => prevCatMap.set(t.category, (prevCatMap.get(t.category) || 0) + t.amount));

  const categorySpikes: { category: string; current: number; previous: number; changePct: number }[] = [];
  currCatMap.forEach((currVal, cat) => {
    const prevVal = prevCatMap.get(cat) || 0;
    if (prevVal > 0) {
      const changePct = ((currVal - prevVal) / prevVal) * 100;
      if (changePct >= 25) {
        categorySpikes.push({ category: cat, current: currVal, previous: prevVal, changePct });
      }
    }
  });
  categorySpikes.sort((a, b) => b.changePct - a.changePct);

  // Budget performance for current month
  const currentMonthBudgets = budgets.filter((b) => b.month === currentMonth);
  let withinLimit = 0;
  let warningCount = 0;
  let exceededCount = 0;

  currentMonthBudgets.forEach((b) => {
    const spent =
      b.category === 'Monthly Overall'
        ? currentMonthExpenseSum
        : currCatMap.get(b.category) || 0;
    const pct = (spent / b.limitAmount) * 100;
    if (pct > 100) exceededCount++;
    else if (pct >= b.alertThreshold) warningCount++;
    else withinLimit++;
  });

  // Build grounded, non-investment suggestions
  const suggestions: SmartInsightsData['suggestions'] = [];

  if (transactions.length === 0) {
    suggestions.push({
      id: 'start-logging',
      severity: 'info',
      title: 'Start logging your income and expenses',
      detail: 'Add your first few transactions to unlock category concentration metrics, anomaly alerts, and monthly cash flow trends.',
    });
  } else {
    if (monthlySavingsRate !== null) {
      if (monthlySavingsRate < 10) {
        suggestions.push({
          id: 'low-savings-rate',
          severity: 'warning',
          title: `Monthly savings rate is ${monthlySavingsRate.toFixed(1)}%`,
          detail: `Your expenses (${formatCurrency(currentMonthExpenseSum, currency)}) are consuming most of this month's income (${formatCurrency(currentMonthIncome, currency)}). Review discretionary categories to widen your cash buffer.`,
        });
      } else if (monthlySavingsRate >= 25) {
        suggestions.push({
          id: 'healthy-savings-rate',
          severity: 'positive',
          title: `Strong monthly savings rate of ${monthlySavingsRate.toFixed(1)}%`,
          detail: `You have retained ${formatCurrency(currentMonthIncome - currentMonthExpenseSum, currency)} so far this month. Consider allocating part of this surplus toward your active savings goals.`,
        });
      }
    }

    if (highestSpendingCategory && highestSpendingCategory.percentage >= 35) {
      suggestions.push({
        id: 'cat-concentration',
        severity: 'info',
        title: `${highestSpendingCategory.category} accounts for ${highestSpendingCategory.percentage.toFixed(1)}% of spending`,
        detail: `You spent ${formatCurrency(highestSpendingCategory.amount, currency)} on ${highestSpendingCategory.category}. Setting a dedicated monthly category budget can help keep this category predictable.`,
      });
    }

    if (exceededCount > 0) {
      suggestions.push({
        id: 'budget-exceeded',
        severity: 'critical',
        title: `${exceededCount} category budget${exceededCount > 1 ? 's' : ''} exceeded this month`,
        detail: 'Check your Budgets page to inspect overspent categories and adjust remaining monthly discretionary limits.',
      });
    }

    if (overallMonthlyLimit > 0 && currentMonthExpenseSum > overallMonthlyLimit) {
      suggestions.push({
        id: 'overall-limit-exceeded',
        severity: 'critical',
        title: 'Overall monthly spending limit exceeded',
        detail: `Current month expenses of ${formatCurrency(currentMonthExpenseSum, currency)} exceed your ${formatCurrency(overallMonthlyLimit, currency)} monthly cap.`,
      });
    }

    const overdueBills = bills.filter(
      (b) => b.status !== 'paid' && (b.status === 'overdue' || b.dueDate < today)
    );
    if (overdueBills.length > 0) {
      const totalOverdue = overdueBills.reduce((s, b) => s + Math.max(0, b.amount - b.paidAmount), 0);
      suggestions.push({
        id: 'overdue-bills',
        severity: 'critical',
        title: `${overdueBills.length} overdue bill${overdueBills.length > 1 ? 's' : ''} or EMI${overdueBills.length > 1 ? 's' : ''}`,
        detail: `Total overdue amount is ${formatCurrency(totalOverdue, currency)}. Settling these promptly helps avoid late fees.`,
      });
    }

    const overdueDebts = debts.filter(
      (d) =>
        (d.recordType === 'borrowed' || d.recordType === 'payable' || d.recordType === 'loan') &&
        d.status !== 'paid' &&
        d.dueDate < today
    );
    if (overdueDebts.length > 0) {
      suggestions.push({
        id: 'overdue-debts',
        severity: 'warning',
        title: `${overdueDebts.length} overdue payable or loan obligation${overdueDebts.length > 1 ? 's' : ''}`,
        detail: 'Review your Loans & Debts ledger to schedule repayments or record partial settlements.',
      });
    }

    if (unusualExpenses.length > 0) {
      suggestions.push({
        id: 'unusual-spend',
        severity: 'warning',
        title: `${unusualExpenses.length} unusually large expense${unusualExpenses.length > 1 ? 's' : ''} detected`,
        detail: `Your highest spike this month was "${unusualExpenses[0].title}" at ${formatCurrency(unusualExpenses[0].amount, currency)}, which is more than double your typical transaction average.`,
      });
    }

    const activeGoals = savingsGoals.filter((g) => g.status === 'active');
    if (activeGoals.length === 0 && currentMonthIncome > currentMonthExpenseSum) {
      suggestions.push({
        id: 'create-savings-goal',
        severity: 'info',
        title: 'Set up an emergency fund or target savings goal',
        detail: 'Create a dedicated savings goal in the Savings section to track progress toward an emergency reserve or planned milestone.',
      });
    }
  }

  return {
    highestSpendingCategory,
    biggestExpense,
    monthlySavingsRate,
    incomeGrowthPct,
    expenseGrowthPct,
    unusualExpenses,
    categorySpikes,
    budgetPerformance: {
      totalBudgets: currentMonthBudgets.length,
      withinLimit,
      warningCount,
      exceededCount,
    },
    suggestions,
  };
}

export interface MonthlyExpenseForecast {
  nextMonthLabel: string;
  estimatedExpense: number;
  rangeLow: number;
  rangeHigh: number;
  lastMonthExpense: number;
  currentMonthProjected: number;
  scheduledCommitments: number;
  deltaVsLastMonthPct: number | null;
  confidence: 'High' | 'Medium' | 'Building';
  historyMonthsUsed: number;
  topCategories: {
    category: string;
    projectedAmount: number;
    sharePct: number;
  }[];
  methodologyNote: string;
}

export function computeMonthlyExpenseForecast(
  transactions: TransactionRecord[],
  recurringTransactions: RecurringTransaction[],
  bills: BillRecord[]
): MonthlyExpenseForecast {
  const now = new Date();
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthLabel = nextMonthDate.toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
  });
  const nextMonthKey = `${nextMonthDate.getFullYear()}-${String(
    nextMonthDate.getMonth() + 1
  ).padStart(2, '0')}`;

  const currentMonthKey = getCurrentMonthStr();
  const prevMonthKey = getPreviousMonthStr(currentMonthKey);
  const daysInCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const currentDay = Math.max(1, now.getDate());

  const expenses = transactions.filter((t) => t.type === 'expense');

  // Group expenses by YYYY-MM
  const monthTotals = new Map<string, number>();
  for (const tx of expenses) {
    const mk = tx.date.slice(0, 7);
    monthTotals.set(mk, (monthTotals.get(mk) || 0) + tx.amount);
  }

  const currentMonthSpent = monthTotals.get(currentMonthKey) || 0;
  const lastMonthExpense = monthTotals.get(prevMonthKey) || 0;

  // Collect up to 6 completed prior months that have data
  const priorMonthKeys: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mk = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    if ((monthTotals.get(mk) || 0) > 0) {
      priorMonthKeys.push(mk);
    }
  }

  // Current month run-rate projection
  const currentMonthProjected =
    currentMonthSpent > 0
      ? currentDay >= 4
        ? (currentMonthSpent / currentDay) * daysInCurrentMonth
        : currentMonthSpent
      : 0;

  // Weighted moving average across prior months (recent months weighted higher)
  const weights = [3.0, 2.2, 1.6, 1.2, 1.0, 0.8];
  let weightedSum = 0;
  let totalWeight = 0;
  priorMonthKeys.forEach((mk, idx) => {
    const val = monthTotals.get(mk) || 0;
    const w = weights[idx] ?? 1;
    weightedSum += val * w;
    totalWeight += w;
  });

  const historicalWeightedAvg = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Scheduled recurring expenses & active monthly/next-month bills
  const recurringMonthlyEquivalent = recurringTransactions
    .filter((r) => r.isActive && r.type === 'expense')
    .reduce((sum, r) => {
      if (r.frequency === 'daily') return sum + r.amount * 30;
      if (r.frequency === 'weekly') return sum + r.amount * 4.33;
      if (r.frequency === 'monthly') return sum + r.amount;
      if (r.frequency === 'yearly') return sum + r.amount / 12;
      return sum;
    }, 0);

  const upcomingBillsTotal = bills
    .filter((b) => {
      if (b.frequency === 'monthly') return true;
      if (b.frequency === 'one_time' && b.status !== 'paid' && b.dueDate.startsWith(nextMonthKey)) {
        return true;
      }
      return false;
    })
    .reduce((sum, b) => sum + b.amount, 0);

  const scheduledCommitments = Number((recurringMonthlyEquivalent + upcomingBillsTotal).toFixed(2));

  // Blend historical weighted average with current-month pace (if mid/late month)
  let baseEstimate = 0;
  if (historicalWeightedAvg > 0 && currentMonthProjected > 0 && currentDay >= 7) {
    const paceWeight = Math.min(0.45, currentDay / daysInCurrentMonth / 2);
    baseEstimate = historicalWeightedAvg * (1 - paceWeight) + currentMonthProjected * paceWeight;
  } else if (historicalWeightedAvg > 0) {
    baseEstimate = historicalWeightedAvg;
  } else if (currentMonthProjected > 0) {
    baseEstimate = currentMonthProjected;
  }

  const estimatedExpense = Math.max(
    Number(baseEstimate.toFixed(2)),
    Number(scheduledCommitments.toFixed(2))
  );

  // Variability / confidence band
  const historyValues = priorMonthKeys.map((mk) => monthTotals.get(mk) || 0);
  if (currentMonthProjected > 0 && currentDay >= 10) {
    historyValues.push(currentMonthProjected);
  }
  let spreadRatio = 0.12;
  if (historyValues.length >= 2 && estimatedExpense > 0) {
    const mean = historyValues.reduce((s, v) => s + v, 0) / historyValues.length;
    const variance =
      historyValues.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / historyValues.length;
    const stdDev = Math.sqrt(variance);
    spreadRatio = Math.min(0.3, Math.max(0.07, stdDev / Math.max(mean, 1)));
  }

  const rangeLow = Math.max(scheduledCommitments, Number((estimatedExpense * (1 - spreadRatio)).toFixed(2)));
  const rangeHigh = Number((estimatedExpense * (1 + spreadRatio)).toFixed(2));

  const baselineForDelta = lastMonthExpense > 0 ? lastMonthExpense : historicalWeightedAvg;
  const deltaVsLastMonthPct =
    baselineForDelta > 0 && estimatedExpense > 0
      ? ((estimatedExpense - baselineForDelta) / baselineForDelta) * 100
      : null;

  // Project top 3 categories using recent 90-day expense distribution scaled to estimatedExpense
  const recentCutoff = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const cutoffStr = `${recentCutoff.getFullYear()}-${String(recentCutoff.getMonth() + 1).padStart(2, '0')}-01`;
  const recentExpenses = expenses.filter((e) => e.date >= cutoffStr);
  const catPool = recentExpenses.length > 0 ? recentExpenses : expenses;
  const catMap = new Map<string, number>();
  let catPoolSum = 0;
  for (const tx of catPool) {
    catPoolSum += tx.amount;
    catMap.set(tx.category, (catMap.get(tx.category) || 0) + tx.amount);
  }

  const topCategories = Array.from(catMap.entries())
    .map(([category, amt]) => {
      const sharePct = catPoolSum > 0 ? (amt / catPoolSum) * 100 : 0;
      return {
        category,
        projectedAmount: Number(((estimatedExpense * sharePct) / 100).toFixed(2)),
        sharePct,
      };
    })
    .sort((a, b) => b.projectedAmount - a.projectedAmount)
    .slice(0, 3);

  const totalMonthsDetected = priorMonthKeys.length + (currentMonthSpent > 0 ? 1 : 0);
  const confidence: MonthlyExpenseForecast['confidence'] =
    priorMonthKeys.length >= 3 ? 'High' : totalMonthsDetected >= 1 ? 'Medium' : 'Building';

  const methodologyNote =
    priorMonthKeys.length >= 2
      ? `Estimated from ${priorMonthKeys.length} prior month${priorMonthKeys.length > 1 ? 's' : ''}, current month pace, and scheduled commitments.`
      : totalMonthsDetected === 1
      ? 'Estimated from current transaction run-rate and scheduled bills/recurring entries.'
      : scheduledCommitments > 0
      ? 'Based on your active monthly bills and recurring expense commitments.'
      : 'Add expenses across a few weeks to unlock historical trend forecasting.';

  return {
    nextMonthLabel,
    estimatedExpense,
    rangeLow,
    rangeHigh,
    lastMonthExpense,
    currentMonthProjected: Number(currentMonthProjected.toFixed(2)),
    scheduledCommitments,
    deltaVsLastMonthPct,
    confidence,
    historyMonthsUsed: totalMonthsDetected,
    topCategories,
    methodologyNote,
  };
}

export interface SavingsAndCashSummary {
  openingBankBalance: number;
  openingCashBalance: number;
  openingTotal: number;
  allIncome: number;
  allExpenses: number;
  baseCashBalance: number;
  debtRecoveredIn: number;
  debtPaidOut: number;
  netDebtCashImpact: number;
  currentBalance: number;
  goalSavings: number;
  totalSavingRightNow: number;
}

export function computeSavingsAndCashSummary(
  transactions: TransactionRecord[],
  savingsGoals: SavingsGoal[],
  debtRecords: DebtRecord[],
  openingBankBalance = 0,
  openingCashBalance = 0
): SavingsAndCashSummary {
  const safeBankOpen = Math.max(0, Number(openingBankBalance) || 0);
  const safeCashOpen = Math.max(0, Number(openingCashBalance) || 0);
  const openingTotal = safeBankOpen + safeCashOpen;

  const allIncome = transactions
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const allExpenses = transactions
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + t.amount, 0);
  const baseCashBalance = allIncome - allExpenses;

  // Receiving back money previously lent/receivable increases available cash & total saving
  const debtRecoveredIn = debtRecords
    .filter((d) => d.recordType === 'lent' || d.recordType === 'receivable')
    .reduce((s, d) => s + Math.max(0, d.paidAmount), 0);

  // Paying back borrowed money, loans, or payables decreases available cash & total saving
  const debtPaidOut = debtRecords
    .filter(
      (d) =>
        d.recordType === 'borrowed' ||
        d.recordType === 'payable' ||
        d.recordType === 'loan'
    )
    .reduce((s, d) => s + Math.max(0, d.paidAmount), 0);

  const netDebtCashImpact = debtRecoveredIn - debtPaidOut;
  const currentBalance = openingTotal + baseCashBalance + netDebtCashImpact;
  const goalSavings = savingsGoals.reduce((s, g) => s + g.savedAmount, 0);
  const totalSavingRightNow = currentBalance + goalSavings;

  return {
    openingBankBalance: safeBankOpen,
    openingCashBalance: safeCashOpen,
    openingTotal,
    allIncome,
    allExpenses,
    baseCashBalance,
    debtRecoveredIn,
    debtPaidOut,
    netDebtCashImpact,
    currentBalance,
    goalSavings,
    totalSavingRightNow,
  };
}

export interface WalletBalancesSummary {
  openingBankBalance: number;
  openingCashBalance: number;
  bankIncome: number;
  bankExpenses: number;
  bankDebtIn: number;
  bankDebtOut: number;
  bankBalance: number;
  cashIncome: number;
  cashExpenses: number;
  cashDebtIn: number;
  cashDebtOut: number;
  cashBalance: number;
  combinedBalance: number;
}

export function computeWalletBalances(
  transactions: TransactionRecord[],
  debtRecords: DebtRecord[],
  recordPayments: RecordPayment[],
  openingBankBalance = 0,
  openingCashBalance = 0
): WalletBalancesSummary {
  const safeBankOpen = Math.max(0, Number(openingBankBalance) || 0);
  const safeCashOpen = Math.max(0, Number(openingCashBalance) || 0);

  let bankIncome = 0;
  let bankExpenses = 0;
  let cashIncome = 0;
  let cashExpenses = 0;

  for (const t of transactions) {
    if (isCashPaymentMethod(t.paymentMethod)) {
      if (t.type === 'income') cashIncome += t.amount;
      else cashExpenses += t.amount;
    } else {
      if (t.type === 'income') bankIncome += t.amount;
      else bankExpenses += t.amount;
    }
  }

  const debtMap = new Map<string, DebtRecord>();
  let totalRecoveredIn = 0;
  let totalPaidOut = 0;
  for (const d of debtRecords) {
    debtMap.set(d.id, d);
    if (d.recordType === 'lent' || d.recordType === 'receivable') {
      totalRecoveredIn += Math.max(0, d.paidAmount);
    } else {
      totalPaidOut += Math.max(0, d.paidAmount);
    }
  }

  let bankDebtIn = 0;
  let cashDebtIn = 0;
  let bankDebtOut = 0;
  let cashDebtOut = 0;

  for (const p of recordPayments) {
    if (p.parentKind !== 'debt') continue;
    const debt = debtMap.get(p.parentId);
    if (!debt) continue;
    const isReceivable = debt.recordType === 'lent' || debt.recordType === 'receivable';
    const isCash = isCashPaymentMethod(p.method);
    if (isReceivable) {
      if (isCash) cashDebtIn += p.amount;
      else bankDebtIn += p.amount;
    } else {
      if (isCash) cashDebtOut += p.amount;
      else bankDebtOut += p.amount;
    }
  }

  // Attribute any legacy/initial paidAmount without a payment entry to Bank/UPI so combinedBalance matches currentBalance
  const loggedIn = bankDebtIn + cashDebtIn;
  if (totalRecoveredIn > loggedIn) {
    bankDebtIn += totalRecoveredIn - loggedIn;
  }
  const loggedOut = bankDebtOut + cashDebtOut;
  if (totalPaidOut > loggedOut) {
    bankDebtOut += totalPaidOut - loggedOut;
  }

  const bankBalance = safeBankOpen + bankIncome - bankExpenses + bankDebtIn - bankDebtOut;
  const cashBalance = safeCashOpen + cashIncome - cashExpenses + cashDebtIn - cashDebtOut;

  return {
    openingBankBalance: safeBankOpen,
    openingCashBalance: safeCashOpen,
    bankIncome,
    bankExpenses,
    bankDebtIn,
    bankDebtOut,
    bankBalance,
    cashIncome,
    cashExpenses,
    cashDebtIn,
    cashDebtOut,
    cashBalance,
    combinedBalance: bankBalance + cashBalance,
  };
}


