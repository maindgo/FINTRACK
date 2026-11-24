import {
  AIChatMessage,
  BillRecord,
  BudgetRecord,
  GeminiAIInsightsResult,
  RecurringTransaction,
  SanitizedFinancialSnapshot,
  SavingsGoal,
  TransactionRecord,
} from '../types/finance';
import { buildMonthlySeries } from '../utils/analytics';
import {
  formatMonthLabel,
  getCurrentMonthStr,
  getPreviousMonthStr,
  getTodayStr,
} from '../utils/formatters';

export class AIInsightsApiError extends Error {
  status: number;
  code: string;
  retryAfterSeconds?: number;

  constructor(message: string, status: number, code: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'AIInsightsApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface SnapshotInput {
  transactions: TransactionRecord[];
  budgets: BudgetRecord[];
  bills: BillRecord[];
  savingsGoals: SavingsGoal[];
  recurringTransactions: RecurringTransaction[];
  monthlyBudgetLimit: number;
}

export function buildSanitizedFinancialSnapshot({
  transactions,
  budgets,
  bills,
  savingsGoals,
  recurringTransactions,
  monthlyBudgetLimit,
}: SnapshotInput): SanitizedFinancialSnapshot {
  const currentMonth = getCurrentMonthStr();
  const prevMonth = getPreviousMonthStr(currentMonth);
  const today = getTodayStr();

  const currentMonthTx = transactions.filter((t) => t.date.startsWith(currentMonth));
  const prevMonthTx = transactions.filter((t) => t.date.startsWith(prevMonth));

  const income = currentMonthTx
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const currentExpensesList = currentMonthTx.filter((t) => t.type === 'expense');
  const expenses = currentExpensesList.reduce((sum, t) => sum + t.amount, 0);
  const savings = income - expenses;
  const savingsRatePct =
    income > 0 ? Number((((income - expenses) / income) * 100).toFixed(2)) : null;

  const prevIncome = prevMonthTx
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const prevExpensesList = prevMonthTx.filter((t) => t.type === 'expense');
  const prevExpenses = prevExpensesList.reduce((sum, t) => sum + t.amount, 0);
  const prevSavings = prevIncome - prevExpenses;

  const incomeGrowthPct =
    prevIncome > 0 ? Number((((income - prevIncome) / prevIncome) * 100).toFixed(2)) : null;
  const expenseGrowthPct =
    prevExpenses > 0 ? Number((((expenses - prevExpenses) / prevExpenses) * 100).toFixed(2)) : null;

  // Aggregate expense categories across current month, previous month, and all-time
  const categoryMap = new Map<
    string,
    { currentMonth: number; previousMonth: number; allTimeTotal: number; txCount: number }
  >();

  const allExpenses = transactions.filter((t) => t.type === 'expense');
  for (const tx of allExpenses) {
    const entry = categoryMap.get(tx.category) || {
      currentMonth: 0,
      previousMonth: 0,
      allTimeTotal: 0,
      txCount: 0,
    };
    entry.allTimeTotal += tx.amount;
    entry.txCount += 1;
    if (tx.date.startsWith(currentMonth)) {
      entry.currentMonth += tx.amount;
    } else if (tx.date.startsWith(prevMonth)) {
      entry.previousMonth += tx.amount;
    }
    categoryMap.set(tx.category, entry);
  }

  const shareBase = expenses > 0 ? expenses : allExpenses.reduce((s, t) => s + t.amount, 0);

  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([category, vals]) => {
      const shareNumerator = expenses > 0 ? vals.currentMonth : vals.allTimeTotal;
      const sharePct = shareBase > 0 ? Number(((shareNumerator / shareBase) * 100).toFixed(2)) : 0;
      const changePct =
        vals.previousMonth > 0
          ? Number((((vals.currentMonth - vals.previousMonth) / vals.previousMonth) * 100).toFixed(2))
          : null;
      return {
        category,
        currentMonth: Number(vals.currentMonth.toFixed(2)),
        previousMonth: Number(vals.previousMonth.toFixed(2)),
        allTimeTotal: Number(vals.allTimeTotal.toFixed(2)),
        sharePct,
        changePct,
        txCount: vals.txCount,
      };
    })
    .sort((a, b) =>
      expenses > 0 ? b.currentMonth - a.currentMonth : b.allTimeTotal - a.allTimeTotal
    )
    .slice(0, 20);

  // 6-month cash flow series
  const monthlyTrend = buildMonthlySeries(transactions, 6).map((pt) => ({
    monthLabel: pt.label,
    income: Number(pt.income.toFixed(2)),
    expenses: Number(pt.expenses.toFixed(2)),
    savings: Number(pt.profit.toFixed(2)),
  }));

