import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AccountStatus,
  BillRecord,
  BudgetRecord,
  CurrencyCode,
  DebtRecord,
  MaintenanceConfig,
  RecurringTransaction,
  RecordStatus,
  SavingsGoal,
  ThemeMode,
  TransactionRecord,
  UserProfile,
} from '../types/finance';
import {
  ADMIN_EMAIL,
  DEFAULT_ADMIN_MESSAGE_HEADING,
  FIELD_LIMITS,
} from '../utils/constants';
import { addFrequencyToDate, getTodayStr } from '../utils/formatters';
import {
  clearGuestStoreData,
  GUEST_UID,
  guestAddSavingsDeposit,
  guestCreateBillRecord,
  guestCreateBudget,
  guestCreateDebtRecord,
  guestCreateRecurringTransaction,
  guestCreateSavingsGoal,
  guestCreateTransaction,
  guestDeleteBillRecord,
  guestDeleteBudget,
  guestDeleteDebtRecord,
  guestDeleteRecurringTransaction,
  guestDeleteSavingsGoal,
  guestDeleteTransaction,
  guestPayBillRecord,
  guestRecordDebtPayment,
  guestRunRecurringTransactionNow,
  guestToggleRecurringActive,
  guestUpdateBillRecord,
  guestUpdateBudget,
  guestUpdateDebtRecord,
  guestUpdateProfile,
  guestUpdateSavingsGoal,
  guestUpdateTransaction,
} from './guestStore';

function generateDocId(): string {
  return doc(collection(db, '_ids')).id;
}

function clampStr(val: string | undefined, max: number): string {
  return (val ?? '').trim().slice(0, max);
}

function clampAmount(val: number): number {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return 0.01;
  return Math.min(Number(num.toFixed(2)), FIELD_LIMITS.AMOUNT_MAX);
}

