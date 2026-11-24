import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
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
import { formatCurrencyAscii, getCurrentMonthStr, getTodayStr } from './formatters';
import { aggregateByCategory, buildMonthlySeries } from './analytics';
import {
  buildArApSchedule,
  buildBalanceSheetStatement,
  buildFinancialStatsSnapshot,
  buildGeneralLedgerRows,
  buildProfitLossExportModel,
  buildTrialBalance,
  FinancialStatsSnapshot,
} from './erpAnalytics';

function escapeCsvField(val: string | number): string {
  const str = String(val ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function getLastTableY(doc: jsPDF, fallback = 120): number {
  const withTable = doc as unknown as { lastAutoTable?: { finalY?: number } };
  return withTable.lastAutoTable?.finalY ?? fallback;
}

function drawPdfHeader(doc: jsPDF, title: string, subtitle: string): void {
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, width, 78, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(title, 40, 34);
  doc.setFontSize(9.5);
  doc.setTextColor(148, 163, 184);
  doc.text(subtitle, 40, 54);
  doc.setTextColor(15, 23, 42);
}

function drawPdfSectionHeading(doc: jsPDF, heading: string, startY: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = startY;
  if (y > pageHeight - 130) {
    doc.addPage();
    y = 48;
  }
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(heading, 40, y);
  return y + 10;
}

export function exportTransactionsToCSV(
  transactions: TransactionRecord[],
  currency: CurrencyCode,
  filenamePrefix = 'fintrack-transactions'
): void {
  const headers = [
    'Date',
    'Time',
    'Type',
    'Title',
    'Category',
    'Amount',
    'Currency',
    'Payment Method',
    'Description',
    'Notes',
  ];
  const rows = transactions.map((t) => [
    t.date,
    t.time || '',
    t.type.toUpperCase(),
    t.title,
    t.category,
    t.amount.toFixed(2),
    currency,
    t.paymentMethod,
    t.description,
    t.notes,
  ]);

  const csvContent =
    '\uFEFF' +
    [headers, ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, `${filenamePrefix}-${getTodayStr()}.csv`);
}

export function exportTransactionsToExcel(
  transactions: TransactionRecord[],
  currency: CurrencyCode,
  filenamePrefix = 'fintrack-transactions'
): void {
  const sheetData = transactions.map((t) => ({
    Date: t.date,
    Time: t.time || '',
    Type: t.type === 'income' ? 'Income' : 'Expense',
    Title: t.title,
    Category: t.category,
    Amount: t.amount,
    Currency: currency,
    'Payment Method': t.paymentMethod,
    Description: t.description,
    Notes: t.notes,
  }));

  const totalIncome = transactions
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  const summaryData = [
    { Metric: 'Total Income', Amount: totalIncome, Currency: currency },
    { Metric: 'Total Expenses', Amount: totalExpenses, Currency: currency },
    { Metric: 'Net Profit / Loss', Amount: totalIncome - totalExpenses, Currency: currency },
    { Metric: 'Total Records', Amount: transactions.length, Currency: '' },
  ];

  const wb = XLSX.utils.book_new();
  const wsTx = XLSX.utils.json_to_sheet(sheetData);
  const wsSummary = XLSX.utils.json_to_sheet(summaryData);

  XLSX.utils.book_append_sheet(wb, wsTx, 'Transactions');
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  XLSX.writeFile(wb, `${filenamePrefix}-${getTodayStr()}.xlsx`);
}

export function exportTransactionsToPDF(
  transactions: TransactionRecord[],
  currency: CurrencyCode,
  reportTitle = 'FinTrack Financial Statement',
  subtitle = ''
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

  const totalIncome = transactions
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);
  const netProfit = totalIncome - totalExpenses;

  drawPdfHeader(
    doc,
    reportTitle,
    subtitle || `Generated on ${getTodayStr()} | Currency: ${currency}`
  );

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.text(`Total Income: ${formatCurrencyAscii(totalIncome, currency)}`, 40, 106);
  doc.text(`Total Expenses: ${formatCurrencyAscii(totalExpenses, currency)}`, 220, 106);
  doc.text(`Net P&L: ${formatCurrencyAscii(netProfit, currency)}`, 400, 106);

  const tableRows = transactions.map((t) => [
    t.date,
    t.type === 'income' ? 'Income' : 'Expense',
    t.title.slice(0, 32),
    t.category,
    t.paymentMethod,
    `${t.type === 'income' ? '+' : '-'}${formatCurrencyAscii(t.amount, currency)}`,
  ]);

  autoTable(doc, {
    startY: 124,
    head: [['Date', 'Type', 'Title', 'Category', 'Method', 'Amount']],
    body: tableRows,
    styles: { fontSize: 8.5, cellPadding: 5 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      5: { halign: 'right' },
    },
  });

  doc.save(`fintrack-report-${getTodayStr()}.pdf`);
}

export function exportGenericReportToPDF(
  title: string,
  summaryLines: { label: string; value: string }[],
  headers: string[],
  rows: (string | number)[][],
  filenamePrefix = 'fintrack-analytics-report'
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

  drawPdfHeader(doc, title, `FinTrack Smart Money Manager | Generated ${getTodayStr()}`);

  let yPos = 104;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  summaryLines.forEach((line, idx) => {
    const col = idx % 2 === 0 ? 40 : 300;
    if (idx > 0 && idx % 2 === 0) yPos += 18;
    doc.text(`${line.label}: ${line.value}`, col, yPos);
  });

  autoTable(doc, {
    startY: yPos + 24,
    head: [headers],
    body: rows.map((r) => r.map(String)),
    styles: { fontSize: 8.5, cellPadding: 5 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.save(`${filenamePrefix}-${getTodayStr()}.pdf`);
}

// ---------------------------------------------------------------------------
// ERP Financial Stats Export (Excel & PDF)
// ---------------------------------------------------------------------------

export function exportFinancialStatsToExcel(
  stats: FinancialStatsSnapshot,
  periodTransactions: TransactionRecord[],
  currency: CurrencyCode
): void {
  const kpiRows = [
    { Section: 'Selected Period', Metric: 'Reporting Window', Value: stats.periodLabel, Unit: '' },
    { Section: 'Selected Period', Metric: 'Total Income', Value: stats.periodIncome, Unit: currency },
    { Section: 'Selected Period', Metric: 'Total Expenses', Value: stats.periodExpenses, Unit: currency },
    { Section: 'Selected Period', Metric: 'Net Profit / Loss', Value: stats.periodNetProfit, Unit: currency },
    { Section: 'Selected Period', Metric: 'Total Money Received (incl. Recoveries)', Value: stats.totalMoneyReceivedPeriod, Unit: currency },
    { Section: 'Selected Period', Metric: 'Total Money Spent (incl. Settlements)', Value: stats.totalMoneySpentPeriod, Unit: currency },
    {
      Section: 'Financial Ratios',
      Metric: 'Period Savings Rate (%)',
      Value: stats.periodSavingsRatePct !== null ? Number(stats.periodSavingsRatePct.toFixed(2)) : 'N/A',
      Unit: '%',
    },
    {
      Section: 'Financial Ratios',
      Metric: 'Expense-to-Income Ratio (%)',
      Value: stats.periodExpenseRatioPct !== null ? Number(stats.periodExpenseRatioPct.toFixed(2)) : 'N/A',
      Unit: '%',
    },
    { Section: 'Financial Ratios', Metric: 'Avg Income Entry', Value: Number(stats.avgIncomeEntry.toFixed(2)), Unit: currency },
    { Section: 'Financial Ratios', Metric: 'Avg Expense Entry', Value: Number(stats.avgExpenseEntry.toFixed(2)), Unit: currency },
    { Section: 'Position & Balance', Metric: 'Current Cash Balance (All-Time Net)', Value: stats.currentCashBalance, Unit: currency },
    { Section: 'Position & Balance', Metric: 'Total Savings Reserves', Value: stats.totalSavings, Unit: currency },
    { Section: 'Position & Balance', Metric: 'Accounts Receivable & Lent', Value: stats.totalReceivables, Unit: currency },
    { Section: 'Position & Balance', Metric: 'Loans, Borrowings & Payables', Value: stats.totalPayablesAndLoans, Unit: currency },
    { Section: 'Position & Balance', Metric: 'Pending Bills & EMIs', Value: stats.pendingBillsAndEmis, Unit: currency },
    { Section: 'Position & Balance', Metric: 'Estimated Net Worth (Assets - Liabilities)', Value: stats.netWorth, Unit: currency },
    { Section: 'Growth & Budgets', Metric: 'Current Month Net Profit / Loss', Value: stats.monthlyProfit, Unit: currency },
    { Section: 'Growth & Budgets', Metric: 'Current Year Net Profit / Loss', Value: stats.yearlyProfit, Unit: currency },
    {
      Section: 'Growth & Budgets',
      Metric: 'MoM Profit Growth (%)',
      Value: stats.profitGrowthPct !== null ? Number(stats.profitGrowthPct.toFixed(2)) : 'N/A',
      Unit: '%',
    },
    {
      Section: 'Growth & Budgets',
      Metric: 'MoM Income Growth (%)',
      Value: stats.incomeGrowthPct !== null ? Number(stats.incomeGrowthPct.toFixed(2)) : 'N/A',
      Unit: '%',
    },
    {
      Section: 'Growth & Budgets',
      Metric: 'MoM Expense Growth (%)',
      Value: stats.expenseGrowthPct !== null ? Number(stats.expenseGrowthPct.toFixed(2)) : 'N/A',
      Unit: '%',
    },
    {
      Section: 'Growth & Budgets',
      Metric: 'Current Month Budget Utilization (%)',
      Value: stats.budgetUtilizationPct !== null ? Number(stats.budgetUtilizationPct.toFixed(2)) : 'N/A',
      Unit: '%',
    },
  ];

  const expenseMix = aggregateByCategory(periodTransactions, 'expense').map((c) => ({
    Type: 'Expense',
    Category: c.category,
    Entries: c.count,
    Amount: c.amount,
    SharePct: Number(c.percentage.toFixed(2)),
    Currency: currency,
  }));

  const incomeMix = aggregateByCategory(periodTransactions, 'income').map((c) => ({
    Type: 'Income',
    Category: c.category,
    Entries: c.count,
    Amount: c.amount,
    SharePct: Number(c.percentage.toFixed(2)),
    Currency: currency,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiRows), 'Financial Stats');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([...incomeMix, ...expenseMix]),
    'Category Breakdown'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      periodTransactions.map((t) => ({
        Date: t.date,
        Type: t.type,
        Title: t.title,
        Category: t.category,
        Method: t.paymentMethod,
        Amount: t.amount,
        Currency: currency,
      }))
    ),
    'Period Ledger'
  );

  XLSX.writeFile(wb, `fintrack-financial-stats-${getTodayStr()}.xlsx`);
}

export function exportFinancialStatsToPDF(
  stats: FinancialStatsSnapshot,
  periodTransactions: TransactionRecord[],
  currency: CurrencyCode
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  drawPdfHeader(
    doc,
    'FinTrack Executive Financial Stats',
    `Period: ${stats.periodLabel} | Generated: ${stats.generatedDate} | Currency: ${currency}`
  );

  let y = drawPdfSectionHeading(doc, '1. Executive KPIs & Financial Ratios', 102);

  autoTable(doc, {
    startY: y,
    head: [['Metric', 'Value', 'Context']],
    body: [
      ['Total Income (Period)', formatCurrencyAscii(stats.periodIncome, currency), stats.periodLabel],
      ['Total Expenses (Period)', formatCurrencyAscii(stats.periodExpenses, currency), stats.periodLabel],
      ['Net Profit / Loss (Period)', formatCurrencyAscii(stats.periodNetProfit, currency), stats.periodNetProfit >= 0 ? 'Surplus' : 'Deficit'],
      ['Total Money Received', formatCurrencyAscii(stats.totalMoneyReceivedPeriod, currency), 'Income + Debt Recoveries'],
      ['Total Money Spent', formatCurrencyAscii(stats.totalMoneySpentPeriod, currency), 'Expenses + Settlements'],
      [
        'Period Savings Rate',
        stats.periodSavingsRatePct !== null ? `${stats.periodSavingsRatePct.toFixed(1)}%` : 'N/A',
        'Retained income percentage',
      ],
      [
        'Expense-to-Income Ratio',
        stats.periodExpenseRatioPct !== null ? `${stats.periodExpenseRatioPct.toFixed(1)}%` : 'N/A',
        'Outflow share of income',
      ],
      ['Current Cash Balance', formatCurrencyAscii(stats.currentCashBalance, currency), 'All-time net ledger'],
      ['Total Savings Reserves', formatCurrencyAscii(stats.totalSavings, currency), `Target ${formatCurrencyAscii(stats.savingsTargetTotal, currency)}`],
      ['Total Receivables', formatCurrencyAscii(stats.totalReceivables, currency), 'Lent & open receivables'],
      ['Pending Payments & Liabilities', formatCurrencyAscii(stats.totalPendingPayments, currency), 'Unpaid bills, EMIs & loans'],
      ['Estimated Net Worth', formatCurrencyAscii(stats.netWorth, currency), 'Total Assets - Liabilities'],
    ],
    styles: { fontSize: 8.5, cellPadding: 4.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 1: { halign: 'right' } },
  });

  const expenseMix = aggregateByCategory(periodTransactions, 'expense');
  if (expenseMix.length > 0) {
    y = drawPdfSectionHeading(doc, '2. Expense Category Mix (Selected Period)', getLastTableY(doc) + 22);
    autoTable(doc, {
      startY: y,
      head: [['Category', 'Entries', 'Total Amount', 'Share (%)']],
      body: expenseMix.map((c) => [
        c.category,
        String(c.count),
        formatCurrencyAscii(c.amount, currency),
        `${c.percentage.toFixed(1)}%`,
      ]),
      styles: { fontSize: 8.5, cellPadding: 4.5 },
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
  }

  doc.save(`fintrack-financial-stats-${getTodayStr()}.pdf`);
}

// ---------------------------------------------------------------------------
// ERP General Ledger Export (Running Debit / Credit / Balance)
// ---------------------------------------------------------------------------

export function exportGeneralLedgerToExcel(
  transactions: TransactionRecord[],
  currency: CurrencyCode
): void {
  const rows = buildGeneralLedgerRows(transactions);
  const sheetRows = rows.map((r) => ({
    'Voucher Ref': r.voucherNo,
    Date: r.date,
    Time: r.time,
    'Account / Category': r.account,
    Particulars: r.particulars,
    'Payment Method': r.paymentMethod,
    [`Debit (${currency})`]: r.debit,
    [`Credit (${currency})`]: r.credit,
    [`Running Balance (${currency})`]: r.runningBalance,
    Notes: r.notes,
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'General Ledger');
  XLSX.writeFile(wb, `fintrack-general-ledger-${getTodayStr()}.xlsx`);
}

export function exportGeneralLedgerToPDF(
  transactions: TransactionRecord[],
  currency: CurrencyCode
): void {
  const rows = buildGeneralLedgerRows(transactions);
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const closingBalance = rows.length > 0 ? rows[rows.length - 1].runningBalance : 0;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  drawPdfHeader(
    doc,
    'FinTrack General Ledger (Voucher & Running Balance)',
    `As of ${getTodayStr()} | Entries: ${rows.length} | Currency: ${currency}`
  );

  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Total Credit (Inflow): ${formatCurrencyAscii(totalCredit, currency)}`, 40, 102);
  doc.text(`Total Debit (Outflow): ${formatCurrencyAscii(totalDebit, currency)}`, 290, 102);
  doc.text(`Closing Cash Balance: ${formatCurrencyAscii(closingBalance, currency)}`, 550, 102);

  autoTable(doc, {
    startY: 118,
    head: [['Voucher', 'Date', 'Account', 'Particulars', 'Method', 'Debit', 'Credit', 'Balance']],
    body: [
      ...rows.map((r) => [
        r.voucherNo,
        r.date,
        r.account,
        r.particulars.slice(0, 28),
        r.paymentMethod,
        r.debit > 0 ? formatCurrencyAscii(r.debit, currency) : '—',
        r.credit > 0 ? formatCurrencyAscii(r.credit, currency) : '—',
        formatCurrencyAscii(r.runningBalance, currency),
      ]),
      [
        'TOTAL',
        '',
        '',
        `${rows.length} Posted Vouchers`,
        '',
        formatCurrencyAscii(totalDebit, currency),
        formatCurrencyAscii(totalCredit, currency),
        formatCurrencyAscii(closingBalance, currency),
      ],
    ],
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
    },
  });

  doc.save(`fintrack-general-ledger-${getTodayStr()}.pdf`);
}

// ---------------------------------------------------------------------------
// ERP Profit & Loss (Income Statement) Export
// ---------------------------------------------------------------------------

export function exportProfitLossToExcel(
  transactions: TransactionRecord[],
  currency: CurrencyCode
): void {
  const model = buildProfitLossExportModel(transactions);

  const statementRows = [
    { Section: 'REVENUE / INCOME', Account: 'Category', Entries: '', [`Amount (${currency})`]: '', 'Share (%)': '' },
    ...model.incomeCats.map((c) => ({
      Section: 'Income',
      Account: c.category,
      Entries: c.count,
      [`Amount (${currency})`]: c.amount,
      'Share (%)': Number(c.percentage.toFixed(2)),
    })),
    { Section: 'TOTAL REVENUE', Account: 'Total Income', Entries: '', [`Amount (${currency})`]: model.allTimeIncome, 'Share (%)': 100 },
    { Section: 'EXPENSES', Account: 'Category', Entries: '', [`Amount (${currency})`]: '', 'Share (%)': '' },
    ...model.expenseCats.map((c) => ({
      Section: 'Expense',
      Account: c.category,
      Entries: c.count,
      [`Amount (${currency})`]: c.amount,
      'Share (%)': Number(c.percentage.toFixed(2)),
    })),
    { Section: 'TOTAL EXPENSES', Account: 'Total Expenses', Entries: '', [`Amount (${currency})`]: model.allTimeExpenses, 'Share (%)': 100 },
    { Section: 'NET PROFIT / LOSS', Account: 'Net Surplus / (Deficit)', Entries: '', [`Amount (${currency})`]: model.allTimeNet, 'Share (%)': model.netMarginPct !== null ? Number(model.netMarginPct.toFixed(2)) : 'N/A' },
  ];

  const periodRows = [
    { Period: 'Daily (Today)', Income: model.pl.dailyIncome, Expenses: model.pl.dailyExpenses, NetProfitLoss: model.pl.dailyProfit, Currency: currency },
    { Period: 'Current Month', Income: model.pl.monthlyIncome, Expenses: model.pl.monthlyExpenses, NetProfitLoss: model.pl.monthlyProfit, Currency: currency },
    { Period: 'Previous Month', Income: model.pl.prevMonthIncome, Expenses: model.pl.prevMonthExpenses, NetProfitLoss: model.pl.prevMonthProfit, Currency: currency },
    { Period: 'Current Year', Income: model.pl.yearlyIncome, Expenses: model.pl.yearlyExpenses, NetProfitLoss: model.pl.yearlyProfit, Currency: currency },
    { Period: 'All-Time Total', Income: model.allTimeIncome, Expenses: model.allTimeExpenses, NetProfitLoss: model.allTimeNet, Currency: currency },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(statementRows), 'P&L Statement');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(periodRows), 'Period Summary');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      model.monthlySeries.map((m) => ({
        Month: m.month,
        Label: m.label,
        Income: m.income,
        Expenses: m.expenses,
        NetProfitLoss: m.profit,
        Currency: currency,
      }))
    ),
    '12M P&L Trend'
  );
  XLSX.writeFile(wb, `fintrack-profit-loss-statement-${getTodayStr()}.xlsx`);
}

export function exportProfitLossToPDF(
  transactions: TransactionRecord[],
  currency: CurrencyCode
): void {
  const model = buildProfitLossExportModel(transactions);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  drawPdfHeader(
    doc,
    'FinTrack Statement of Profit & Loss',
    `Income Statement | Generated ${getTodayStr()} | Currency: ${currency}`
  );

  let y = drawPdfSectionHeading(doc, '1. Horizon Summary (Daily / Monthly / Yearly / All-Time)', 102);
  autoTable(doc, {
    startY: y,
    head: [['Horizon', 'Income', 'Expenses', 'Net Profit / Loss']],
    body: [
      ['Today', formatCurrencyAscii(model.pl.dailyIncome, currency), formatCurrencyAscii(model.pl.dailyExpenses, currency), formatCurrencyAscii(model.pl.dailyProfit, currency)],
      ['Current Month', formatCurrencyAscii(model.pl.monthlyIncome, currency), formatCurrencyAscii(model.pl.monthlyExpenses, currency), formatCurrencyAscii(model.pl.monthlyProfit, currency)],
      ['Previous Month', formatCurrencyAscii(model.pl.prevMonthIncome, currency), formatCurrencyAscii(model.pl.prevMonthExpenses, currency), formatCurrencyAscii(model.pl.prevMonthProfit, currency)],
      ['Current Year', formatCurrencyAscii(model.pl.yearlyIncome, currency), formatCurrencyAscii(model.pl.yearlyExpenses, currency), formatCurrencyAscii(model.pl.yearlyProfit, currency)],
      ['All-Time Cumulative', formatCurrencyAscii(model.allTimeIncome, currency), formatCurrencyAscii(model.allTimeExpenses, currency), formatCurrencyAscii(model.allTimeNet, currency)],
    ],
    styles: { fontSize: 8.5, cellPadding: 4.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });

  y = drawPdfSectionHeading(doc, '2. Revenue & Expense Accounts', getLastTableY(doc) + 22);
  autoTable(doc, {
    startY: y,
    head: [['Section', 'Account / Category', 'Entries', 'Amount', 'Share (%)']],
    body: [
      ...model.incomeCats.map((c) => [
        'Revenue',
        c.category,
        String(c.count),
        formatCurrencyAscii(c.amount, currency),
        `${c.percentage.toFixed(1)}%`,
      ]),
      ['Subtotal', 'Total Income', '', formatCurrencyAscii(model.allTimeIncome, currency), '100.0%'],
      ...model.expenseCats.map((c) => [
        'Expense',
        c.category,
        String(c.count),
        formatCurrencyAscii(c.amount, currency),
        `${c.percentage.toFixed(1)}%`,
      ]),
      ['Subtotal', 'Total Expenses', '', formatCurrencyAscii(model.allTimeExpenses, currency), '100.0%'],
      [
        'Net P&L',
        model.allTimeNet >= 0 ? 'Net Profit / Surplus' : 'Net Loss / Deficit',
        String(transactions.length),
        formatCurrencyAscii(model.allTimeNet, currency),
        model.netMarginPct !== null ? `${model.netMarginPct.toFixed(1)}% margin` : '—',
      ],
    ],
    styles: { fontSize: 8.5, cellPadding: 4.5 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });

  doc.save(`fintrack-profit-loss-statement-${getTodayStr()}.pdf`);
}

// ---------------------------------------------------------------------------
// ERP Balance Sheet Export
// ---------------------------------------------------------------------------

export function exportBalanceSheetToExcel(
  transactions: TransactionRecord[],
  savingsGoals: SavingsGoal[],
  debtRecords: DebtRecord[],
  bills: BillRecord[],
  currency: CurrencyCode
): void {
  const bs = buildBalanceSheetStatement(transactions, savingsGoals, debtRecords, bills);
  const rows = [
    ...bs.assets.map((a) => ({
      StatementSide: 'ASSETS',
      Code: a.code,
      Group: a.group,
      Account: a.label,
      [`Amount (${currency})`]: a.amount,
      Notes: a.note,
    })),
    {
      StatementSide: 'ASSETS TOTAL',
      Code: 'A-999',
      Group: 'Total Assets',
      Account: 'TOTAL ASSETS',
      [`Amount (${currency})`]: bs.totalAssets,
      Notes: `As of ${bs.asOfDate}`,
    },
    ...bs.liabilities.map((l) => ({
      StatementSide: 'LIABILITIES',
      Code: l.code,
      Group: l.group,
      Account: l.label,
      [`Amount (${currency})`]: l.amount,
      Notes: l.note,
    })),
    {
      StatementSide: 'LIABILITIES TOTAL',
      Code: 'L-999',
      Group: 'Total Liabilities',
      Account: 'TOTAL LIABILITIES',
      [`Amount (${currency})`]: bs.totalLiabilities,
      Notes: '',
    },
    {
      StatementSide: 'EQUITY / NET WORTH',
      Code: 'E-300',
      Group: 'Net Worth',
      Account: 'Owner Net Worth (Assets - Liabilities)',
      [`Amount (${currency})`]: bs.netWorth,
      Notes: 'Accounting Equation: Assets = Liabilities + Net Worth',
    },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Balance Sheet');
  XLSX.writeFile(wb, `fintrack-balance-sheet-${getTodayStr()}.xlsx`);
}

export function exportBalanceSheetToPDF(
  transactions: TransactionRecord[],
  savingsGoals: SavingsGoal[],
  debtRecords: DebtRecord[],
  bills: BillRecord[],
  currency: CurrencyCode
): void {
  const bs = buildBalanceSheetStatement(transactions, savingsGoals, debtRecords, bills);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  drawPdfHeader(
    doc,
    'FinTrack Balance Sheet',
    `Statement of Financial Position | As of ${bs.asOfDate} | Currency: ${currency}`
  );

  let y = drawPdfSectionHeading(doc, '1. Assets', 102);
  autoTable(doc, {
    startY: y,
    head: [['Code', 'Category', 'Asset Account', 'Notes', 'Amount']],
    body: [
      ...bs.assets.map((a) => [a.code, a.group, a.label, a.note, formatCurrencyAscii(a.amount, currency)]),
      ['', '', 'TOTAL ASSETS', '', formatCurrencyAscii(bs.totalAssets, currency)],
    ],
    styles: { fontSize: 8.5, cellPadding: 4.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 4: { halign: 'right' } },
  });

  y = drawPdfSectionHeading(doc, '2. Liabilities & Net Worth (Equity)', getLastTableY(doc) + 22);
  autoTable(doc, {
    startY: y,
    head: [['Code', 'Category', 'Liability / Equity Account', 'Notes', 'Amount']],
    body: [
      ...bs.liabilities.map((l) => [l.code, l.group, l.label, l.note, formatCurrencyAscii(l.amount, currency)]),
      ['', '', 'TOTAL LIABILITIES', '', formatCurrencyAscii(bs.totalLiabilities, currency)],
      ['E-300', 'Net Worth', 'Owner Equity / Net Worth', 'Total Assets minus Total Liabilities', formatCurrencyAscii(bs.netWorth, currency)],
      ['', '', 'TOTAL LIABILITIES + NET WORTH', 'Reconciles with Total Assets', formatCurrencyAscii(bs.totalLiabilities + bs.netWorth, currency)],
    ],
    styles: { fontSize: 8.5, cellPadding: 4.5 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 4: { halign: 'right' } },
  });

  doc.save(`fintrack-balance-sheet-${getTodayStr()}.pdf`);
}

// ---------------------------------------------------------------------------
// ERP Trial Balance Export
// ---------------------------------------------------------------------------

export function exportTrialBalanceToExcel(
  transactions: TransactionRecord[],
  currency: CurrencyCode
): void {
  const tb = buildTrialBalance(transactions);
  const rows = [
    ...tb.rows.map((r) => ({
      'Account Code': r.accountCode,
      'Account Name': r.accountName,
      Group: r.accountGroup,
      Entries: r.entryCount,
      [`Debit (${currency})`]: r.debit,
      [`Credit (${currency})`]: r.credit,
    })),
    {
      'Account Code': 'TOTAL',
      'Account Name': tb.isBalanced ? 'Balanced' : 'Unbalanced',
      Group: '',
      Entries: transactions.length,
      [`Debit (${currency})`]: tb.totalDebits,
      [`Credit (${currency})`]: tb.totalCredits,
    },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Trial Balance');
  XLSX.writeFile(wb, `fintrack-trial-balance-${getTodayStr()}.xlsx`);
}

export function exportTrialBalanceToPDF(
  transactions: TransactionRecord[],
  currency: CurrencyCode
): void {
  const tb = buildTrialBalance(transactions);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  drawPdfHeader(
    doc,
    'FinTrack Trial Balance',
    `General Ledger Trial Balance | As of ${getTodayStr()} | Currency: ${currency}`
  );

  autoTable(doc, {
    startY: 102,
    head: [['Code', 'Account Name', 'Group', 'Entries', 'Debit', 'Credit']],
    body: [
      ...tb.rows.map((r) => [
        r.accountCode,
        r.accountName,
        r.accountGroup,
        String(r.entryCount),
        r.debit > 0 ? formatCurrencyAscii(r.debit, currency) : '—',
        r.credit > 0 ? formatCurrencyAscii(r.credit, currency) : '—',
      ]),
      [
        'TOTAL',
        tb.isBalanced ? 'Trial Balance Reconciled' : 'Variance Detected',
        '',
        String(transactions.length),
        formatCurrencyAscii(tb.totalDebits, currency),
        formatCurrencyAscii(tb.totalCredits, currency),
      ],
    ],
    styles: { fontSize: 8.5, cellPadding: 4.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  });

  doc.save(`fintrack-trial-balance-${getTodayStr()}.pdf`);
}

// ---------------------------------------------------------------------------
// ERP AR/AP & Bills Aging Schedule Export
// ---------------------------------------------------------------------------

export function exportArApScheduleToExcel(
  debtRecords: DebtRecord[],
  bills: BillRecord[],
  currency: CurrencyCode
): void {
  const rows = buildArApSchedule(debtRecords, bills).map((r) => ({
    Ref: r.refCode,
    Source: r.source,
    Direction: r.direction,
    'Party / Provider': r.partyOrProvider,
    Title: r.title,
    'Due Date': r.dueDate,
    [`Total (${currency})`]: r.totalAmount,
    [`Paid (${currency})`]: r.paidAmount,
    [`Remaining (${currency})`]: r.remainingAmount,
    Status: r.status,
    'Days Overdue': r.daysOverdue,
    'Aging Bucket': r.agingBucket,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'AR-AP Aging');
  XLSX.writeFile(wb, `fintrack-ar-ap-aging-${getTodayStr()}.xlsx`);
}

export function exportArApScheduleToPDF(
  debtRecords: DebtRecord[],
  bills: BillRecord[],
  currency: CurrencyCode
): void {
  const rows = buildArApSchedule(debtRecords, bills);
  const totalRec = rows.filter((r) => r.direction === 'Receivable').reduce((s, r) => s + r.remainingAmount, 0);
  const totalPay = rows.filter((r) => r.direction === 'Payable').reduce((s, r) => s + r.remainingAmount, 0);

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  drawPdfHeader(
    doc,
    'FinTrack Receivables, Payables & Aging Register',
    `Loans, Debts, Bills & EMIs | As of ${getTodayStr()} | Currency: ${currency}`
  );

  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Open Receivables: ${formatCurrencyAscii(totalRec, currency)}`, 40, 102);
  doc.text(`Open Payables & Bills: ${formatCurrencyAscii(totalPay, currency)}`, 290, 102);

  autoTable(doc, {
    startY: 118,
    head: [['Ref', 'Direction', 'Party / Provider', 'Title', 'Due Date', 'Total', 'Paid', 'Remaining', 'Aging Bucket']],
    body: rows.map((r) => [
      r.refCode,
      r.direction,
      r.partyOrProvider.slice(0, 20),
      r.title.slice(0, 26),
      r.dueDate,
      formatCurrencyAscii(r.totalAmount, currency),
      formatCurrencyAscii(r.paidAmount, currency),
      formatCurrencyAscii(r.remainingAmount, currency),
      r.agingBucket,
    ]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
  });

  doc.save(`fintrack-ar-ap-aging-${getTodayStr()}.pdf`);
}

// ---------------------------------------------------------------------------
// Complete All-in-One ERP Financial Pack (Multi-Sheet Excel & Multi-Section PDF)
// ---------------------------------------------------------------------------

export interface ErpFullPackageInput {
  ownerName: string;
  currency: CurrencyCode;
  transactions: TransactionRecord[];
  savingsGoals: SavingsGoal[];
  budgets: BudgetRecord[];
  debtRecords: DebtRecord[];
  bills: BillRecord[];
  recordPayments: RecordPayment[];
  recurringTransactions: RecurringTransaction[];
}

export function exportErpFullWorkbookToExcel(input: ErpFullPackageInput): void {
  const {
    currency,
    transactions,
    savingsGoals,
    budgets,
    debtRecords,
    bills,
    recordPayments,
    recurringTransactions,
  } = input;

  const today = getTodayStr();
  const stats = buildFinancialStatsSnapshot({
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
  });

  const pl = buildProfitLossExportModel(transactions);
  const bs = buildBalanceSheetStatement(transactions, savingsGoals, debtRecords, bills);
  const tb = buildTrialBalance(transactions);
  const gl = buildGeneralLedgerRows(transactions);
  const cashFlow = buildMonthlySeries(transactions, 12);
  const arAp = buildArApSchedule(debtRecords, bills);

  const currentMonth = getCurrentMonthStr();
  const monthExpenseByCat = new Map<string, number>();
  let monthExpenseTotal = 0;
  transactions.forEach((t) => {
    if (t.type === 'expense' && t.date.startsWith(currentMonth)) {
      monthExpenseTotal += t.amount;
      monthExpenseByCat.set(t.category, (monthExpenseByCat.get(t.category) || 0) + t.amount);
    }
  });

  const wb = XLSX.utils.book_new();

  // Sheet 1: Executive Stats
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Metric: 'All-Time Total Income', Value: stats.allTimeIncome, Currency: currency },
      { Metric: 'All-Time Total Expenses', Value: stats.allTimeExpenses, Currency: currency },
      { Metric: 'Current Cash Balance (Net)', Value: stats.currentCashBalance, Currency: currency },
      { Metric: 'Current Month Net Profit/Loss', Value: stats.monthlyProfit, Currency: currency },
      { Metric: 'Current Year Net Profit/Loss', Value: stats.yearlyProfit, Currency: currency },
      { Metric: 'Total Savings Reserves', Value: stats.totalSavings, Currency: currency },
      { Metric: 'Total Open Receivables & Lent', Value: stats.totalReceivables, Currency: currency },
      { Metric: 'Total Open Payables & Loans', Value: stats.totalPayablesAndLoans, Currency: currency },
      { Metric: 'Pending Bills & EMIs', Value: stats.pendingBillsAndEmis, Currency: currency },
      { Metric: 'Estimated Net Worth (Assets - Liabilities)', Value: stats.netWorth, Currency: currency },
      { Metric: 'Active Recurring Schedules', Value: stats.activeRecurringCount, Currency: 'Count' },
    ]),
    'Executive Stats'
  );

  // Sheet 2: Profit & Loss
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      ...pl.incomeCats.map((c) => ({ Section: 'Income', Category: c.category, Entries: c.count, Amount: c.amount, SharePct: Number(c.percentage.toFixed(2)), Currency: currency })),
      { Section: 'Total Income', Category: 'ALL INCOME', Entries: '', Amount: pl.allTimeIncome, SharePct: 100, Currency: currency },
      ...pl.expenseCats.map((c) => ({ Section: 'Expense', Category: c.category, Entries: c.count, Amount: c.amount, SharePct: Number(c.percentage.toFixed(2)), Currency: currency })),
      { Section: 'Total Expenses', Category: 'ALL EXPENSES', Entries: '', Amount: pl.allTimeExpenses, SharePct: 100, Currency: currency },
      { Section: 'Net P&L', Category: 'NET PROFIT / (LOSS)', Entries: transactions.length, Amount: pl.allTimeNet, SharePct: pl.netMarginPct !== null ? Number(pl.netMarginPct.toFixed(2)) : 'N/A', Currency: currency },
    ]),
    'Profit & Loss'
  );

  // Sheet 3: Balance Sheet
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      ...bs.assets.map((a) => ({ Side: 'Asset', Code: a.code, Group: a.group, Account: a.label, Amount: a.amount, Currency: currency, Notes: a.note })),
      { Side: 'Total Assets', Code: 'A-999', Group: '', Account: 'TOTAL ASSETS', Amount: bs.totalAssets, Currency: currency, Notes: '' },
      ...bs.liabilities.map((l) => ({ Side: 'Liability', Code: l.code, Group: l.group, Account: l.label, Amount: l.amount, Currency: currency, Notes: l.note })),
      { Side: 'Total Liabilities', Code: 'L-999', Group: '', Account: 'TOTAL LIABILITIES', Amount: bs.totalLiabilities, Currency: currency, Notes: '' },
      { Side: 'Equity / Net Worth', Code: 'E-300', Group: 'Net Worth', Account: 'OWNER NET WORTH', Amount: bs.netWorth, Currency: currency, Notes: 'Assets - Liabilities' },
    ]),
    'Balance Sheet'
  );

  // Sheet 4: Trial Balance
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      ...tb.rows.map((r) => ({ Code: r.accountCode, Account: r.accountName, Group: r.accountGroup, Entries: r.entryCount, Debit: r.debit, Credit: r.credit, Currency: currency })),
      { Code: 'TOTAL', Account: tb.isBalanced ? 'Balanced' : 'Variance', Group: '', Entries: transactions.length, Debit: tb.totalDebits, Credit: tb.totalCredits, Currency: currency },
    ]),
    'Trial Balance'
  );

  // Sheet 5: General Ledger
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      gl.map((r) => ({
        Voucher: r.voucherNo,
        Date: r.date,
        Time: r.time,
        Account: r.account,
        Particulars: r.particulars,
        Method: r.paymentMethod,
        Debit: r.debit,
        Credit: r.credit,
        RunningBalance: r.runningBalance,
        Currency: currency,
        Notes: r.notes,
      }))
    ),
    'General Ledger'
  );

  // Sheet 6: 12M Cash Flow
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      cashFlow.map((m) => ({
        Month: m.month,
        Label: m.label,
        Inflow: m.income,
        Outflow: m.expenses,
        NetCashFlow: m.profit,
        Currency: currency,
      }))
    ),
    'Cash Flow 12M'
  );

  // Sheet 7: AR-AP & Bills Aging
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      arAp.map((r) => ({
        Ref: r.refCode,
        Source: r.source,
        Direction: r.direction,
        Party: r.partyOrProvider,
        Title: r.title,
        DueDate: r.dueDate,
        Total: r.totalAmount,
        Paid: r.paidAmount,
        Remaining: r.remainingAmount,
        Status: r.status,
        DaysOverdue: r.daysOverdue,
        AgingBucket: r.agingBucket,
        Currency: currency,
      }))
    ),
    'AR-AP & Bills'
  );

  // Sheet 8: Savings & Budgets
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      ...savingsGoals.map((g) => ({
        Module: 'Savings Goal',
        NameOrCategory: g.name,
        PeriodOrDate: g.targetDate,
        ActualOrSaved: g.savedAmount,
        TargetOrLimit: g.targetAmount,
        Status: g.status,
        Currency: currency,
      })),
      ...budgets.map((b) => {
        const spent =
          b.category === 'Monthly Overall'
            ? monthExpenseTotal
            : monthExpenseByCat.get(b.category) || 0;
        return {
          Module: 'Budget',
          NameOrCategory: b.category,
          PeriodOrDate: b.month,
          ActualOrSaved: spent,
          TargetOrLimit: b.limitAmount,
          Status: spent > b.limitAmount ? 'Exceeded' : 'Active',
          Currency: currency,
        };
      }),
    ]),
    'Savings & Budgets'
  );

  XLSX.writeFile(wb, `fintrack-erp-financial-pack-${today}.xlsx`);
}

