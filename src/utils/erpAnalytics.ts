import {
  BillRecord,
  BudgetRecord,
  DebtRecord,
  RecordPayment,
  RecurringTransaction,
  SavingsGoal,
  TransactionRecord,
} from '../types/finance';
import { daysBetween, getCurrentMonthStr, getTodayStr } from './formatters';
import { aggregateByCategory, buildMonthlySeries, computeProfitLoss } from './analytics';

export interface GeneralLedgerRow {
  voucherNo: string;
  id: string;
  date: string;
  time: string;
  account: string;
  particulars: string;
  type: 'income' | 'expense';
  paymentMethod: string;
  debit: number;
  credit: number;
  runningBalance: number;
  notes: string;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountGroup: 'Asset / Cash' | 'Income (Revenue)' | 'Expense';
  entryCount: number;
  debit: number;
  credit: number;
}

export interface BalanceSheetItem {
  code: string;
  label: string;
  group: 'Current Assets' | 'Earmarked Reserves' | 'Receivables' | 'Current Liabilities' | 'Long-Term / Loan Liabilities';
  amount: number;
  note: string;
}

export interface BalanceSheetStatement {
  asOfDate: string;
  assets: BalanceSheetItem[];
  liabilities: BalanceSheetItem[];
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
  debtToAssetRatioPct: number | null;
}

export interface ArApScheduleRow {
  refCode: string;
  source: 'Debt / Loan' | 'Bill / EMI';
  direction: 'Receivable' | 'Payable';
  partyOrProvider: string;
  title: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  daysOverdue: number;
  agingBucket: 'Settled' | 'Current / Upcoming' | '1-30 Days Overdue' | '31-60 Days Overdue' | '60+ Days Overdue';
}

export interface FinancialStatsSnapshot {
  periodLabel: string;
  generatedDate: string;
  periodIncome: number;
  periodExpenses: number;
  periodNetProfit: number;
  periodTransactionCount: number;
  periodSavingsRatePct: number | null;
  periodExpenseRatioPct: number | null;
  avgIncomeEntry: number;
  avgExpenseEntry: number;
  allTimeIncome: number;
  allTimeExpenses: number;
  currentCashBalance: number;
  totalSavings: number;
  savingsTargetTotal: number;
  savingsGoalProgressPct: number | null;
  totalReceivables: number;
  totalPayablesAndLoans: number;
  pendingBillsAndEmis: number;
  totalPendingPayments: number;
  totalMoneyReceivedPeriod: number;
  totalMoneySpentPeriod: number;
  netWorth: number;
  monthlyProfit: number;
  yearlyProfit: number;
  profitGrowthPct: number | null;
  expenseGrowthPct: number | null;
  incomeGrowthPct: number | null;
  activeRecurringCount: number;
  currentMonthBudgetTotal: number;
  currentMonthBudgetSpent: number;
  budgetUtilizationPct: number | null;
}

export function buildGeneralLedgerRows(transactions: TransactionRecord[]): GeneralLedgerRow[] {
  const chronological = [...transactions].sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    if (cmp !== 0) return cmp;
    return (a.time || '').localeCompare(b.time || '');
  });

  let runningBalance = 0;
  return chronological.map((t, index) => {
    const debit = t.type === 'expense' ? t.amount : 0;
    const credit = t.type === 'income' ? t.amount : 0;
    runningBalance = Number((runningBalance + credit - debit).toFixed(2));
    return {
      voucherNo: `VCH-${String(index + 1).padStart(4, '0')}`,
      id: t.id,
      date: t.date,
      time: t.time || '—',
      account: t.category,
      particulars: t.title,
      type: t.type,
      paymentMethod: t.paymentMethod,
      debit,
      credit,
      runningBalance,
      notes: t.description || t.notes || '',
    };
  });
}

