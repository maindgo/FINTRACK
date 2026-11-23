import {
  BillRecord,
  BudgetRecord,
  CurrencyCode,
  DebtRecord,
  SavingsGoal,
  TransactionRecord,
} from '../types/finance';
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