export function exportErpFullReportToPDF(input: ErpFullPackageInput): void {
  const {
    ownerName,
    currency,
    transactions,
    savingsGoals,
    budgets,
    debtRecords,
    bills,
    recordPayments,
    recurringTransactions,
  } = input;

  const today = getTodayStr();
  const stats = buildFinancialStatsSnapshot({
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
  });

  const pl = buildProfitLossExportModel(transactions);
  const bs = buildBalanceSheetStatement(transactions, savingsGoals, debtRecords, bills);
  const tb = buildTrialBalance(transactions);
  const gl = buildGeneralLedgerRows(transactions);
  const cashFlow = buildMonthlySeries(transactions, 12);
  const arAp = buildArApSchedule(debtRecords, bills);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  drawPdfHeader(
    doc,
    'FinTrack ERP Complete Financial Package',
    `Account: ${ownerName} | As of ${today} | Currency: ${currency}`
  );

  // 1. Executive Financial Stats
  let y = drawPdfSectionHeading(doc, '1. Executive Financial Statistics', 102);
  autoTable(doc, {
    startY: y,
    head: [['Metric', 'Amount / Value', 'Metric', 'Amount / Value']],
    body: [
      ['All-Time Income', formatCurrencyAscii(stats.allTimeIncome, currency), 'All-Time Expenses', formatCurrencyAscii(stats.allTimeExpenses, currency)],
      ['Current Cash Balance', formatCurrencyAscii(stats.currentCashBalance, currency), 'Total Savings Reserves', formatCurrencyAscii(stats.totalSavings, currency)],
      ['Current Month P&L', formatCurrencyAscii(stats.monthlyProfit, currency), 'Current Year P&L', formatCurrencyAscii(stats.yearlyProfit, currency)],
      ['Open Receivables', formatCurrencyAscii(stats.totalReceivables, currency), 'Pending Payables & Bills', formatCurrencyAscii(stats.totalPendingPayments, currency)],
      ['Total Assets', formatCurrencyAscii(bs.totalAssets, currency), 'Estimated Net Worth', formatCurrencyAscii(bs.netWorth, currency)],
    ],
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' } },
  });

  // 2. Profit & Loss Statement
  y = drawPdfSectionHeading(doc, '2. Profit & Loss Statement (Income Statement)', getLastTableY(doc) + 20);
  autoTable(doc, {
    startY: y,
    head: [['Section', 'Account / Category', 'Entries', 'Amount', 'Share (%)']],
    body: [
      ...pl.incomeCats.map((c) => ['Revenue', c.category, String(c.count), formatCurrencyAscii(c.amount, currency), `${c.percentage.toFixed(1)}%`]),
      ['Subtotal', 'Total Income', '', formatCurrencyAscii(pl.allTimeIncome, currency), '100.0%'],
      ...pl.expenseCats.map((c) => ['Expense', c.category, String(c.count), formatCurrencyAscii(c.amount, currency), `${c.percentage.toFixed(1)}%`]),
      ['Subtotal', 'Total Expenses', '', formatCurrencyAscii(pl.allTimeExpenses, currency), '100.0%'],
      ['Net P&L', pl.allTimeNet >= 0 ? 'Net Surplus' : 'Net Deficit', String(transactions.length), formatCurrencyAscii(pl.allTimeNet, currency), pl.netMarginPct !== null ? `${pl.netMarginPct.toFixed(1)}%` : '—'],
    ],
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
  });

  // 3. Balance Sheet
  y = drawPdfSectionHeading(doc, '3. Balance Sheet (Statement of Financial Position)', getLastTableY(doc) + 20);
  autoTable(doc, {
    startY: y,
    head: [['Code', 'Side / Group', 'Account', 'Amount']],
    body: [
      ...bs.assets.map((a) => [a.code, `Asset · ${a.group}`, a.label, formatCurrencyAscii(a.amount, currency)]),
      ['A-999', 'Total', 'TOTAL ASSETS', formatCurrencyAscii(bs.totalAssets, currency)],
      ...bs.liabilities.map((l) => [l.code, `Liability · ${l.group}`, l.label, formatCurrencyAscii(l.amount, currency)]),
      ['L-999', 'Total', 'TOTAL LIABILITIES', formatCurrencyAscii(bs.totalLiabilities, currency)],
      ['E-300', 'Equity', 'OWNER NET WORTH (Assets - Liabilities)', formatCurrencyAscii(bs.netWorth, currency)],
    ],
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 3: { halign: 'right' } },
  });

  // 4. Trial Balance
  y = drawPdfSectionHeading(doc, '4. Trial Balance', getLastTableY(doc) + 20);
  autoTable(doc, {
    startY: y,
    head: [['Code', 'Account', 'Group', 'Debit', 'Credit']],
    body: [
      ...tb.rows.map((r) => [
        r.accountCode,
        r.accountName,
        r.accountGroup,
        r.debit > 0 ? formatCurrencyAscii(r.debit, currency) : '—',
        r.credit > 0 ? formatCurrencyAscii(r.credit, currency) : '—',
      ]),
      ['TOTAL', tb.isBalanced ? 'Reconciled' : 'Variance', '', formatCurrencyAscii(tb.totalDebits, currency), formatCurrencyAscii(tb.totalCredits, currency)],
    ],
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
  });

  // 5. 12-Month Cash Flow Schedule
  y = drawPdfSectionHeading(doc, '5. 12-Month Cash Flow Statement', getLastTableY(doc) + 20);
  autoTable(doc, {
    startY: y,
    head: [['Month', 'Inflows (Income)', 'Outflows (Expenses)', 'Net Cash Flow']],
    body: cashFlow.map((m) => [
      m.label,
      formatCurrencyAscii(m.income, currency),
      formatCurrencyAscii(m.expenses, currency),
      formatCurrencyAscii(m.profit, currency),
    ]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  });

  // 6. AR/AP & Bills Register
  if (arAp.length > 0) {
    y = drawPdfSectionHeading(doc, '6. Receivables, Payables & Bills Aging', getLastTableY(doc) + 20);
    autoTable(doc, {
      startY: y,
      head: [['Ref', 'Direction', 'Party / Provider', 'Due Date', 'Remaining', 'Aging Bucket']],
      body: arAp.map((r) => [
        r.refCode,
        r.direction,
        r.partyOrProvider.slice(0, 20),
        r.dueDate,
        formatCurrencyAscii(r.remainingAmount, currency),
        r.agingBucket,
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 4: { halign: 'right' } },
    });
  }

  // 7. General Ledger
  y = drawPdfSectionHeading(doc, '7. General Ledger (Chronological Running Balance)', getLastTableY(doc) + 20);
  autoTable(doc, {
    startY: y,
    head: [['Voucher', 'Date', 'Account', 'Particulars', 'Debit', 'Credit', 'Balance']],
    body: gl.length > 0
      ? gl.map((r) => [
          r.voucherNo,
          r.date,
          r.account,
          r.particulars.slice(0, 22),
          r.debit > 0 ? formatCurrencyAscii(r.debit, currency) : '—',
          r.credit > 0 ? formatCurrencyAscii(r.credit, currency) : '—',
          formatCurrencyAscii(r.runningBalance, currency),
        ])
      : [['—', '—', 'No transactions posted yet', '', '—', '—', '0.00']],
    styles: { fontSize: 7.5, cellPadding: 3.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
  });

  doc.save(`fintrack-erp-financial-pack-${today}.pdf`);
}

export function exportJsonBackup(data: Record<string, unknown>, filenamePrefix = 'fintrack-backup'): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  triggerDownload(blob, `${filenamePrefix}-${getTodayStr()}.json`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