export function buildTrialBalance(transactions: TransactionRecord[]): {
  rows: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
} {
  const incomeCats = aggregateByCategory(transactions, 'income');
  const expenseCats = aggregateByCategory(transactions, 'expense');

  const totalIncome = incomeCats.reduce((s, c) => s + c.amount, 0);
  const totalExpenses = expenseCats.reduce((s, c) => s + c.amount, 0);
  const netCash = Number((totalIncome - totalExpenses).toFixed(2));

  const rows: TrialBalanceRow[] = [];

  rows.push({
    accountCode: '1000',
    accountName: netCash >= 0 ? 'Cash & Liquid Ledger Balance' : 'Cash Ledger Deficit / Overdraft',
    accountGroup: 'Asset / Cash',
    entryCount: transactions.length,
    debit: netCash >= 0 ? netCash : 0,
    credit: netCash < 0 ? Math.abs(netCash) : 0,
  });

  incomeCats.forEach((c, idx) => {
    rows.push({
      accountCode: String(4000 + (idx + 1) * 10),
      accountName: c.category,
      accountGroup: 'Income (Revenue)',
      entryCount: c.count,
      debit: 0,
      credit: Number(c.amount.toFixed(2)),
    });
  });

  expenseCats.forEach((c, idx) => {
    rows.push({
      accountCode: String(5000 + (idx + 1) * 10),
      accountName: c.category,
      accountGroup: 'Expense',
      entryCount: c.count,
      debit: Number(c.amount.toFixed(2)),
      credit: 0,
    });
  });

  const totalDebits = Number(rows.reduce((s, r) => s + r.debit, 0).toFixed(2));
  const totalCredits = Number(rows.reduce((s, r) => s + r.credit, 0).toFixed(2));

  return {
    rows,
    totalDebits,
    totalCredits,
    isBalanced: Math.abs(totalDebits - totalCredits) < 0.05,
  };
}

