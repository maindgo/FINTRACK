import React, { useMemo, useState } from 'react';
import { CalendarClock, Edit2, History, Plus, Trash2, X } from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { BillFrequency, BillRecord, BillType, RecordStatus } from '../types/finance';
import { EXPENSE_CATEGORIES, FIELD_LIMITS, PAYMENT_METHODS } from '../utils/constants';
import { formatCurrency, formatReadableDate, getTodayStr } from '../utils/formatters';
import {
  createBillRecord,
  deleteBillRecord,
  payBillRecord,
  updateBillRecord,
} from '../services/firestoreService';

const BILL_TYPE_LABELS: Record<BillType, string> = {
  bill: 'Monthly Bill',
  emi: 'EMI Record',
  subscription: 'Subscription',
};

export function BillsEmisPage() {
  const { user, bills, recordPayments, currency } = useFinance();
  const [filterType, setFilterType] = useState<'all' | BillType>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<BillRecord | null>(null);
  const [payingBill, setPayingBill] = useState<BillRecord | null>(null);
  const [historyBill, setHistoryBill] = useState<BillRecord | null>(null);

  // Bill Form
  const [billType, setBillType] = useState<BillType>('bill');
  const [title, setTitle] = useState('');
  const [provider, setProvider] = useState('');
  const [category, setCategory] = useState('Bills');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(getTodayStr());
  const [frequency, setFrequency] = useState<BillFrequency>('monthly');
  const [autoPay, setAutoPay] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Payment Form
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(getTodayStr());
  const [payMethod, setPayMethod] = useState('UPI');
  const [payNote, setPayNote] = useState('');
  const [alsoLogExpense, setAlsoLogExpense] = useState(true);

  const today = getTodayStr();

  const filtered = useMemo(
    () => bills.filter((b) => filterType === 'all' || b.billType === filterType),
    [bills, filterType]
  );

  const summary = useMemo(() => {
    let monthlyCommitment = 0;
    let unpaidDue = 0;
    let overdueCount = 0;

    bills.forEach((b) => {
      if (b.frequency === 'monthly') monthlyCommitment += b.amount;
      if (b.status !== 'paid') {
        unpaidDue += Math.max(0, b.amount - b.paidAmount);
        if (b.status === 'overdue' || b.dueDate < today) overdueCount++;
      }
    });

    return { monthlyCommitment, unpaidDue, overdueCount };
  }, [bills, today]);

  const openCreate = () => {
    setEditing(null);
    setBillType('bill');
    setTitle('');
    setProvider('');
    setCategory('Bills');
    setAmount('');
    setDueDate(getTodayStr());
    setFrequency('monthly');
    setAutoPay(false);
    setNotes('');
    setShowModal(true);
  };

  const openEdit = (b: BillRecord) => {
    setEditing(b);
    setBillType(b.billType);
    setTitle(b.title);
    setProvider(b.provider);
    setCategory(b.category);
    setAmount(String(b.amount));
    setDueDate(b.dueDate);
    setFrequency(b.frequency);
    setAutoPay(b.autoPay);
    setNotes(b.notes);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || !title.trim()) return;

    setSaving(true);
    try {
      if (editing) {
        await updateBillRecord(user.uid, editing.id, {
          billType,
          title: title.trim(),
          provider,
          category,
          amount: amt,
          dueDate,
          frequency,
          status: editing.status,
          autoPay,
          notes,
        });
      } else {
        await createBillRecord(user.uid, {
          billType,
          title: title.trim(),
          provider,
          category,
          amount: amt,
          paidAmount: 0,
          dueDate,
          frequency,
          status: dueDate < today ? 'overdue' : 'unpaid',
          autoPay,
          notes,
        });
      }
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !payingBill) return;
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;

    setSaving(true);
    try {
      await payBillRecord(user.uid, payingBill, amt, payDate, payMethod, payNote, alsoLogExpense);
      setPayingBill(null);
      setPayAmount('');
      setPayNote('');
    } finally {
      setSaving(false);
    }
  };

  const billHistory = useMemo(
    () =>
      historyBill
        ? recordPayments.filter((p) => p.parentKind === 'bill' && p.parentId === historyBill.id)
        : [],
    [recordPayments, historyBill]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Bills, EMIs &amp; Subscriptions
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Track upcoming bills, monthly loan EMIs, and subscriptions with automatic cycle rollover.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Add Bill / EMI
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Monthly Recurring Total</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
            {formatCurrency(summary.monthlyCommitment, currency)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Current Unpaid Due</div>
          <div className="text-xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400 mt-1">
            {formatCurrency(summary.unpaidDue, currency)}
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">Overdue Items</div>
          <div className="text-xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400 mt-1">
            {summary.overdueCount}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
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
          All
        </button>
        {(Object.keys(BILL_TYPE_LABELS) as BillType[]).map((tp) => (
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
            {BILL_TYPE_LABELS[tp]}s
          </button>
        ))}
      </div>

      {/* Bills Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <CalendarClock className="w-10 h-10 text-slate-400 mx-auto" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No bills, EMIs, or subscriptions recorded yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-3 px-5">Title &amp; Provider</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Frequency</th>
                  <th className="py-3 px-4">Due Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                {filtered.map((b) => {
                  const remaining = Math.max(0, b.amount - b.paidAmount);
                  const effStatus: RecordStatus =
                    b.status !== 'paid' && b.dueDate < today ? 'overdue' : b.status;

                  return (
                    <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-5">
                        <div className="font-medium text-slate-900 dark:text-white">{b.title}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {b.provider || b.category}
                          {b.autoPay ? ' · Auto-Pay On' : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">
                        {BILL_TYPE_LABELS[b.billType]}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-500 dark:text-slate-400 capitalize">
                        {b.frequency.replace('_', '-')}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatReadableDate(b.dueDate)}
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold capitalize">
                        <span
                          className={
                            effStatus === 'paid'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : effStatus === 'overdue'
                              ? 'text-red-600 dark:text-red-400'
                              : effStatus === 'partially_paid'
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }
                        >
                          {effStatus.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        {formatCurrency(remaining, currency)}
                        {b.paidAmount > 0 && b.status !== 'paid' && (
                          <div className="text-[10px] font-normal text-slate-400">
                            of {formatCurrency(b.amount, currency)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {b.status !== 'paid' && (
                            <button
                              type="button"
                              onClick={() => {
                                setPayingBill(b);
                                setPayAmount(String(remaining));
                                setPayDate(getTodayStr());
                                setPayNote('');
                                setAlsoLogExpense(true);
                              }}
                              className="px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                            >
                              Pay Now
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setHistoryBill(b)}
                            aria-label="Payment history"
                            className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          {!(b.frequency === 'one_time' && b.status === 'paid') && (
                            <button
                              type="button"
                              onClick={() => openEdit(b)}
                              aria-label="Edit bill"
                              className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => user && deleteBillRecord(user.uid, b.id)}
                            aria-label="Delete bill"
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

      {/* Add/Edit Bill Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editing ? 'Edit Bill / EMI' : 'Add Bill, EMI or Subscription'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Type *
                  </label>
                  <select
                    value={billType}
                    onChange={(e) => setBillType(e.target.value as BillType)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  >
                    <option value="bill">Monthly Bill</option>
                    <option value="emi">EMI Record</option>
                    <option value="subscription">Subscription</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Title *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={FIELD_LIMITS.TITLE_MAX}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Home Wi-Fi / Car EMI"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Provider
                  </label>
                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.PROVIDER_MAX}
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder="e.g., Airtel / HDFC"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Amount *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Frequency
                  </label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as BillFrequency)}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                  >
                    <option value="one_time">One-Time</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
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

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPay}
                  onChange={(e) => setAutoPay(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Auto-pay enabled with provider</span>
              </label>

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
                  {saving ? 'Saving...' : 'Save Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay Bill Modal */}
      {payingBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                Pay · {payingBill.title}
              </h3>
              <button type="button" onClick={() => setPayingBill(null)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handlePay} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Amount *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={Math.max(0.01, payingBill.amount - payingBill.paidAmount)}
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
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alsoLogExpense}
                  onChange={(e) => setAlsoLogExpense(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Also record in Expense ledger</span>
              </label>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Note
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.SHORT_NOTE_MAX}
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPayingBill(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
                >
                  {saving ? 'Processing...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bill Payment History Modal */}
      {historyBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Payment History · {historyBill.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {historyBill.provider || historyBill.category}
                </p>
              </div>
              <button type="button" onClick={() => setHistoryBill(null)} className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 p-5">
              {billHistory.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-6">
                  No payments logged yet.
                </p>
              ) : (
                billHistory.map((p) => (
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
