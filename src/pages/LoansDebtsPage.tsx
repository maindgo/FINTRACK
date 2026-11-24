import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Edit2,
  HandCoins,
  History,
  PiggyBank,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { DebtRecord, DebtRecordType, RecordStatus } from '../types/finance';
import { FIELD_LIMITS, PAYMENT_METHODS } from '../utils/constants';
import { computeSavingsAndCashSummary } from '../utils/analytics';
import { formatCurrency, formatReadableDate, getTodayStr } from '../utils/formatters';
import {
  createDebtRecord,
  deleteDebtRecord,
  recordDebtPayment,
  updateDebtRecord,
} from '../services/firestoreService';

const TYPE_LABELS: Record<DebtRecordType, string> = {
  lent: 'Money Lent',
  borrowed: 'Money Borrowed',
  receivable: 'Pending Receivable',
  payable: 'Pending Payable',
  loan: 'Loan Record',
};

const STATUS_LABELS: Record<RecordStatus, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
};

export function LoansDebtsPage() {
  const { user, debtRecords, recordPayments, transactions, savingsGoals, currency } = useFinance();
  const [filterType, setFilterType] = useState<'all' | DebtRecordType>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<DebtRecord | null>(null);
  const [payingRecord, setPayingRecord] = useState<DebtRecord | null>(null);
  const [historyRecord, setHistoryRecord] = useState<DebtRecord | null>(null);
  const [lastImpactNotice, setLastImpactNotice] = useState<{
    direction: 'increase' | 'decrease';
    amount: number;
    partyName: string;
    newTotalSaving: number;
  } | null>(null);

  // Record Form
  const [recordType, setRecordType] = useState<DebtRecordType>('lent');
  const [partyName, setPartyName] = useState('');
  const [title, setTitle] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [interestRate, setInterestRate] = useState('0');
  const [dueDate, setDueDate] = useState(getTodayStr());
  const [status, setStatus] = useState<RecordStatus>('unpaid');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Payment Form
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(getTodayStr());
  const [payMethod, setPayMethod] = useState('Bank Transfer');
  const [payNote, setPayNote] = useState('');

  const today = getTodayStr();

  const filtered = useMemo(
    () =>
      debtRecords.filter((d) => filterType === 'all' || d.recordType === filterType),
    [debtRecords, filterType]
  );

  const summary = useMemo(() => {
    let totalReceivable = 0;
    let totalPayable = 0;
    let overdueCount = 0;

    debtRecords.forEach((d) => {
      const rem = Math.max(0, d.totalAmount - d.paidAmount);
      if (d.status !== 'paid') {
        if (d.recordType === 'lent' || d.recordType === 'receivable') {
          totalReceivable += rem;
        } else {
          totalPayable += rem;
        }
        if (d.status === 'overdue' || d.dueDate < today) overdueCount++;
      }
    });

    return { totalReceivable, totalPayable, overdueCount };
  }, [debtRecords, today]);

  const savingsSummary = useMemo(
    () => computeSavingsAndCashSummary(transactions, savingsGoals, debtRecords),
    [transactions, savingsGoals, debtRecords]
  );

  const openCreate = () => {
    setEditing(null);
    setRecordType('lent');
    setPartyName('');
    setTitle('');
    setTotalAmount('');
    setInterestRate('0');
    setDueDate(getTodayStr());
    setStatus('unpaid');
    setNotes('');
    setShowModal(true);
  };

  const openEdit = (r: DebtRecord) => {
    setEditing(r);
    setRecordType(r.recordType);
    setPartyName(r.partyName);
    setTitle(r.title);
    setTotalAmount(String(r.totalAmount));
    setInterestRate(String(r.interestRate));
    setDueDate(r.dueDate);
    setStatus(r.status);
    setNotes(r.notes);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const tAmt = Number(totalAmount);
    const rate = Number(interestRate || 0);
    if (!Number.isFinite(tAmt) || tAmt <= 0 || !partyName.trim() || !title.trim()) return;

    setSaving(true);
    try {
      if (editing) {
        await updateDebtRecord(user.uid, editing.id, {
          recordType,
          partyName: partyName.trim(),
          title: title.trim(),
          totalAmount: tAmt,
          interestRate: rate,
          dueDate,
          status,
          notes,
        });
      } else {
        await createDebtRecord(user.uid, {
          recordType,
          partyName: partyName.trim(),
          title: title.trim(),
          totalAmount: tAmt,
          paidAmount: 0,
          interestRate: rate,
          dueDate,
          status,
          notes,
        });
      }
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !payingRecord) return;
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    const remaining = Math.max(0, Number((payingRecord.totalAmount - payingRecord.paidAmount).toFixed(2)));
    const effectiveAmt = Math.min(amt, remaining > 0 ? remaining : amt);
    const isReceivable =
      payingRecord.recordType === 'lent' || payingRecord.recordType === 'receivable';
    const projectedSaving = isReceivable
      ? savingsSummary.totalSavingRightNow + effectiveAmt
      : savingsSummary.totalSavingRightNow - effectiveAmt;

    setSaving(true);
    try {
      await recordDebtPayment(user.uid, payingRecord, amt, payDate, payMethod, payNote);
      setLastImpactNotice({
        direction: isReceivable ? 'increase' : 'decrease',
        amount: effectiveAmt,
        partyName: payingRecord.partyName,
        newTotalSaving: projectedSaving,
      });
      setPayingRecord(null);
      setPayAmount('');
      setPayNote('');
    } finally {
      setSaving(false);
    }
  };

  const selectedHistory = useMemo(
    () =>
      historyRecord
        ? recordPayments.filter(
            (p) => p.parentKind === 'debt' && p.parentId === historyRecord.id
          )
        : [],
    [recordPayments, historyRecord]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Loans &amp; Debts
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Track money lent, money borrowed, pending receivables, payables, loans, and settlement history.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Add Financial Record
        </button>
      </div>

      {/* Post-Payment Total Saving Impact Confirmation */}
      {lastImpactNotice && (
        <div
          className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 text-xs ${
            lastImpactNotice.direction === 'increase'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {lastImpactNotice.direction === 'increase' ? (
              <ArrowDownLeft className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <ArrowUpRight className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            )}
            <span>
              {lastImpactNotice.direction === 'increase' ? (
                <>
                  Received <span className="font-mono font-semibold">{formatCurrency(lastImpactNotice.amount, currency)}</span> from{' '}
                  <span className="font-semibold">{lastImpactNotice.partyName}</span> — Total Saving{' '}
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">increased</span> to{' '}
                  <span className="font-mono font-bold">{formatCurrency(lastImpactNotice.newTotalSaving, currency)}</span>.
                </>
              ) : (
                <>
                  Paid <span className="font-mono font-semibold">{formatCurrency(lastImpactNotice.amount, currency)}</span> to{' '}
                  <span className="font-semibold">{lastImpactNotice.partyName}</span> — Total Saving{' '}
                  <span className="font-semibold text-red-700 dark:text-red-300">decreased</span> to{' '}
                  <span className="font-mono font-bold">{formatCurrency(lastImpactNotice.newTotalSaving, currency)}</span>.
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLastImpactNotice(null)}
            aria-label="Dismiss notice"
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Pending Receivables / Lent</div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
            {formatCurrency(summary.totalReceivable, currency)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
            Received back: +{formatCurrency(savingsSummary.debtRecoveredIn, currency)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Pending Payables / Loans</div>
          <div className="text-xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400 mt-1">
            {formatCurrency(summary.totalPayable, currency)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
            Paid back: −{formatCurrency(savingsSummary.debtPaidOut, currency)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Overdue Items</div>
          <div className="text-xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1">
            {summary.overdueCount}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Past due date &amp; unpaid
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs text-slate-500 dark:text-slate-400">Total Saving Right Now</span>
            <PiggyBank className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          </div>
          <div
            className={`text-xl font-bold font-mono tabular-nums mt-1 ${
              savingsSummary.totalSavingRightNow >= 0
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {formatCurrency(savingsSummary.totalSavingRightNow, currency)}
          </div>
          <div className="text-[11px] font-mono mt-1">
            <span className="text-slate-500 dark:text-slate-400">Net debt impact: </span>
            <span
              className={
                savingsSummary.netDebtCashImpact >= 0
                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : 'text-red-600 dark:text-red-400 font-semibold'
              }
            >
              {savingsSummary.netDebtCashImpact >= 0 ? '+' : ''}
              {formatCurrency(savingsSummary.netDebtCashImpact, currency)}
            </span>
          </div>
        </div>
      </div>

      {/* Type Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-fit">
        <button
          type="button"
          onClick={() => setFilterType('all')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium ${
            filterType === 'all'
              ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400'
          }`}
        >
          All Records
        </button>
        {(Object.keys(TYPE_LABELS) as DebtRecordType[]).map((tp) => (
          <button
            key={tp}
            type="button"
            onClick={() => setFilterType(tp)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
              filterType === tp
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {TYPE_LABELS[tp]}
          </button>
        ))}
      </div>

      {/* Records Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <HandCoins className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No loan, receivable, or payable records found.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-3 px-5">Type</th>
                  <th className="py-3 px-4">Counterparty &amp; Title</th>
                  <th className="py-3 px-4">Due Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Paid / Total</th>
                  <th className="py-3 px-4 text-right">Remaining</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                {filtered.map((rec) => {
                  const remaining = Math.max(0, rec.totalAmount - rec.paidAmount);
                  const effectiveStatus: RecordStatus =
                    rec.status !== 'paid' && rec.dueDate < today ? 'overdue' : rec.status;

                  return (
                    <tr key={rec.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-5 text-xs font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {TYPE_LABELS[rec.recordType]}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 dark:text-white">{rec.partyName}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {rec.title}
                          {rec.interestRate > 0 ? ` · ${rec.interestRate}% APR` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatReadableDate(rec.dueDate)}
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold">
                        <span
                          className={
                            effectiveStatus === 'paid'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : effectiveStatus === 'overdue'
                              ? 'text-red-600 dark:text-red-400'
                              : effectiveStatus === 'partially_paid'
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }
                        >
                          {STATUS_LABELS[effectiveStatus]}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {formatCurrency(rec.paidAmount, currency)} / {formatCurrency(rec.totalAmount, currency)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        {formatCurrency(remaining, currency)}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {rec.status !== 'paid' && (
                            <button
                              type="button"
                              onClick={() => {
                                setPayingRecord(rec);
                                setPayAmount(String(remaining));
                                setPayDate(getTodayStr());
                                setPayNote('');
                              }}
                              className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                            >
                              {rec.recordType === 'lent' || rec.recordType === 'receivable'
                                ? 'Record Receipt'
                                : 'Record Payment'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setHistoryRecord(rec)}
                            aria-label="View payment history"
                            className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          {rec.status !== 'paid' && (
                            <button
                              type="button"
                              onClick={() => openEdit(rec)}
                              aria-label="Edit record"
                              className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => user && deleteDebtRecord(user.uid, rec.id)}
                            aria-label="Delete record"
                            className="p-1.5 rounded text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editing ? 'Edit Financial Record' : 'New Financial Record'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Record Type *
                  </label>
                  <select
                    value={recordType}
                    onChange={(e) => setRecordType(e.target.value as DebtRecordType)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  >
                    {(Object.keys(TYPE_LABELS) as DebtRecordType[]).map((k) => (
                      <option key={k} value={k}>
                        {TYPE_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Person / Institution *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={FIELD_LIMITS.PARTY_NAME_MAX}
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                    placeholder="e.g., Rohan Verma / HDFC Bank"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Title / Purpose *
                </label>
                <input
                  type="text"
                  required
                  maxLength={FIELD_LIMITS.TITLE_MAX}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Personal Loan / Freelance Invoice #14"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Total Amount *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Interest (%)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Due Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Notes
                </label>
                <textarea
                  rows={2}
                  maxLength={FIELD_LIMITS.DESCRIPTION_MAX}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold"
                >
                  {saving ? 'Saving...' : 'Save Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {payingRecord && (() => {
        const isReceivable =
          payingRecord.recordType === 'lent' || payingRecord.recordType === 'receivable';
        const parsedAmt = Math.max(0, Number(payAmount) || 0);
        const projectedSaving = isReceivable
          ? savingsSummary.totalSavingRightNow + parsedAmt
          : savingsSummary.totalSavingRightNow - parsedAmt;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
            <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                  {isReceivable ? 'Receive Repayment' : 'Pay Borrowed Amount'} · {payingRecord.partyName}
                </h3>
                <button type="button" onClick={() => setPayingRecord(null)} className="p-1 text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handlePayment} className="p-5 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    {isReceivable ? 'Amount Received *' : 'Amount Paid *'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={Math.max(0.01, payingRecord.totalAmount - payingRecord.paidAmount)}
                    required
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={payDate}
                      onChange={(e) => setPayDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Method
                    </label>
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Reference / Note
                  </label>
                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.SHORT_NOTE_MAX}
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>

                {/* Live Impact on Total Saving Preview */}
                <div
                  className={`rounded-lg border p-3 text-xs space-y-1.5 ${
                    isReceivable
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                      : 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                  }`}
                >
                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                    Impact on Total Saving
                  </div>
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                    <span>Current Total Saving</span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(savingsSummary.totalSavingRightNow, currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300">
                      {isReceivable ? 'Amount Received (+)' : 'Borrowed Paid Out (−)'}
                    </span>
                    <span
                      className={`font-mono tabular-nums font-semibold ${
                        isReceivable
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {isReceivable ? '+' : '−'}
                      {formatCurrency(parsedAmt, currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/80 dark:border-slate-700/80 font-semibold text-slate-900 dark:text-white">
                    <span>Total Saving After Entry</span>
                    <span className="font-mono tabular-nums">
                      {formatCurrency(projectedSaving, currency)}
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPayingRecord(null)}
                    className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                  >
                    {saving
                      ? 'Recording...'
                      : isReceivable
                      ? 'Confirm Receipt'
                      : 'Confirm Payment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* History Modal */}
      {historyRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Payment History · {historyRecord.partyName}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {historyRecord.title}
                </p>
              </div>
              <button type="button" onClick={() => setHistoryRecord(null)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 p-5">
              {selectedHistory.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-6">
                  No payments recorded against this item yet.
                </p>
              ) : (
                selectedHistory.map((p) => (
                  <div key={p.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-mono text-slate-500 dark:text-slate-400">
                        {formatReadableDate(p.date)} · {p.method}
                      </div>
                      {p.note && <div className="text-slate-800 dark:text-slate-200 mt-0.5">{p.note}</div>}
                    </div>
                    <span className="font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(p.amount, currency)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
