import {
  BillRecord,
  BudgetRecord,
  CurrencyCode,
  DebtRecord,
  FinTrackNotification,
  NotificationCategoryPrefs,
  NotificationSeverity,
  RecurringTransaction,
  SavingsGoal,
  TransactionRecord,
} from '../types/finance';
import {
  daysBetween,
  formatCurrency,
  formatReadableDate,
  getCurrentMonthStr,
  getTodayStr,
} from './formatters';

interface ComputeNotificationsInput {
  transactions: TransactionRecord[];
  budgets: BudgetRecord[];
  bills: BillRecord[];
  debtRecords: DebtRecord[];
  savingsGoals: SavingsGoal[];
  recurringTransactions: RecurringTransaction[];
  monthlyBudgetLimit: number;
  currency: CurrencyCode;
  categories: NotificationCategoryPrefs;
}

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  positive: 3,
};

export function computeFinTrackNotifications({
  transactions,
  budgets,
  bills,
  debtRecords,
  savingsGoals,
  recurringTransactions,
  monthlyBudgetLimit,
  currency,
  categories,
}: ComputeNotificationsInput): FinTrackNotification[] {
  const today = getTodayStr();
  const currentMonth = getCurrentMonthStr();
  const list: FinTrackNotification[] = [];

  // 1. Bills, EMIs & Subscriptions (Overdue & Due Soon)
  if (categories.bills) {
    for (const bill of bills) {
      if (bill.status === 'paid') continue;
      const remaining = Math.max(0, Number((bill.amount - bill.paidAmount).toFixed(2)));
      if (remaining <= 0) continue;

      const diff = daysBetween(today, bill.dueDate);
      const kindLabel =
        bill.billType === 'emi' ? 'EMI' : bill.billType === 'subscription' ? 'Subscription' : 'Bill';

      if (bill.status === 'overdue' || diff < 0) {
        const overdueDays = Math.abs(diff);
        list.push({
          id: `bill-overdue-${bill.id}`,
          signature: `bill-overdue:${bill.id}:${bill.dueDate}:${remaining}`,
          category: 'bills',
          severity: 'critical',
          title: `Overdue ${kindLabel}: ${bill.title}`,
          body: `${formatCurrency(remaining, currency)} was due on ${formatReadableDate(bill.dueDate)}${
            overdueDays > 0 ? ` (${overdueDays}d overdue)` : ''
          }.`,
          actionSection: 'bills-emis',
          timestampLabel: overdueDays > 0 ? `${overdueDays}d overdue` : 'Overdue',
        });
      } else if (diff <= 3) {
        list.push({
          id: `bill-due-${bill.id}`,
          signature: `bill-due:${bill.id}:${bill.dueDate}:${diff}`,
          category: 'bills',
          severity: diff === 0 ? 'critical' : 'warning',
          title:
            diff === 0
              ? `${kindLabel} Due Today: ${bill.title}`
              : `${kindLabel} Due in ${diff}d: ${bill.title}`,
          body: `${formatCurrency(remaining, currency)} due on ${formatReadableDate(bill.dueDate)}${
            bill.autoPay ? ' (AutoPay ON)' : ''
          }.`,
          actionSection: 'bills-emis',
          timestampLabel: diff === 0 ? 'Due today' : `In ${diff}d`,
        });
      }
    }
  }

  // 2. Category Budgets & Overall Monthly Spending Limit
  const currentMonthExpenses = transactions.filter(
    (t) => t.type === 'expense' && t.date.startsWith(currentMonth)
  );
  const currentMonthExpenseTotal = currentMonthExpenses.reduce((sum, t) => sum + t.amount, 0);

  if (categories.budgets) {
    const spentByCategory = new Map<string, number>();
    for (const tx of currentMonthExpenses) {
      spentByCategory.set(tx.category, (spentByCategory.get(tx.category) || 0) + tx.amount);
    }

    for (const budget of budgets) {
      if (budget.month !== currentMonth || budget.limitAmount <= 0) continue;
      const spent =
        budget.category === 'Monthly Overall'
          ? currentMonthExpenseTotal
          : spentByCategory.get(budget.category) || 0;
      const pct = (spent / budget.limitAmount) * 100;

      if (pct > 100) {
        const over = spent - budget.limitAmount;
        list.push({
          id: `budget-exceeded-${budget.id}`,
          signature: `budget-exceeded:${budget.id}:${currentMonth}:${Math.floor(pct / 10)}`,
          category: 'budgets',
          severity: 'critical',
          title: `Budget Exceeded: ${budget.category}`,
          body: `Spent ${formatCurrency(spent, currency)} of ${formatCurrency(
            budget.limitAmount,
            currency
          )} (${pct.toFixed(0)}%, +${formatCurrency(over, currency)} over).`,
          actionSection: 'budgets',
          timestampLabel: `${pct.toFixed(0)}% used`,
        });
      } else if (pct >= budget.alertThreshold) {
        list.push({
          id: `budget-warn-${budget.id}`,
          signature: `budget-warn:${budget.id}:${currentMonth}:${Math.floor(pct / 5)}`,
          category: 'budgets',
          severity: 'warning',
          title: `Budget Alert: ${budget.category} at ${pct.toFixed(0)}%`,
          body: `You have spent ${formatCurrency(spent, currency)} out of your ${formatCurrency(
            budget.limitAmount,
            currency
          )} limit this month.`,
          actionSection: 'budgets',
          timestampLabel: `${pct.toFixed(0)}% used`,
        });
      }
    }

    if (monthlyBudgetLimit > 0) {
      const overallPct = (currentMonthExpenseTotal / monthlyBudgetLimit) * 100;
      if (overallPct > 100) {
        list.push({
          id: 'overall-limit-exceeded',
          signature: `overall-limit-exceeded:${currentMonth}:${Math.floor(overallPct / 10)}`,
          category: 'budgets',
          severity: 'critical',
          title: 'Monthly Spending Limit Exceeded',
          body: `This month's expenses (${formatCurrency(
            currentMonthExpenseTotal,
            currency
          )}) exceeded your ${formatCurrency(monthlyBudgetLimit, currency)} spending cap.`,
          actionSection: 'dashboard',
          timestampLabel: `${overallPct.toFixed(0)}% of cap`,
        });
      } else if (overallPct >= 85) {
        list.push({
          id: 'overall-limit-warn',
          signature: `overall-limit-warn:${currentMonth}:${Math.floor(overallPct / 5)}`,
          category: 'budgets',
          severity: 'warning',
          title: `Monthly Cap at ${overallPct.toFixed(0)}%`,
          body: `Remaining monthly allowance: ${formatCurrency(
            Math.max(0, monthlyBudgetLimit - currentMonthExpenseTotal),
            currency
          )}.`,
          actionSection: 'dashboard',
          timestampLabel: `${overallPct.toFixed(0)}% of cap`,
        });
      }
    }
  }

  // 3. Loans, Payables, Receivables & Debts
  if (categories.debts) {
    for (const debt of debtRecords) {
      if (debt.status === 'paid') continue;
      const remaining = Math.max(0, Number((debt.totalAmount - debt.paidAmount).toFixed(2)));
      if (remaining <= 0) continue;

      const diff = daysBetween(today, debt.dueDate);
      const isReceivable = debt.recordType === 'lent' || debt.recordType === 'receivable';

      if (debt.status === 'overdue' || diff < 0) {
        list.push({
          id: `debt-overdue-${debt.id}`,
          signature: `debt-overdue:${debt.id}:${debt.dueDate}:${remaining}`,
          category: 'debts',
          severity: isReceivable ? 'warning' : 'critical',
          title: isReceivable
            ? `Overdue Collection: ${debt.partyName}`
            : `Overdue Loan/Payable: ${debt.title}`,
          body: `${formatCurrency(remaining, currency)} (${debt.partyName}) was due on ${formatReadableDate(
            debt.dueDate
          )}.`,
          actionSection: 'loans-debts',
          timestampLabel: `${Math.abs(diff)}d overdue`,
        });
      } else if (diff <= 3) {
        list.push({
          id: `debt-due-${debt.id}`,
          signature: `debt-due:${debt.id}:${debt.dueDate}:${diff}`,
          category: 'debts',
          severity: 'warning',
          title: isReceivable
            ? `Collection Due ${diff === 0 ? 'Today' : `in ${diff}d`}: ${debt.partyName}`
            : `Repayment Due ${diff === 0 ? 'Today' : `in ${diff}d`}: ${debt.title}`,
          body: `${formatCurrency(remaining, currency)} scheduled for ${formatReadableDate(debt.dueDate)}.`,
          actionSection: 'loans-debts',
          timestampLabel: diff === 0 ? 'Due today' : `In ${diff}d`,
        });
      }
    }
  }

  // 4. Unusual High Expense & Monthly Cash Flow Insights
  if (categories.insights) {
    const allExpenses = transactions.filter((t) => t.type === 'expense');
    if (allExpenses.length >= 3 && currentMonthExpenses.length > 0) {
      const avgExpense = allExpenses.reduce((s, t) => s + t.amount, 0) / allExpenses.length;
      const topAnomaly = currentMonthExpenses
        .filter((t) => t.amount >= avgExpense * 2)
        .sort((a, b) => b.amount - a.amount)[0];

      if (topAnomaly) {
        list.push({
          id: `insight-unusual-${topAnomaly.id}`,
          signature: `insight-unusual:${topAnomaly.id}:${topAnomaly.amount}`,
          category: 'insights',
          severity: 'warning',
          title: `Unusual Expense: ${topAnomaly.title}`,
          body: `${formatCurrency(topAnomaly.amount, currency)} in ${
            topAnomaly.category
          } is over 2× your average spend (${formatCurrency(avgExpense, currency)}).`,
          actionSection: 'insights',
          timestampLabel: formatReadableDate(topAnomaly.date),
        });
      }
    }

    const currentMonthIncome = transactions
      .filter((t) => t.type === 'income' && t.date.startsWith(currentMonth))
      .reduce((s, t) => s + t.amount, 0);

    if (currentMonthIncome > 0 && currentMonthExpenseTotal > currentMonthIncome) {
      list.push({
        id: `insight-deficit-${currentMonth}`,
        signature: `insight-deficit:${currentMonth}:${Math.floor(
          (currentMonthExpenseTotal - currentMonthIncome) / 100
        )}`,
        category: 'insights',
        severity: 'warning',
        title: 'Monthly Cash Flow Deficit',
        body: `Expenses exceed income by ${formatCurrency(
          currentMonthExpenseTotal - currentMonthIncome,
          currency
        )} so far this month.`,
        actionSection: 'profit-loss',
        timestampLabel: 'This month',
      });
    }
  }

  // 5. Savings Goal Milestones & Approaching Deadlines
  if (categories.savings) {
    for (const goal of savingsGoals) {
      const pct = goal.targetAmount > 0 ? (goal.savedAmount / goal.targetAmount) * 100 : 0;
      if (goal.status === 'completed' || pct >= 100) {
        list.push({
          id: `savings-done-${goal.id}`,
          signature: `savings-done:${goal.id}`,
          category: 'savings',
          severity: 'positive',
          title: `Savings Goal Reached: ${goal.name}`,
          body: `You hit ${formatCurrency(goal.savedAmount, currency)} of your ${formatCurrency(
            goal.targetAmount,
            currency
          )} target!`,
          actionSection: 'savings',
          timestampLabel: '100% funded',
        });
      } else {
        const diff = daysBetween(today, goal.targetDate);
        if (diff >= 0 && diff <= 7) {
          const remaining = Math.max(0, goal.targetAmount - goal.savedAmount);
          list.push({
            id: `savings-target-${goal.id}`,
            signature: `savings-target:${goal.id}:${goal.targetDate}`,
            category: 'savings',
            severity: 'info',
            title: `Savings Target Approaching: ${goal.name}`,
            body: `${formatCurrency(remaining, currency)} left to reach your target by ${formatReadableDate(
              goal.targetDate
            )}.`,
            actionSection: 'savings',
            timestampLabel: diff === 0 ? 'Target today' : `${diff}d left`,
          });
        }
      }
    }
  }

  // 6. Upcoming Recurring Transactions (Today / Tomorrow)
  if (categories.recurring) {
    for (const rule of recurringTransactions) {
      if (!rule.isActive) continue;
      const diff = daysBetween(today, rule.nextRunDate);
      if (diff >= 0 && diff <= 1) {
        list.push({
          id: `recurring-soon-${rule.id}`,
          signature: `recurring-soon:${rule.id}:${rule.nextRunDate}`,
          category: 'recurring',
          severity: 'info',
          title: `Upcoming Recurring ${rule.type === 'income' ? 'Income' : 'Expense'}: ${rule.title}`,
          body: `${formatCurrency(rule.amount, currency)} (${rule.frequency}) scheduled for ${
            diff === 0 ? 'today' : 'tomorrow'
          }.`,
          actionSection: 'transactions',
          timestampLabel: diff === 0 ? 'Today' : 'Tomorrow',
        });
      }
    }
  }

  return list.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}
