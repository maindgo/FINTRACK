import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  BillRecord,
  BudgetRecord,
  CurrencyCode,
  DebtRecord,
  RecordPayment,
  RecordStatus,
  RecurringTransaction,
  SavingsContribution,
  SavingsGoal,
  ThemeMode,
  TransactionRecord,
  UserProfile,
} from '../types/finance';
import { FIELD_LIMITS } from '../utils/constants';
import { addFrequencyToDate, getTodayStr } from '../utils/formatters';

export const GUEST_UID = 'guest-local-user';
const GUEST_ACTIVE_KEY = 'fintrack-guest-active';
const GUEST_STORE_KEY = 'fintrack-guest-store-v1';
export const GUEST_EVENT = 'fintrack-guest-updated';

export interface GuestStoreData {
  profile: UserProfile;
  transactions: TransactionRecord[];
  savingsGoals: SavingsGoal[];
  savingsContributions: SavingsContribution[];
  budgets: BudgetRecord[];
  debtRecords: DebtRecord[];
  recordPayments: RecordPayment[];
  bills: BillRecord[];
  recurringTransactions: RecurringTransaction[];
}

function makeId(prefix = 'g'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function clampStr(val: string | undefined, max: number): string {
  return (val ?? '').trim().slice(0, max);
}

function clampAmount(val: number): number {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return 0.01;
  return Math.min(Number(num.toFixed(2)), FIELD_LIMITS.AMOUNT_MAX);
}

function createDefaultGuestStore(): GuestStoreData {
  const savedTheme: ThemeMode =
    typeof window !== 'undefined' && window.localStorage.getItem('fintrack-theme') === 'dark'
      ? 'dark'
      : 'light';

  return {
    profile: {
      uid: GUEST_UID,
      email: 'guest@local.fintrack',
      displayName: 'Guest User',
      currency: 'INR' as CurrencyCode,
      theme: savedTheme,
      monthlyBudgetLimit: 0,
    },
    transactions: [],
    savingsGoals: [],
    savingsContributions: [],
    budgets: [],
    debtRecords: [],
    recordPayments: [],
    bills: [],
    recurringTransactions: [],
  };
}

export function isGuestSessionActive(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(GUEST_ACTIVE_KEY) === '1';
}

export function setGuestSessionActive(active: boolean): void {
  if (typeof window === 'undefined') return;
  if (active) {
    window.localStorage.setItem(GUEST_ACTIVE_KEY, '1');
    if (!window.localStorage.getItem(GUEST_STORE_KEY)) {
      saveGuestStore(createDefaultGuestStore());
    }
  } else {
    window.localStorage.removeItem(GUEST_ACTIVE_KEY);
  }
  window.dispatchEvent(new Event(GUEST_EVENT));
}

export function loadGuestStore(): GuestStoreData {
  if (typeof window === 'undefined') return createDefaultGuestStore();
  try {
    const raw = window.localStorage.getItem(GUEST_STORE_KEY);
    if (!raw) {
      const fresh = createDefaultGuestStore();
      window.localStorage.setItem(GUEST_STORE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<GuestStoreData>;
    const defaults = createDefaultGuestStore();
    return {
      profile: { ...defaults.profile, ...(parsed.profile || {}) },
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      savingsGoals: Array.isArray(parsed.savingsGoals) ? parsed.savingsGoals : [],
      savingsContributions: Array.isArray(parsed.savingsContributions)
        ? parsed.savingsContributions
        : [],
      budgets: Array.isArray(parsed.budgets) ? parsed.budgets : [],
      debtRecords: Array.isArray(parsed.debtRecords) ? parsed.debtRecords : [],
      recordPayments: Array.isArray(parsed.recordPayments) ? parsed.recordPayments : [],
      bills: Array.isArray(parsed.bills) ? parsed.bills : [],
      recurringTransactions: Array.isArray(parsed.recurringTransactions)
        ? parsed.recurringTransactions
        : [],
    };
  } catch {
    return createDefaultGuestStore();
  }
}

export function saveGuestStore(data: GuestStoreData): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GUEST_STORE_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event(GUEST_EVENT));
}

export function clearGuestStoreData(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(GUEST_STORE_KEY);
  window.localStorage.removeItem(GUEST_ACTIVE_KEY);
  window.dispatchEvent(new Event(GUEST_EVENT));
}

export function getGuestRecordCount(): number {
  const s = loadGuestStore();
  return (
    s.transactions.length +
    s.savingsGoals.length +
    s.budgets.length +
    s.debtRecords.length +
    s.bills.length +
    s.recurringTransactions.length
  );
}

// --- Guest Mutations ---
export function guestUpdateProfile(
  updates: Partial<Pick<UserProfile, 'displayName' | 'currency' | 'theme' | 'monthlyBudgetLimit'>>
): void {
  const store = loadGuestStore();
  store.profile = {
    ...store.profile,
    ...(updates.displayName !== undefined
      ? { displayName: clampStr(updates.displayName, FIELD_LIMITS.DISPLAY_NAME_MAX) || 'Guest User' }
      : {}),
    ...(updates.currency !== undefined ? { currency: updates.currency } : {}),
    ...(updates.theme !== undefined ? { theme: updates.theme } : {}),
    ...(updates.monthlyBudgetLimit !== undefined
      ? {
          monthlyBudgetLimit:
            Number.isFinite(Number(updates.monthlyBudgetLimit)) && Number(updates.monthlyBudgetLimit) >= 0
              ? Math.min(Number(updates.monthlyBudgetLimit), FIELD_LIMITS.AMOUNT_MAX)
              : 0,
        }
      : {}),
  };
  saveGuestStore(store);
}

export function guestCreateTransaction(
  input: Omit<TransactionRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): string {
  const store = loadGuestStore();
  const id = makeId('tx');
  store.transactions.unshift({
    id,
    userId: GUEST_UID,
    type: input.type,
    amount: clampAmount(input.amount),
    title: clampStr(input.title, FIELD_LIMITS.TITLE_MAX) || 'Untitled',
    category: input.category,
    date: input.date,
    time: clampStr(input.time, 10),
    paymentMethod: input.paymentMethod,
    description: clampStr(input.description, FIELD_LIMITS.DESCRIPTION_MAX),
    notes: clampStr(input.notes, FIELD_LIMITS.NOTES_MAX),
    receiptName: clampStr(input.receiptName, FIELD_LIMITS.RECEIPT_NAME_MAX),
    receiptDataUrl: (input.receiptDataUrl || '').slice(0, FIELD_LIMITS.RECEIPT_DATA_MAX),
    recurringId: clampStr(input.recurringId, 128),
  });
  saveGuestStore(store);
  return id;
}

export function guestUpdateTransaction(
  id: string,
  input: Omit<TransactionRecord, 'id' | 'userId' | 'recurringId' | 'createdAt' | 'updatedAt'>
): void {
  const store = loadGuestStore();
  store.transactions = store.transactions.map((t) =>
    t.id === id
      ? {
          ...t,
          type: input.type,
          amount: clampAmount(input.amount),
          title: clampStr(input.title, FIELD_LIMITS.TITLE_MAX) || 'Untitled',
          category: input.category,
          date: input.date,
          time: clampStr(input.time, 10),
          paymentMethod: input.paymentMethod,
          description: clampStr(input.description, FIELD_LIMITS.DESCRIPTION_MAX),
          notes: clampStr(input.notes, FIELD_LIMITS.NOTES_MAX),
          receiptName: clampStr(input.receiptName, FIELD_LIMITS.RECEIPT_NAME_MAX),
          receiptDataUrl: (input.receiptDataUrl || '').slice(0, FIELD_LIMITS.RECEIPT_DATA_MAX),
        }
      : t
  );
  saveGuestStore(store);
}

export function guestDeleteTransaction(id: string): void {
  const store = loadGuestStore();
  store.transactions = store.transactions.filter((t) => t.id !== id);
  saveGuestStore(store);
}

export function guestCreateSavingsGoal(
  input: Omit<SavingsGoal, 'id' | 'userId' | 'status' | 'createdAt' | 'updatedAt'>
): string {
  const store = loadGuestStore();
  const id = makeId('goal');
  const targetAmount = clampAmount(input.targetAmount);
  const savedAmount = Math.max(0, Math.min(Number(input.savedAmount) || 0, FIELD_LIMITS.AMOUNT_MAX));
  store.savingsGoals.push({
    id,
    userId: GUEST_UID,
    name: clampStr(input.name, 120) || 'Savings Goal',
    targetAmount,
    savedAmount,
    targetDate: input.targetDate,
    category: clampStr(input.category, FIELD_LIMITS.CATEGORY_MAX) || 'General Savings',
    notes: clampStr(input.notes, FIELD_LIMITS.DESCRIPTION_MAX),
    status: savedAmount >= targetAmount ? 'completed' : 'active',
  });
  saveGuestStore(store);
  return id;
}

export function guestUpdateSavingsGoal(
  id: string,
  input: Pick<SavingsGoal, 'name' | 'targetAmount' | 'targetDate' | 'category' | 'notes'>,
  currentSavedAmount: number
): void {
  const store = loadGuestStore();
  const targetAmount = clampAmount(input.targetAmount);
  store.savingsGoals = store.savingsGoals.map((g) =>
    g.id === id
      ? {
          ...g,
          name: clampStr(input.name, 120) || 'Savings Goal',
          targetAmount,
          targetDate: input.targetDate,
          category: clampStr(input.category, FIELD_LIMITS.CATEGORY_MAX) || 'General Savings',
          notes: clampStr(input.notes, FIELD_LIMITS.DESCRIPTION_MAX),
          status: currentSavedAmount >= targetAmount ? 'completed' : 'active',
        }
      : g
  );
  saveGuestStore(store);
}

export function guestAddSavingsDeposit(
  goal: SavingsGoal,
  depositAmount: number,
  date: string,
  note: string
): void {
  const store = loadGuestStore();
  const cleanDeposit = clampAmount(depositAmount);
  const newSaved = Math.min(Number((goal.savedAmount + cleanDeposit).toFixed(2)), FIELD_LIMITS.AMOUNT_MAX);
  store.savingsGoals = store.savingsGoals.map((g) =>
    g.id === goal.id
      ? {
          ...g,
          savedAmount: newSaved,
          status: newSaved >= g.targetAmount ? 'completed' : 'active',
        }
      : g
  );
  store.savingsContributions.unshift({
    id: makeId('contrib'),
    userId: GUEST_UID,
    goalId: goal.id,
    amount: cleanDeposit,
    date,
    note: clampStr(note, FIELD_LIMITS.SHORT_NOTE_MAX),
  });
  saveGuestStore(store);
}

export function guestDeleteSavingsGoal(goalId: string): void {
  const store = loadGuestStore();
  store.savingsGoals = store.savingsGoals.filter((g) => g.id !== goalId);
  store.savingsContributions = store.savingsContributions.filter((c) => c.goalId !== goalId);
  saveGuestStore(store);
}

export function getGuestSavingsContributions(goalId: string): SavingsContribution[] {
  const store = loadGuestStore();
  return store.savingsContributions
    .filter((c) => c.goalId === goalId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function guestCreateBudget(
  input: Omit<BudgetRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): string {
  const store = loadGuestStore();
  const id = makeId('bdg');
  store.budgets.push({
    id,
    userId: GUEST_UID,
    category: clampStr(input.category, FIELD_LIMITS.CATEGORY_MAX),
    month: input.month,
    limitAmount: clampAmount(input.limitAmount),
    alertThreshold: Math.max(50, Math.min(100, Math.round(input.alertThreshold || 80))),
    notes: clampStr(input.notes, FIELD_LIMITS.SHORT_NOTE_MAX),
  });
  saveGuestStore(store);
  return id;
}

export function guestUpdateBudget(
  id: string,
  input: Omit<BudgetRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): void {
  const store = loadGuestStore();
  store.budgets = store.budgets.map((b) =>
    b.id === id
      ? {
          ...b,
          category: clampStr(input.category, FIELD_LIMITS.CATEGORY_MAX),
          month: input.month,
          limitAmount: clampAmount(input.limitAmount),
          alertThreshold: Math.max(50, Math.min(100, Math.round(input.alertThreshold || 80))),
          notes: clampStr(input.notes, FIELD_LIMITS.SHORT_NOTE_MAX),
        }
      : b
  );
  saveGuestStore(store);
}

export function guestDeleteBudget(id: string): void {
  const store = loadGuestStore();
  store.budgets = store.budgets.filter((b) => b.id !== id);
  saveGuestStore(store);
}

export function guestCreateDebtRecord(
  input: Omit<DebtRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): string {
  const store = loadGuestStore();
  const id = makeId('debt');
  const totalAmount = clampAmount(input.totalAmount);
  const paidAmount = Math.max(0, Math.min(Number(input.paidAmount) || 0, totalAmount));
  const status: RecordStatus =
    paidAmount >= totalAmount
      ? 'paid'
      : paidAmount > 0
      ? 'partially_paid'
      : input.dueDate < getTodayStr()
      ? 'overdue'
      : input.status;

  store.debtRecords.push({
    id,
    userId: GUEST_UID,
    recordType: input.recordType,
    partyName: clampStr(input.partyName, FIELD_LIMITS.PARTY_NAME_MAX) || 'Counterparty',
    title: clampStr(input.title, FIELD_LIMITS.TITLE_MAX) || 'Record',
    totalAmount,
    paidAmount,
    interestRate: Math.max(0, Math.min(100, Number(input.interestRate) || 0)),
    dueDate: input.dueDate,
    status,
    notes: clampStr(input.notes, FIELD_LIMITS.DESCRIPTION_MAX),
  });
  saveGuestStore(store);
  return id;
}

export function guestUpdateDebtRecord(
  id: string,
  input: Omit<DebtRecord, 'id' | 'userId' | 'paidAmount' | 'createdAt' | 'updatedAt'>
): void {
  const store = loadGuestStore();
  store.debtRecords = store.debtRecords.map((d) =>
    d.id === id
      ? {
          ...d,
          recordType: input.recordType,
          partyName: clampStr(input.partyName, FIELD_LIMITS.PARTY_NAME_MAX) || 'Counterparty',
          title: clampStr(input.title, FIELD_LIMITS.TITLE_MAX) || 'Record',
          totalAmount: clampAmount(input.totalAmount),
          interestRate: Math.max(0, Math.min(100, Number(input.interestRate) || 0)),
          dueDate: input.dueDate,
          status: input.status,
          notes: clampStr(input.notes, FIELD_LIMITS.DESCRIPTION_MAX),
        }
      : d
  );
  saveGuestStore(store);
}

export function guestRecordDebtPayment(
  record: DebtRecord,
  paymentAmount: number,
  date: string,
  method: string,
  note: string
): void {
  const store = loadGuestStore();
  const remaining = Math.max(0, Number((record.totalAmount - record.paidAmount).toFixed(2)));
  const cleanPay = Math.min(clampAmount(paymentAmount), remaining > 0 ? remaining : clampAmount(paymentAmount));
  const newPaid = Math.min(record.totalAmount, Number((record.paidAmount + cleanPay).toFixed(2)));
  const newStatus: RecordStatus =
    newPaid >= record.totalAmount
      ? 'paid'
      : newPaid > 0
      ? 'partially_paid'
      : record.dueDate < getTodayStr()
      ? 'overdue'
      : 'unpaid';

  store.debtRecords = store.debtRecords.map((d) =>
    d.id === record.id ? { ...d, paidAmount: newPaid, status: newStatus } : d
  );
  store.recordPayments.unshift({
    id: makeId('pay'),
    userId: GUEST_UID,
    parentKind: 'debt',
    parentId: record.id,
    amount: cleanPay,
    date,
    method: clampStr(method, 40) || 'Bank Transfer',
    note: clampStr(note, FIELD_LIMITS.SHORT_NOTE_MAX),
  });
  saveGuestStore(store);
}

export function guestDeleteDebtRecord(id: string): void {
  const store = loadGuestStore();
  store.debtRecords = store.debtRecords.filter((d) => d.id !== id);
  store.recordPayments = store.recordPayments.filter((p) => !(p.parentKind === 'debt' && p.parentId === id));
  saveGuestStore(store);
}

export function guestCreateBillRecord(
  input: Omit<BillRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
): string {
  const store = loadGuestStore();
  const id = makeId('bill');
  const amount = clampAmount(input.amount);
  const paidAmount = Math.max(0, Math.min(Number(input.paidAmount) || 0, amount));
  store.bills.push({
    id,
    userId: GUEST_UID,
    billType: input.billType,
    title: clampStr(input.title, FIELD_LIMITS.TITLE_MAX) || 'Bill',
    provider: clampStr(input.provider, FIELD_LIMITS.PROVIDER_MAX),
    category: clampStr(input.category, FIELD_LIMITS.CATEGORY_MAX) || 'Bills',
    amount,
    paidAmount,
    dueDate: input.dueDate,
    frequency: input.frequency,
    status: input.status,
    autoPay: Boolean(input.autoPay),
    notes: clampStr(input.notes, FIELD_LIMITS.DESCRIPTION_MAX),
  });
  saveGuestStore(store);
  return id;
}

export function guestUpdateBillRecord(
  id: string,
  input: Omit<BillRecord, 'id' | 'userId' | 'paidAmount' | 'createdAt' | 'updatedAt'>
): void {
  const store = loadGuestStore();
  store.bills = store.bills.map((b) =>
    b.id === id
      ? {
          ...b,
          billType: input.billType,
          title: clampStr(input.title, FIELD_LIMITS.TITLE_MAX) || 'Bill',
          provider: clampStr(input.provider, FIELD_LIMITS.PROVIDER_MAX),
          category: clampStr(input.category, FIELD_LIMITS.CATEGORY_MAX) || 'Bills',
          amount: clampAmount(input.amount),
          dueDate: input.dueDate,
          frequency: input.frequency,
          status: input.status,
          autoPay: Boolean(input.autoPay),
          notes: clampStr(input.notes, FIELD_LIMITS.DESCRIPTION_MAX),
        }
      : b
  );
  saveGuestStore(store);
}

export function guestPayBillRecord(
  bill: BillRecord,
  payAmount: number,
  date: string,
  method: string,
  note: string,
  alsoLogExpense: boolean
): void {
  const store = loadGuestStore();
  const remaining = Math.max(0, Number((bill.amount - bill.paidAmount).toFixed(2)));
  const cleanPay = Math.min(clampAmount(payAmount), remaining > 0 ? remaining : bill.amount);
  const newPaid = Math.min(bill.amount, Number((bill.paidAmount + cleanPay).toFixed(2)));
  const isCycleComplete = newPaid >= bill.amount;

  store.bills = store.bills.map((b) => {
    if (b.id !== bill.id) return b;
    if (isCycleComplete && b.frequency !== 'one_time') {
      return {
        ...b,
        paidAmount: 0,
        dueDate: addFrequencyToDate(b.dueDate, b.frequency),
        status: 'unpaid',
      };
    }
    return {
      ...b,
      paidAmount: newPaid,
      status: isCycleComplete ? 'paid' : 'partially_paid',
    };
  });

  store.recordPayments.unshift({
    id: makeId('pay'),
    userId: GUEST_UID,
    parentKind: 'bill',
    parentId: bill.id,
    amount: cleanPay,
    date,
    method: clampStr(method, 40) || 'UPI',
    note: clampStr(note, FIELD_LIMITS.SHORT_NOTE_MAX),
  });

  if (alsoLogExpense) {
    const validExpenseCategories = [
      'Food', 'Shopping', 'Transport', 'Rent', 'Electricity', 'Internet',
      'Education', 'Healthcare', 'Entertainment', 'Travel', 'EMI', 'Bills', 'Other Expenses',
    ];
    const mappedCategory = validExpenseCategories.includes(bill.category)
      ? (bill.category as TransactionRecord['category'])
      : bill.billType === 'emi'
      ? 'EMI'
      : 'Bills';

    store.transactions.unshift({
      id: makeId('tx'),
      userId: GUEST_UID,
      type: 'expense',
      amount: cleanPay,
      title: clampStr(bill.title, FIELD_LIMITS.TITLE_MAX),
      category: mappedCategory,
      date,
      time: '10:00',
      paymentMethod: (['UPI', 'Bank Transfer', 'Cash', 'Credit Card', 'Debit Card', 'Wallet', 'Net Banking', 'Other'].includes(method)
        ? method
        : 'UPI') as TransactionRecord['paymentMethod'],
      description: clampStr(`Payment for ${bill.billType.toUpperCase()}: ${bill.provider || bill.title}`, FIELD_LIMITS.DESCRIPTION_MAX),
      notes: clampStr(note, FIELD_LIMITS.NOTES_MAX),
      receiptName: '',
      receiptDataUrl: '',
      recurringId: '',
    });
  }

  saveGuestStore(store);
}

export function guestDeleteBillRecord(id: string): void {
  const store = loadGuestStore();
  store.bills = store.bills.filter((b) => b.id !== id);
  store.recordPayments = store.recordPayments.filter((p) => !(p.parentKind === 'bill' && p.parentId === id));
  saveGuestStore(store);
}

export function guestCreateRecurringTransaction(
  input: Omit<RecurringTransaction, 'id' | 'userId' | 'lastRunDate' | 'createdAt' | 'updatedAt'>
): string {
  const store = loadGuestStore();
  const id = makeId('rec');
  store.recurringTransactions.push({
    id,
    userId: GUEST_UID,
    type: input.type,
    title: clampStr(input.title, FIELD_LIMITS.TITLE_MAX) || 'Recurring Entry',
    amount: clampAmount(input.amount),
    category: input.category,
    paymentMethod: input.paymentMethod,
    frequency: input.frequency,
    startDate: input.startDate,
    nextRunDate: input.nextRunDate || input.startDate,
    lastRunDate: '',
    isActive: Boolean(input.isActive),
    description: clampStr(input.description, FIELD_LIMITS.DESCRIPTION_MAX),
  });
  saveGuestStore(store);
  return id;
}

export function guestToggleRecurringActive(id: string, isActive: boolean): void {
  const store = loadGuestStore();
  store.recurringTransactions = store.recurringTransactions.map((r) =>
    r.id === id ? { ...r, isActive } : r
  );
  saveGuestStore(store);
}

export function guestRunRecurringTransactionNow(rule: RecurringTransaction): void {
  const store = loadGuestStore();
  const runDate = rule.nextRunDate <= getTodayStr() ? rule.nextRunDate : getTodayStr();
  const nextDate = addFrequencyToDate(rule.nextRunDate, rule.frequency);

  store.transactions.unshift({
    id: makeId('tx'),
    userId: GUEST_UID,
    type: rule.type,
    amount: clampAmount(rule.amount),
    title: clampStr(rule.title, FIELD_LIMITS.TITLE_MAX),
    category: rule.category,
    date: runDate,
    time: '09:00',
    paymentMethod: rule.paymentMethod,
    description: clampStr(rule.description || `Recurring (${rule.frequency})`, FIELD_LIMITS.DESCRIPTION_MAX),
    notes: '',
    receiptName: '',
    receiptDataUrl: '',
    recurringId: rule.id,
  });

  store.recurringTransactions = store.recurringTransactions.map((r) =>
    r.id === rule.id ? { ...r, lastRunDate: runDate, nextRunDate: nextDate } : r
  );
  saveGuestStore(store);
}

export function guestDeleteRecurringTransaction(id: string): void {
  const store = loadGuestStore();
  store.recurringTransactions = store.recurringTransactions.filter((r) => r.id !== id);
  saveGuestStore(store);
}

// --- Migrate Local Guest Records into Verified Cloud Firestore ---
export async function migrateGuestStoreToFirestore(uid: string): Promise<number> {
  const store = loadGuestStore();
  const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  for (const t of store.transactions) {
    const newId = doc(collection(db, '_ids')).id;
    operations.push((batch) => {
      batch.set(doc(db, 'users', uid, 'transactions', newId), {
        userId: uid,
        type: t.type,
        amount: clampAmount(t.amount),
        title: clampStr(t.title, FIELD_LIMITS.TITLE_MAX) || 'Untitled',
        category: t.category,
        date: t.date,
        time: clampStr(t.time, 10),
        paymentMethod: t.paymentMethod,
        description: clampStr(t.description, FIELD_LIMITS.DESCRIPTION_MAX),
        notes: clampStr(t.notes, FIELD_LIMITS.NOTES_MAX),
        receiptName: clampStr(t.receiptName, FIELD_LIMITS.RECEIPT_NAME_MAX),
        receiptDataUrl: (t.receiptDataUrl || '').slice(0, FIELD_LIMITS.RECEIPT_DATA_MAX),
        recurringId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  for (const g of store.savingsGoals) {
    const newGoalId = doc(collection(db, '_ids')).id;
    operations.push((batch) => {
      batch.set(doc(db, 'users', uid, 'savingsGoals', newGoalId), {
        userId: uid,
        name: clampStr(g.name, 120) || 'Savings Goal',
        targetAmount: clampAmount(g.targetAmount),
        savedAmount: Math.max(0, Math.min(g.savedAmount, FIELD_LIMITS.AMOUNT_MAX)),
        targetDate: g.targetDate,
        category: clampStr(g.category, FIELD_LIMITS.CATEGORY_MAX) || 'General Savings',
        notes: clampStr(g.notes, FIELD_LIMITS.DESCRIPTION_MAX),
        status: g.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  for (const b of store.budgets) {
    const newId = doc(collection(db, '_ids')).id;
    operations.push((batch) => {
      batch.set(doc(db, 'users', uid, 'budgets', newId), {
        userId: uid,
        category: clampStr(b.category, FIELD_LIMITS.CATEGORY_MAX),
        month: b.month,
        limitAmount: clampAmount(b.limitAmount),
        alertThreshold: Math.max(50, Math.min(100, Math.round(b.alertThreshold || 80))),
        notes: clampStr(b.notes, FIELD_LIMITS.SHORT_NOTE_MAX),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  for (const d of store.debtRecords) {
    const newId = doc(collection(db, '_ids')).id;
    operations.push((batch) => {
      batch.set(doc(db, 'users', uid, 'debtRecords', newId), {
        userId: uid,
        recordType: d.recordType,
        partyName: clampStr(d.partyName, FIELD_LIMITS.PARTY_NAME_MAX) || 'Counterparty',
        title: clampStr(d.title, FIELD_LIMITS.TITLE_MAX) || 'Record',
        totalAmount: clampAmount(d.totalAmount),
        paidAmount: Math.max(0, Math.min(d.paidAmount, d.totalAmount)),
        interestRate: Math.max(0, Math.min(100, Number(d.interestRate) || 0)),
        dueDate: d.dueDate,
        status: d.status,
        notes: clampStr(d.notes, FIELD_LIMITS.DESCRIPTION_MAX),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  for (const bill of store.bills) {
    const newId = doc(collection(db, '_ids')).id;
    operations.push((batch) => {
      batch.set(doc(db, 'users', uid, 'bills', newId), {
        userId: uid,
        billType: bill.billType,
        title: clampStr(bill.title, FIELD_LIMITS.TITLE_MAX) || 'Bill',
        provider: clampStr(bill.provider, FIELD_LIMITS.PROVIDER_MAX),
        category: clampStr(bill.category, FIELD_LIMITS.CATEGORY_MAX) || 'Bills',
        amount: clampAmount(bill.amount),
        paidAmount: Math.max(0, Math.min(bill.paidAmount, bill.amount)),
        dueDate: bill.dueDate,
        frequency: bill.frequency,
        status: bill.status,
        autoPay: Boolean(bill.autoPay),
        notes: clampStr(bill.notes, FIELD_LIMITS.DESCRIPTION_MAX),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  for (const rec of store.recurringTransactions) {
    const newId = doc(collection(db, '_ids')).id;
    operations.push((batch) => {
      batch.set(doc(db, 'users', uid, 'recurringTransactions', newId), {
        userId: uid,
        type: rec.type,
        title: clampStr(rec.title, FIELD_LIMITS.TITLE_MAX) || 'Recurring Entry',
        amount: clampAmount(rec.amount),
        category: rec.category,
        paymentMethod: rec.paymentMethod,
        frequency: rec.frequency,
        startDate: rec.startDate,
        nextRunDate: rec.nextRunDate,
        lastRunDate: rec.lastRunDate || '',
        isActive: Boolean(rec.isActive),
        description: clampStr(rec.description, FIELD_LIMITS.DESCRIPTION_MAX),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
  }

  try {
    for (let i = 0; i < operations.length; i += 400) {
      const batch = writeBatch(db);
      operations.slice(i, i + 400).forEach((fn) => fn(batch));
      await batch.commit();
    }
    clearGuestStoreData();
    return operations.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }
}