export function buildBalanceSheetStatement(
  transactions: TransactionRecord[],
  savingsGoals: SavingsGoal[],
  debtRecords: DebtRecord[],
  bills: BillRecord[]
): BalanceSheetStatement {
  const allIncome = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const allExpenses = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const cashNet = Number((allIncome - allExpenses).toFixed(2));

  const savingsTotal = Number(savingsGoals.reduce((s, g) => s + g.savedAmount, 0).toFixed(2));

  const lentOutstanding = Number(
    debtRecords
      .filter((d) => d.recordType === 'lent' && d.status !== 'paid')
      .reduce((s, d) => s + Math.max(0, d.totalAmount - d.paidAmount), 0)
      .toFixed(2)
  );

  const receivablesOutstanding = Number(
    debtRecords
      .filter((d) => d.recordType === 'receivable' && d.status !== 'paid')
      .reduce((s, d) => s + Math.max(0, d.totalAmount - d.paidAmount), 0)
      .toFixed(2)
  );

  const borrowedOutstanding = Number(
    debtRecords
      .filter((d) => d.recordType === 'borrowed' && d.status !== 'paid')
      .reduce((s, d) => s + Math.max(0, d.totalAmount - d.paidAmount), 0)
      .toFixed(2)
  );

  const loansOutstanding = Number(
    debtRecords
      .filter((d) => d.recordType === 'loan' && d.status !== 'paid')
      .reduce((s, d) => s + Math.max(0, d.totalAmount - d.paidAmount), 0)
      .toFixed(2)
  );

  const payablesOutstanding = Number(
    debtRecords
      .filter((d) => d.recordType === 'payable' && d.status !== 'paid')
      .reduce((s, d) => s + Math.max(0, d.totalAmount - d.paidAmount), 0)
      .toFixed(2)
  );

  const unpaidBills = Number(
    bills
      .filter((b) => b.status !== 'paid')
      .reduce((s, b) => s + Math.max(0, b.amount - b.paidAmount), 0)
      .toFixed(2)
  );

  const assets: BalanceSheetItem[] = [
    {
      code: 'A-101',
      label: 'Cash & Net Ledger Balance',
      group: 'Current Assets',
      amount: cashNet >= 0 ? cashNet : 0,
      note: 'All-time recorded income minus expenses',
    },
    {
      code: 'A-102',
      label: 'Earmarked Savings Reserves',
      group: 'Earmarked Reserves',
      amount: savingsTotal,
      note: `${savingsGoals.length} savings goal(s) tracked`,
    },
    {
      code: 'A-103',
      label: 'Loans Given (Money Lent)',
      group: 'Receivables',
      amount: lentOutstanding,
      note: 'Outstanding principal recoverable from borrowers',
    },
    {
      code: 'A-104',
      label: 'Accounts Receivable',
      group: 'Receivables',
      amount: receivablesOutstanding,
      note: 'Pending invoices & receivables due to you',
    },
  ];

  const liabilities: BalanceSheetItem[] = [
    ...(cashNet < 0
      ? [
          {
            code: 'L-200',
            label: 'Cash Ledger Deficit / Overdraft',
            group: 'Current Liabilities' as const,
            amount: Math.abs(cashNet),
            note: 'Cumulative expenses exceeding cumulative income',
          },
        ]
      : []),
    {
      code: 'L-201',
      label: 'Unpaid Bills, Subscriptions & EMIs',
      group: 'Current Liabilities',
      amount: unpaidBills,
      note: `${bills.filter((b) => b.status !== 'paid').length} open bill/EMI item(s)`,
    },
    {
      code: 'L-202',
      label: 'Accounts Payable',
      group: 'Current Liabilities',
      amount: payablesOutstanding,
      note: 'Pending vendor or personal payables',
    },
    {
      code: 'L-203',
      label: 'Money Borrowed',
      group: 'Long-Term / Loan Liabilities',
      amount: borrowedOutstanding,
      note: 'Short-term or personal borrowings remaining',
    },
    {
      code: 'L-204',
      label: 'Active Loans Outstanding',
      group: 'Long-Term / Loan Liabilities',
      amount: loansOutstanding,
      note: 'Remaining principal across active loan accounts',
    },
  ];

  const totalAssets = Number(assets.reduce((s, a) => s + a.amount, 0).toFixed(2));
  const totalLiabilities = Number(liabilities.reduce((s, l) => s + l.amount, 0).toFixed(2));
  const netWorth = Number((totalAssets - totalLiabilities).toFixed(2));

  return {
    asOfDate: getTodayStr(),
    assets,
    liabilities,
    totalAssets,
    totalLiabilities,
    netWorth,
    debtToAssetRatioPct: totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : null,
  };
}

export function buildArApSchedule(debtRecords: DebtRecord[], bills: BillRecord[]): ArApScheduleRow[] {
  const today = getTodayStr();
  const rows: ArApScheduleRow[] = [];

  debtRecords.forEach((d, idx) => {
    const remaining = Math.max(0, Number((d.totalAmount - d.paidAmount).toFixed(2)));
    const isSettled = d.status === 'paid' || remaining === 0;
    const overdueDays = !isSettled && d.dueDate < today ? Math.max(0, daysBetween(d.dueDate, today)) : 0;
    rows.push({
      refCode: `DR-${String(idx + 1).padStart(3, '0')}`,
      source: 'Debt / Loan',
      direction: d.recordType === 'lent' || d.recordType === 'receivable' ? 'Receivable' : 'Payable',
      partyOrProvider: d.partyName,
      title: `${d.title} (${d.recordType.toUpperCase()})`,
      dueDate: d.dueDate,
      totalAmount: d.totalAmount,
      paidAmount: d.paidAmount,
      remainingAmount: remaining,
      status: d.status.replace('_', ' '),
      daysOverdue: overdueDays,
      agingBucket: isSettled
        ? 'Settled'
        : overdueDays === 0
        ? 'Current / Upcoming'
        : overdueDays <= 30
        ? '1-30 Days Overdue'
        : overdueDays <= 60
        ? '31-60 Days Overdue'
        : '60+ Days Overdue',
    });
  });

  bills.forEach((b, idx) => {
    const remaining = Math.max(0, Number((b.amount - b.paidAmount).toFixed(2)));
    const isSettled = b.status === 'paid' || remaining === 0;
    const overdueDays = !isSettled && b.dueDate < today ? Math.max(0, daysBetween(b.dueDate, today)) : 0;
    rows.push({
      refCode: `BL-${String(idx + 1).padStart(3, '0')}`,
      source: 'Bill / EMI',
      direction: 'Payable',
      partyOrProvider: b.provider || b.category,
      title: `${b.title} (${b.billType.toUpperCase()})`,
      dueDate: b.dueDate,
      totalAmount: b.amount,
      paidAmount: b.paidAmount,
      remainingAmount: remaining,
      status: b.status.replace('_', ' '),
      daysOverdue: overdueDays,
      agingBucket: isSettled
        ? 'Settled'
        : overdueDays === 0
        ? 'Current / Upcoming'
        : overdueDays <= 30
        ? '1-30 Days Overdue'
        : overdueDays <= 60
        ? '31-60 Days Overdue'
        : '60+ Days Overdue',
    });
  });

  return rows.sort((a, b) => b.daysOverdue - a.daysOverdue || a.dueDate.localeCompare(b.dueDate));
}