// --- User Profile ---
export async function ensureUserProfile(
  uid: string,
  email: string,
  displayName: string
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const ref = doc(db, 'users', uid);
    const initialTheme: ThemeMode =
      typeof window !== 'undefined' && window.localStorage.getItem('fintrack-theme') === 'dark'
        ? 'dark'
        : 'light';
    await setDoc(
      ref,
      {
        uid,
        email: clampStr(email, 160) || 'user@fintrack.app',
        displayName: clampStr(displayName, FIELD_LIMITS.DISPLAY_NAME_MAX) || 'FinTrack User',
        currency: 'INR' as CurrencyCode,
        theme: initialTheme,
        monthlyBudgetLimit: 0,
        openingBankBalance: 0,
        openingCashBalance: 0,
        accountStatus: 'active' as AccountStatus,
        deactivatedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: false }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateUserProfile(
  uid: string,
  updates: Partial<
    Pick<
      UserProfile,
      'displayName' | 'currency' | 'theme' | 'monthlyBudgetLimit' | 'openingBankBalance' | 'openingCashBalance'
    >
  >
): Promise<void> {
  if (uid === GUEST_UID) {
    guestUpdateProfile(updates);
    return;
  }
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.displayName !== undefined) {
      payload.displayName = clampStr(updates.displayName, FIELD_LIMITS.DISPLAY_NAME_MAX) || 'FinTrack User';
    }
    if (updates.currency !== undefined) {
      payload.currency = updates.currency;
    }
    if (updates.theme !== undefined) {
      payload.theme = updates.theme;
    }
    if (updates.monthlyBudgetLimit !== undefined) {
      const val = Number(updates.monthlyBudgetLimit);
      payload.monthlyBudgetLimit = Number.isFinite(val) && val >= 0 ? Math.min(val, FIELD_LIMITS.AMOUNT_MAX) : 0;
    }
    if (updates.openingBankBalance !== undefined) {
      const val = Number(updates.openingBankBalance);
      payload.openingBankBalance =
        Number.isFinite(val) && val >= 0 ? Math.min(Number(val.toFixed(2)), FIELD_LIMITS.AMOUNT_MAX) : 0;
    }
    if (updates.openingCashBalance !== undefined) {
      const val = Number(updates.openingCashBalance);
      payload.openingCashBalance =
        Number.isFinite(val) && val >= 0 ? Math.min(Number(val.toFixed(2)), FIELD_LIMITS.AMOUNT_MAX) : 0;
    }
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// --- Transactions (Income & Expenses) ---
export type TransactionInput = Omit<TransactionRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;

export async function createTransaction(uid: string, input: TransactionInput): Promise<string> {
  if (uid === GUEST_UID) {
    return guestCreateTransaction(input);
  }
  const id = generateDocId();
  const path = `users/${uid}/transactions/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'transactions', id), {
      userId: uid,
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTransaction(
  uid: string,
  id: string,
  input: Omit<TransactionInput, 'recurringId'>
): Promise<void> {
  if (uid === GUEST_UID) {
    guestUpdateTransaction(id, input);
    return;
  }
  const path = `users/${uid}/transactions/${id}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'transactions', id), {
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
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTransaction(uid: string, id: string): Promise<void> {
  if (uid === GUEST_UID) {
    guestDeleteTransaction(id);
    return;
  }
  const path = `users/${uid}/transactions/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'transactions', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Savings Goals & Contributions ---
export type SavingsGoalInput = Omit<SavingsGoal, 'id' | 'userId' | 'status' | 'createdAt' | 'updatedAt'>;

export async function createSavingsGoal(uid: string, input: SavingsGoalInput): Promise<string> {
  if (uid === GUEST_UID) {
    return guestCreateSavingsGoal(input);
  }
  const id = generateDocId();
  const path = `users/${uid}/savingsGoals/${id}`;
  const targetAmount = clampAmount(input.targetAmount);
  const savedAmount = Math.max(0, Math.min(Number(input.savedAmount) || 0, FIELD_LIMITS.AMOUNT_MAX));
  const status = savedAmount >= targetAmount ? 'completed' : 'active';
  try {
    await setDoc(doc(db, 'users', uid, 'savingsGoals', id), {
      userId: uid,
      name: clampStr(input.name, 120) || 'Savings Goal',
      targetAmount,
      savedAmount,
      targetDate: input.targetDate,
      category: clampStr(input.category, FIELD_LIMITS.CATEGORY_MAX) || 'General Savings',
      notes: clampStr(input.notes, FIELD_LIMITS.DESCRIPTION_MAX),
      status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSavingsGoal(
  uid: string,
  id: string,
  input: Pick<SavingsGoal, 'name' | 'targetAmount' | 'targetDate' | 'category' | 'notes'>,
  currentSavedAmount: number
): Promise<void> {
  if (uid === GUEST_UID) {
    guestUpdateSavingsGoal(id, input, currentSavedAmount);
    return;
  }
  const path = `users/${uid}/savingsGoals/${id}`;
  const targetAmount = clampAmount(input.targetAmount);
  const status = currentSavedAmount >= targetAmount ? 'completed' : 'active';
  try {
    await updateDoc(doc(db, 'users', uid, 'savingsGoals', id), {
      name: clampStr(input.name, 120) || 'Savings Goal',
      targetAmount,
      targetDate: input.targetDate,
      category: clampStr(input.category, FIELD_LIMITS.CATEGORY_MAX) || 'General Savings',
      notes: clampStr(input.notes, FIELD_LIMITS.DESCRIPTION_MAX),
      status,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function addSavingsDeposit(
  uid: string,
  goal: SavingsGoal,
  depositAmount: number,
  date: string,
  note: string
): Promise<void> {
  if (uid === GUEST_UID) {
    guestAddSavingsDeposit(goal, depositAmount, date, note);
    return;
  }
  const contributionId = generateDocId();
  const path = `users/${uid}/savingsGoals/${goal.id}`;
  const cleanDeposit = clampAmount(depositAmount);
  const newSavedAmount = Number((goal.savedAmount + cleanDeposit).toFixed(2));
  const newStatus = newSavedAmount >= goal.targetAmount ? 'completed' : 'active';
  try {
    const batch = writeBatch(db);
    const goalRef = doc(db, 'users', uid, 'savingsGoals', goal.id);
    const contribRef = doc(db, 'users', uid, 'savingsGoals', goal.id, 'contributions', contributionId);

    batch.update(goalRef, {
      savedAmount: Math.min(newSavedAmount, FIELD_LIMITS.AMOUNT_MAX),
      status: newStatus,
      updatedAt: serverTimestamp(),
    });
    batch.set(contribRef, {
      userId: uid,
      goalId: goal.id,
      amount: cleanDeposit,
      date,
      note: clampStr(note, FIELD_LIMITS.SHORT_NOTE_MAX),
      createdAt: serverTimestamp(),
    });

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteSavingsGoal(uid: string, goalId: string): Promise<void> {
  if (uid === GUEST_UID) {
    guestDeleteSavingsGoal(goalId);
    return;
  }
  const path = `users/${uid}/savingsGoals/${goalId}`;
  try {
    const contribSnap = await getDocs(
      query(
        collection(db, 'users', uid, 'savingsGoals', goalId, 'contributions'),
        where('userId', '==', uid)
      )
    );
    const batch = writeBatch(db);
    contribSnap.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'users', uid, 'savingsGoals', goalId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Budgets ---
export type BudgetInput = Omit<BudgetRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;

export async function createBudget(uid: string, input: BudgetInput): Promise<string> {
  if (uid === GUEST_UID) {
    return guestCreateBudget(input);
  }
  const id = generateDocId();
  const path = `users/${uid}/budgets/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'budgets', id), {
      userId: uid,
      category: clampStr(input.category, FIELD_LIMITS.CATEGORY_MAX),
      month: input.month,
      limitAmount: clampAmount(input.limitAmount),
      alertThreshold: Math.max(50, Math.min(100, Math.round(input.alertThreshold || 80))),
      notes: clampStr(input.notes, FIELD_LIMITS.SHORT_NOTE_MAX),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateBudget(uid: string, id: string, input: BudgetInput): Promise<void> {
  if (uid === GUEST_UID) {
    guestUpdateBudget(id, input);
    return;
  }
  const path = `users/${uid}/budgets/${id}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'budgets', id), {
      category: clampStr(input.category, FIELD_LIMITS.CATEGORY_MAX),
      month: input.month,
      limitAmount: clampAmount(input.limitAmount),
      alertThreshold: Math.max(50, Math.min(100, Math.round(input.alertThreshold || 80))),
      notes: clampStr(input.notes, FIELD_LIMITS.SHORT_NOTE_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteBudget(uid: string, id: string): Promise<void> {
  if (uid === GUEST_UID) {
    guestDeleteBudget(id);
    return;
  }
  const path = `users/${uid}/budgets/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'budgets', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Loans & Debts ---
export type DebtInput = Omit<DebtRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;

export async function createDebtRecord(uid: string, input: DebtInput): Promise<string> {
  if (uid === GUEST_UID) {
    return guestCreateDebtRecord(input);
  }
  const id = generateDocId();
  const path = `users/${uid}/debtRecords/${id}`;
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

  try {
    await setDoc(doc(db, 'users', uid, 'debtRecords', id), {
      userId: uid,
      recordType: input.recordType,
      partyName: clampStr(input.partyName, FIELD_LIMITS.PARTY_NAME_MAX) || 'Counterparty',
      title: clampStr(input.title, FIELD_LIMITS.TITLE_MAX) || 'Record',
      totalAmount,
      paidAmount,
      interestRate: Math.max(0, Math.min(100, Number(input.interestRate) || 0)),
      dueDate: input.dueDate,
      status,
      notes: clampStr(input.notes, FIELD_LIMITS.DESCRIPTION_MAX),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateDebtRecord(
  uid: string,
  id: string,
  input: Omit<DebtInput, 'paidAmount'>
): Promise<void> {
  if (uid === GUEST_UID) {
    guestUpdateDebtRecord(id, input);
    return;
  }
  const path = `users/${uid}/debtRecords/${id}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'debtRecords', id), {
      recordType: input.recordType,
      partyName: clampStr(input.partyName, FIELD_LIMITS.PARTY_NAME_MAX) || 'Counterparty',
      title: clampStr(input.title, FIELD_LIMITS.TITLE_MAX) || 'Record',
      totalAmount: clampAmount(input.totalAmount),
      interestRate: Math.max(0, Math.min(100, Number(input.interestRate) || 0)),
      dueDate: input.dueDate,
      status: input.status,
      notes: clampStr(input.notes, FIELD_LIMITS.DESCRIPTION_MAX),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function recordDebtPayment(
  uid: string,
  record: DebtRecord,
  paymentAmount: number,
  date: string,
  method: string,
  note: string
): Promise<void> {
  if (uid === GUEST_UID) {
    guestRecordDebtPayment(record, paymentAmount, date, method, note);
    return;
  }
  const paymentId = generateDocId();
  const path = `users/${uid}/debtRecords/${record.id}`;
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

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', uid, 'debtRecords', record.id), {
      paidAmount: newPaid,
      status: newStatus,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'users', uid, 'recordPayments', paymentId), {
      userId: uid,
      parentKind: 'debt',
      parentId: record.id,
      amount: cleanPay,
      date,
      method: clampStr(method, 40) || 'Bank Transfer',
      note: clampStr(note, FIELD_LIMITS.SHORT_NOTE_MAX),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteDebtRecord(uid: string, id: string): Promise<void> {
  if (uid === GUEST_UID) {
    guestDeleteDebtRecord(id);
    return;
  }
  const path = `users/${uid}/debtRecords/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'debtRecords', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Bills, EMIs & Subscriptions ---
export type BillInput = Omit<BillRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;

export async function createBillRecord(uid: string, input: BillInput): Promise<string> {
  if (uid === GUEST_UID) {
    return guestCreateBillRecord(input);
  }
  const id = generateDocId();
  const path = `users/${uid}/bills/${id}`;
  const amount = clampAmount(input.amount);
  const paidAmount = Math.max(0, Math.min(Number(input.paidAmount) || 0, amount));
  try {
    await setDoc(doc(db, 'users', uid, 'bills', id), {
      userId: uid,
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateBillRecord(
  uid: string,
  id: string,
  input: Omit<BillInput, 'paidAmount'>
): Promise<void> {
  if (uid === GUEST_UID) {
    guestUpdateBillRecord(id, input);
    return;
  }
  const path = `users/${uid}/bills/${id}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'bills', id), {
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
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function payBillRecord(
  uid: string,
  bill: BillRecord,
  payAmount: number,
  date: string,
  method: string,
  note: string,
  alsoLogExpense: boolean
): Promise<void> {
  if (uid === GUEST_UID) {
    guestPayBillRecord(bill, payAmount, date, method, note, alsoLogExpense);
    return;
  }
  const paymentId = generateDocId();
  const path = `users/${uid}/bills/${bill.id}`;
  const remaining = Math.max(0, Number((bill.amount - bill.paidAmount).toFixed(2)));
  const cleanPay = Math.min(clampAmount(payAmount), remaining > 0 ? remaining : bill.amount);
  const newPaid = Math.min(bill.amount, Number((bill.paidAmount + cleanPay).toFixed(2)));
  const isCycleComplete = newPaid >= bill.amount;

  try {
    const batch = writeBatch(db);
    const billRef = doc(db, 'users', uid, 'bills', bill.id);

    if (isCycleComplete && bill.frequency !== 'one_time') {
      // Advance recurring bill/EMI/subscription to next billing cycle
      batch.update(billRef, {
        paidAmount: 0,
        dueDate: addFrequencyToDate(bill.dueDate, bill.frequency),
        status: 'unpaid',
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(billRef, {
        paidAmount: newPaid,
        dueDate: bill.dueDate,
        status: isCycleComplete ? 'paid' : 'partially_paid',
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(doc(db, 'users', uid, 'recordPayments', paymentId), {
      userId: uid,
      parentKind: 'bill',
      parentId: bill.id,
      amount: cleanPay,
      date,
      method: clampStr(method, 40) || 'UPI',
      note: clampStr(note, FIELD_LIMITS.SHORT_NOTE_MAX),
      createdAt: serverTimestamp(),
    });

    if (alsoLogExpense) {
      const txId = generateDocId();
      const validExpenseCategories = [
        'Food', 'Shopping', 'Transport', 'Rent', 'Electricity', 'Internet',
        'Education', 'Healthcare', 'Entertainment', 'Travel', 'EMI', 'Bills', 'Other Expenses',
      ];
      const mappedCategory = validExpenseCategories.includes(bill.category)
        ? bill.category
        : bill.billType === 'emi'
        ? 'EMI'
        : 'Bills';

      batch.set(doc(db, 'users', uid, 'transactions', txId), {
        userId: uid,
        type: 'expense',
        amount: cleanPay,
        title: clampStr(bill.title, FIELD_LIMITS.TITLE_MAX),
        category: mappedCategory,
        date,
        time: '10:00',
        paymentMethod: ['UPI', 'Bank Transfer', 'Cash', 'Credit Card', 'Debit Card', 'Wallet', 'Net Banking', 'Other'].includes(method)
          ? method
          : 'UPI',
        description: clampStr(`Payment for ${bill.billType.toUpperCase()}: ${bill.provider || bill.title}`, FIELD_LIMITS.DESCRIPTION_MAX),
        notes: clampStr(note, FIELD_LIMITS.NOTES_MAX),
        receiptName: '',
        receiptDataUrl: '',
        recurringId: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteBillRecord(uid: string, id: string): Promise<void> {
  if (uid === GUEST_UID) {
    guestDeleteBillRecord(id);
    return;
  }
  const path = `users/${uid}/bills/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'bills', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Recurring Transactions ---
export type RecurringInput = Omit<RecurringTransaction, 'id' | 'userId' | 'lastRunDate' | 'createdAt' | 'updatedAt'>;

export async function createRecurringTransaction(uid: string, input: RecurringInput): Promise<string> {
  if (uid === GUEST_UID) {
    return guestCreateRecurringTransaction(input);
  }
  const id = generateDocId();
  const path = `users/${uid}/recurringTransactions/${id}`;
  try {
    await setDoc(doc(db, 'users', uid, 'recurringTransactions', id), {
      userId: uid,
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function toggleRecurringActive(uid: string, id: string, isActive: boolean): Promise<void> {
  if (uid === GUEST_UID) {
    guestToggleRecurringActive(id, isActive);
    return;
  }
  const path = `users/${uid}/recurringTransactions/${id}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'recurringTransactions', id), {
      isActive,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function runRecurringTransactionNow(
  uid: string,
  rule: RecurringTransaction
): Promise<void> {
  if (uid === GUEST_UID) {
    guestRunRecurringTransactionNow(rule);
    return;
  }
  const txId = generateDocId();
  const path = `users/${uid}/recurringTransactions/${rule.id}`;
  const runDate = rule.nextRunDate <= getTodayStr() ? rule.nextRunDate : getTodayStr();
  const nextDate = addFrequencyToDate(rule.nextRunDate, rule.frequency);
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, 'users', uid, 'transactions', txId), {
      userId: uid,
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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', uid, 'recurringTransactions', rule.id), {
      lastRunDate: runDate,
      nextRunDate: nextDate,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteRecurringTransaction(uid: string, id: string): Promise<void> {
  if (uid === GUEST_UID) {
    guestDeleteRecurringTransaction(id);
    return;
  }
  const path = `users/${uid}/recurringTransactions/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'recurringTransactions', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Full Account Data Wipe (for Account Deletion) ---
export async function wipeAllUserFirestoreData(uid: string): Promise<void> {
  if (uid === GUEST_UID) {
    clearGuestStoreData();
    return;
  }
  const subcollections = [
    'transactions',
    'budgets',
    'debtRecords',
    'recordPayments',
    'bills',
    'recurringTransactions',
  ];
  try {
    // Delete savings goals + nested contributions
    const goalsSnap = await getDocs(
      query(collection(db, 'users', uid, 'savingsGoals'), where('userId', '==', uid))
    );
    for (const gDoc of goalsSnap.docs) {
      const contribSnap = await getDocs(
        query(
          collection(db, 'users', uid, 'savingsGoals', gDoc.id, 'contributions'),
          where('userId', '==', uid)
        )
      );
      const batch = writeBatch(db);
      contribSnap.forEach((c) => batch.delete(c.ref));
      batch.delete(gDoc.ref);
      await batch.commit();
    }

    for (const colName of subcollections) {
      const snap = await getDocs(
        query(collection(db, 'users', uid, colName), where('userId', '==', uid))
      );
      if (!snap.empty) {
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += 400) {
          const chunk = docs.slice(i, i + 400);
          const batch = writeBatch(db);
          chunk.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }
    }

    await deleteDoc(doc(db, 'users', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
  }
}

// --- Global App Maintenance Mode (Admin-Only Write, Public Non-PII Read) ---
export function subscribeToMaintenanceConfig(
  onUpdate: (config: MaintenanceConfig) => void,
  onError?: (error: unknown) => void
): () => void {
  const ref = doc(db, 'appConfig', 'maintenance');
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Partial<MaintenanceConfig>;
        onUpdate({
          enabled: Boolean(data.enabled),
          updatedAt: data.updatedAt ?? null,
        });
      } else {
        onUpdate({ enabled: false, updatedAt: null });
      }
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        console.error('Failed to read maintenance status:', error);
      }
    }
  );
}

export async function setMaintenanceMode(enabled: boolean): Promise<void> {
  const path = 'appConfig/maintenance';
  try {
    await setDoc(doc(db, 'appConfig', 'maintenance'), {
      enabled: Boolean(enabled),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// --- Admin User Directory & Account Lifecycle (Admin-Only via Firestore Rules) ---
export function subscribeAllUsersForAdmin(
  onUpdate: (users: UserProfile[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const usersRef = collection(db, 'users');
  return onSnapshot(
    usersRef,
    (snap) => {
      const list = snap.docs.map((d) => ({
        uid: d.id,
        ...(d.data() as Omit<UserProfile, 'uid'>),
      })) as UserProfile[];
      list.sort((a, b) => {
        const aSec = a.createdAt?.seconds ?? 0;
        const bSec = b.createdAt?.seconds ?? 0;
        return bSec - aSec;
      });
      onUpdate(list);
    },
    (error) => {
      if (onError) {
        onError(error);
      } else {
        handleFirestoreError(error, OperationType.LIST, 'users');
      }
    }
  );
}

export async function setUserAccountStatus(
  targetUid: string,
  status: AccountStatus
): Promise<void> {
  const path = `users/${targetUid}`;
  try {
    await updateDoc(doc(db, 'users', targetUid), {
      accountStatus: status,
      deactivatedAt: status === 'deactivated' ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// --- Admin Pop-Up Messages to User Accounts ---
export async function sendAdminPopupMessageToUsers(
  targetUids: string[],
  heading: string,
  message: string
): Promise<number> {
  const uniqueUids = Array.from(new Set(targetUids.map((id) => id.trim()).filter(Boolean)));
  if (uniqueUids.length === 0) return 0;

  const cleanHeading = clampStr(heading, 120) || DEFAULT_ADMIN_MESSAGE_HEADING;
  const cleanMessage = clampStr(message, 1500);
  if (!cleanMessage) {
    throw new Error('Please write a message before sending.');
  }

  try {
    for (let i = 0; i < uniqueUids.length; i += 400) {
      const chunk = uniqueUids.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const targetUid of chunk) {
        const msgId = generateDocId();
        batch.set(doc(db, 'users', targetUid, 'adminMessages', msgId), {
          userId: targetUid,
          heading: cleanHeading,
          message: cleanMessage,
          senderEmail: ADMIN_EMAIL,
          isRead: false,
          readAt: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
    return uniqueUids.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'users/*/adminMessages');
  }
}

export async function markAdminMessageRead(uid: string, messageId: string): Promise<void> {
  if (uid === GUEST_UID) return;
  const path = `users/${uid}/adminMessages/${messageId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'adminMessages', messageId), {
      isRead: true,
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