  // Detect unusually high expenses without sending descriptions/notes/PII
  const avgExpense =
    allExpenses.length > 0
      ? allExpenses.reduce((s, t) => s + t.amount, 0) / allExpenses.length
      : 0;
  const unusualSource = currentExpensesList.length > 0 ? currentExpensesList : allExpenses;
  const unusualTransactions =
    allExpenses.length >= 3 && avgExpense > 0
      ? unusualSource
          .filter((t) => t.amount >= avgExpense * 2)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 10)
          .map((t) => ({
            category: t.category,
            amount: Number(t.amount.toFixed(2)),
            date: t.date,
            multipleOfAverage: Number((t.amount / avgExpense).toFixed(2)),
          }))
      : [];

  // Current month budgets
  const currentBudgets = budgets
    .filter((b) => b.month === currentMonth)
    .slice(0, 20)
    .map((b) => {
      const catEntry = categoryMap.get(b.category);
      const spentAmount =
        b.category === 'Monthly Overall' ? expenses : catEntry ? catEntry.currentMonth : 0;
      const utilizationPct =
        b.limitAmount > 0 ? Number(((spentAmount / b.limitAmount) * 100).toFixed(2)) : 0;
      return {
        category: b.category,
        limitAmount: Number(b.limitAmount.toFixed(2)),
        spentAmount: Number(spentAmount.toFixed(2)),
        utilizationPct,
        alertThreshold: Number(b.alertThreshold.toFixed(2)),
      };
    });

  // Savings goals (strip userId & free-text notes)
  const sanitizedGoals = savingsGoals.slice(0, 15).map((g, idx) => ({
    label: g.name.trim() || `Savings Goal ${idx + 1}`,
    category: g.category || 'General Savings',
    targetAmount: Number(g.targetAmount.toFixed(2)),
    savedAmount: Number(g.savedAmount.toFixed(2)),
    remainingAmount: Number(Math.max(0, g.targetAmount - g.savedAmount).toFixed(2)),
    targetDate: g.targetDate || '',
    status: g.status,
  }));

  // Monthly commitments (recurring expenses + active bills/EMIs)
  const monthlyBillsAndEmis = bills
    .filter((b) => b.frequency === 'monthly' || (b.status !== 'paid' && b.dueDate.startsWith(currentMonth)))
    .reduce((sum, b) => sum + b.amount, 0);

  const activeRecurringExpenseMonthly = recurringTransactions
    .filter((r) => r.isActive && r.type === 'expense')
    .reduce((sum, r) => {
      if (r.frequency === 'daily') return sum + r.amount * 30;
      if (r.frequency === 'weekly') return sum + r.amount * 4.33;
      if (r.frequency === 'monthly') return sum + r.amount;
      if (r.frequency === 'yearly') return sum + r.amount / 12;
      return sum;
    }, 0);

  const overdueBillsCount = bills.filter(
    (b) => b.status !== 'paid' && (b.status === 'overdue' || b.dueDate < today)
  ).length;

  return {
    currencyLabel: 'INR (₹)',
    currentMonthLabel: formatMonthLabel(currentMonth),
    previousMonthLabel: formatMonthLabel(prevMonth),
    transactionCount: transactions.length,
    currentMonthTransactionCount: currentMonthTx.length,
    previousMonthTransactionCount: prevMonthTx.length,
    monthlySummary: {
      income: Number(income.toFixed(2)),
      expenses: Number(expenses.toFixed(2)),
      savings: Number(savings.toFixed(2)),
      savingsRatePct,
      prevIncome: Number(prevIncome.toFixed(2)),
      prevExpenses: Number(prevExpenses.toFixed(2)),
      prevSavings: Number(prevSavings.toFixed(2)),
      incomeGrowthPct,
      expenseGrowthPct,
      monthlyBudgetLimit: Number(monthlyBudgetLimit.toFixed(2)),
    },
    categoryBreakdown,
    monthlyTrend,
    unusualTransactions,
    budgets: currentBudgets,
    savingsGoals: sanitizedGoals,
    commitments: {
      monthlyBillsAndEmis: Number(monthlyBillsAndEmis.toFixed(2)),
      activeRecurringExpenseMonthly: Number(activeRecurringExpenseMonthly.toFixed(2)),
      overdueBillsCount,
    },
  };
}

async function parseErrorResponse(res: Response): Promise<AIInsightsApiError> {
  let message = `Request failed with status ${res.status}.`;
  let code = 'AI_REQUEST_FAILED';
  let retryAfterSeconds: number | undefined;

  try {
    const data = (await res.json()) as {
      error?: string;
      code?: string;
      retryAfterSeconds?: number;
    };
    if (data.error) message = data.error;
    if (data.code) code = data.code;
    if (typeof data.retryAfterSeconds === 'number') {
      retryAfterSeconds = data.retryAfterSeconds;
    }
  } catch {
    // Keep fallback error message
  }

  return new AIInsightsApiError(message, res.status, code, retryAfterSeconds);
}

export async function checkAIHealth(): Promise<{ ok: boolean; geminiConfigured: boolean }> {
  const res = await fetch('/api/health', { method: 'GET' });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as { ok: boolean; geminiConfigured: boolean };
}

export async function fetchAIInsights(
  snapshot: SanitizedFinancialSnapshot
): Promise<{ model: string; generatedAt: string; insights: GeminiAIInsightsResult }> {
  const res = await fetch('/api/ai/insights', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ snapshot }),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return (await res.json()) as {
    model: string;
    generatedAt: string;
    insights: GeminiAIInsightsResult;
  };
}

export async function sendAIChatMessage(params: {
  question: string;
  history: Pick<AIChatMessage, 'role' | 'content'>[];
  snapshot: SanitizedFinancialSnapshot;
}): Promise<{ model: string; answer: string; answeredAt: string }> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return (await res.json()) as {
    model: string;
    answer: string;
    answeredAt: string;
  };
}
