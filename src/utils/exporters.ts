import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CurrencyCode, TransactionRecord } from '../types/finance';
import { formatCurrencyAscii, getTodayStr } from './formatters';

function escapeCsvField(val: string | number): string {
  const str = String(val ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportTransactionsToCSV(
  transactions: TransactionRecord[],
  currency: CurrencyCode,
  filenamePrefix = 'fintrack-transactions'
): void {
  const headers = ['Date', 'Time', 'Type', 'Title', 'Category', 'Amount', 'Currency', 'Payment Method', 'Description', 'Notes'];
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

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 82, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text(reportTitle, 40, 38);

  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text(subtitle || `Generated on ${getTodayStr()} | Currency: ${currency}`, 40, 58);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.text(`Total Income: ${formatCurrencyAscii(totalIncome, currency)}`, 40, 108);
  doc.text(`Total Expenses: ${formatCurrencyAscii(totalExpenses, currency)}`, 220, 108);
  doc.text(`Net P&L: ${formatCurrencyAscii(netProfit, currency)}`, 400, 108);

  const tableRows = transactions.map((t) => [
    t.date,
    t.type === 'income' ? 'Income' : 'Expense',
    t.title.slice(0, 32),
    t.category,
    t.paymentMethod,
    `${t.type === 'income' ? '+' : '-'}${formatCurrencyAscii(t.amount, currency)}`,
  ]);

  autoTable(doc, {
    startY: 126,
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

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 78, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(17);
  doc.text(title, 40, 36);
  doc.setFontSize(9.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`FinTrack Smart Money Manager | Generated ${getTodayStr()}`, 40, 56);

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