export function buildFinancialStatsSnapshot(params: {
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  allTransactions: TransactionRecord[];
  savingsGoals: SavingsGoal[];
  budgets: BudgetRecord[];
  debtRecords: DebtRecord[];
  bills: BillRecord[];
  recordPayments: RecordPayment[];
  recurringTransactions: RecurringTransaction[];
}): FinancialStatsSnapshot {
  const {
    periodLabel,
    periodStart,
    periodEnd,
    allTransactions,
    savingsGoals,
    budgets,
    debtRecords,
    bills,
    recordPayments,
    recurringTransactions,
  } = params;

  const periodTx = allTransactions.filter((t) => t.date >= periodStart && t.date <= periodEnd);
  const periodIncomeList = periodTx.filter((t) => t.type === 'income');
  const periodExpenseList = periodTx.filter((t) => t.type === 'expense');

  const periodIncome = periodIncomeList.reduce((s, t) => s + t.amount, 0);
  const periodExpenses = periodExpenseList.reduce((s, t) => s + t.amount, 0);
  const periodNetProfit = periodIncome - periodExpenses;

  const allTimeIncome = allTransactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const allTimeExpenses = allTransactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const currentCashBalance = allTimeIncome - allTimeExpenses;

  const totalSavings = savingsGoals.reduce((s, g) => s + g.savedAmount, 0);
  const savingsTargetTotal = savingsGoals.reduce((s, g) => s + g.targetAmount, 0);

  const bs = buildBalanceSheetStatement(allTransactions, savingsGoals, debtRecords, bills);
  const totalReceivables = bs.assets
    .filter((a) => a.group === 'Receivables')
    .reduce((s, a) => s + a.amount, 0);
  const totalPayablesAndLoans = debtRecords
    .filter((d) => (d.recordType === 'borrowed' || d.recordType === 'payable' || d.recordType === 'loan') && d.status !== 'paid')
    .reduce((s, d) => s + Math.max(0, d.totalAmount - d.paidAmount), 0);
  const pendingBillsAndEmis = bills
    .filter((b) => b.status !== 'paid')
    .reduce((s, b) => s + Math.max(0, b.amount - b.paidAmount), 0);

  const receivableDebtIds = new Set(
    debtRecords.filter((d) => d.recordType === 'lent' || d.recordType === 'receivable').map((d) => d.id)
  );
  const payableDebtIds = new Set(
    debtRecords
      .filter((d) => d.recordType === 'borrowed' || d.recordType === 'payable' || d.recordType === 'loan')
      .map((d) => d.id)
  );

  const recoveriesInPeriod = recordPayments
    .filter(
      (p) =>
        p.parentKind === 'debt' &&
        receivableDebtIds.has(p.parentId) &&
        p.date >= periodStart &&
        p.date <= periodEnd
    )
    .reduce((s, p) => s + p.amount, 0);

  const settlementsInPeriod = recordPayments
    .filter(
      (p) =>
        ((p.parentKind === 'debt' && payableDebtIds.has(p.parentId)) || p.parentKind === 'bill') &&
        p.date >= periodStart &&
        p.date <= periodEnd
    )
    .reduce((s, p) => s + p.amount, 0);

  const pl = computeProfitLoss(allTransactions);
  const currentMonth = getCurrentMonthStr();
  const monthBudgets = budgets.filter((b) => b.month === currentMonth);
  const currentMonthBudgetTotal = monthBudgets.reduce((s, b) => s + b.limitAmount, 0);
  const monthExpensesByCat = new Map<string, number>();
  let monthExpenseSum = 0;
  allTransactions.forEach((t) => {
    if (t.type === 'expense' && t.date.startsWith(currentMonth)) {
      monthExpenseSum += t.amount;
      monthExpensesByCat.set(t.category, (monthExpensesByCat.get(t.category) || 0) + t.amount);
    }
  });
  const currentMonthBudgetSpent = monthBudgets.reduce((s, b) => {
    if (b.category === 'Monthly Overall') return s + monthExpenseSum;
    return s + (monthExpensesByCat.get(b.category) || 0);
  }, 0);

  return {
    periodLabel,
    generatedDate: getTodayStr(),
    periodIncome,
    periodExpenses,
    periodNetProfit,
    periodTransactionCount: periodTx.length,
    periodSavingsRatePct: periodIncome > 0 ? ((periodIncome - periodExpenses) / periodIncome) * 100 : null,
    periodExpenseRatioPct: periodIncome > 0 ? (periodExpenses / periodIncome) * 100 : null,
    avgIncomeEntry: periodIncomeList.length > 0 ? periodIncome / periodIncomeList.length : 0,
    avgExpenseEntry: periodExpenseList.length > 0 ? periodExpenses / periodExpenseList.length : 0,
    allTimeIncome,
    allTimeExpenses,
    currentCashBalance,
    totalSavings,
    savingsTargetTotal,
    savingsGoalProgressPct: savingsTargetTotal > 0 ? (totalSavings / savingsTargetTotal) * 100 : null,
    totalReceivables,
    totalPayablesAndLoans,
    pendingBillsAndEmis,
    totalPendingPayments: totalPayablesAndLoans + pendingBillsAndEmis,
    totalMoneyReceivedPeriod: periodIncome + recoveriesInPeriod,
    totalMoneySpentPeriod: periodExpenses + settlementsInPeriod,
    netWorth: bs.netWorth,
    monthlyProfit: pl.monthlyProfit,
    yearlyProfit: pl.yearlyProfit,
    profitGrowthPct: pl.profitGrowthPct,
    expenseGrowthPct: pl.expenseGrowthPct,
    incomeGrowthPct: pl.incomeGrowthPct,
    activeRecurringCount: recurringTransactions.filter((r) => r.isActive).length,
    currentMonthBudgetTotal,
    currentMonthBudgetSpent,
    budgetUtilizationPct:
      currentMonthBudgetTotal > 0 ? (currentMonthBudgetSpent / currentMonthBudgetTotal) * 100 : null,
  };
}

export function buildProfitLossExportModel(transactions: TransactionRecord[]) {
  const pl = computeProfitLoss(transactions);
  const incomeCats = aggregateByCategory(transactions, 'income');
  const expenseCats = aggregateByCategory(transactions, 'expense');
  const monthlySeries = buildMonthlySeries(transactions, 12);
  const allTimeIncome = incomeCats.reduce((s, c) => s + c.amount, 0);
  const allTimeExpenses = expenseCats.reduce((s, c) => s + c.amount, 0);
  const allTimeNet = allTimeIncome - allTimeExpenses;
  const netMarginPct = allTimeIncome > 0 ? (allTimeNet / allTimeIncome) * 100 : null;

  return {
    pl,
    incomeCats,
    expenseCats,
    monthlySeries,
    allTimeIncome,
    allTimeExpenses,
    allTimeNet,
    netMarginPct,
  };
}
