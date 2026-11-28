import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  AccountStatus,
  AiUsageRecord,
  AppealStatus,
  BanType,
  BillRecord,
  BillingCycle,
  BudgetRecord,
  CurrencyCode,
  DebtRecord,
  MaintenanceConfig,
  RecurringTransaction,
  RecordStatus,
  RestrictionStatus,
  SavingsGoal,
  SecurityAdminActionType,
  SecurityAppeal,
  SecurityAuditLog,
  SecurityCase,
  SecurityEventCategory,
  SecurityEventRecord,
  SecurityEventType,
  SecurityProfile,
  SecurityRiskLevel,
  ThemeMode,
  TransactionRecord,
  UserProfile,
  VipPaymentRequest,
  VipStatus,
  VipSubscription,
  VipTier,
} from '../types/finance';
import {
  ADMIN_EMAIL,
  DEFAULT_ADMIN_MESSAGE_HEADING,
  FIELD_LIMITS,
} from '../utils/constants';
import { BILLING_CYCLE_LABELS, VIP_TIER_CONFIGS } from '../utils/vipTiers';
import { addFrequencyToDate, getTodayStr } from '../utils/formatters';
import {
  analyzeMessageSecurity,
  checkBulkMutationAnomaly,
  EVENT_BASE_WEIGHTS,
} from './securityDetectionService';
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
    const anomaly = checkBulkMutationAnomaly(uid, 'transaction deletion');
    if (anomaly.suspicious) {
      void logClientSecurityEvent({
        userId: uid,
        userEmail: auth.currentUser?.email || '',
        category: 'data_security',
        eventType: 'suspicious_bulk_mutation',
        riskLevel: anomaly.countInWindow >= 10 ? 'high' : 'medium',
        riskScore: Math.min(80, 32 + anomaly.countInWindow * 4),
        summary: 'Suspicious rapid bulk deletion of financial transactions',
        evidence: anomaly.evidence,
      });
    }
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

// --- FinTrack Security Center & Suspicious Activity Monitoring ---
const recentClientEventTimes = new Map<string, number>();

export async function logClientSecurityEvent(input: {
  userId: string;
  userEmail: string;
  category: SecurityEventCategory;
  eventType: SecurityEventType;
  riskLevel: SecurityRiskLevel;
  riskScore?: number;
  summary: string;
  evidence: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified || currentUser.uid !== input.userId) {
    return;
  }

  // Throttle identical client event types per user (30s window) to avoid spam
  const throttleKey = `${input.userId}:${input.eventType}`;
  const now = Date.now();
  const lastTs = recentClientEventTimes.get(throttleKey) || 0;
  if (now - lastTs < 30_000) return;
  recentClientEventTimes.set(throttleKey, now);

  try {
    const id = generateDocId();
    const score = Math.max(
      0,
      Math.min(100, Math.round(input.riskScore ?? EVENT_BASE_WEIGHTS[input.eventType] ?? 25))
    );
    await setDoc(doc(db, 'securityEvents', id), {
      userId: input.userId,
      userEmail: clampStr(input.userEmail, 160),
      category: input.category,
      eventType: input.eventType,
      riskLevel: input.riskLevel,
      riskScore: score,
      summary: clampStr(input.summary, 300) || 'Security event recorded',
      evidence: clampStr(input.evidence, 1500),
      source: 'client',
      status: 'open',
      createdAt: serverTimestamp(),
    });
  } catch {
    // Never crash user flow or recurse if security logging fails
  }
}

export async function logAdminSecurityEvent(input: {
  userId: string;
  userEmail: string;
  category: SecurityEventCategory;
  eventType: SecurityEventType;
  riskLevel: SecurityRiskLevel;
  riskScore: number;
  summary: string;
  evidence: string;
}): Promise<void> {
  const id = generateDocId();
  const path = `securityEvents/${id}`;
  try {
    await setDoc(doc(db, 'securityEvents', id), {
      userId: clampStr(input.userId, 128),
      userEmail: clampStr(input.userEmail, 160),
      category: input.category,
      eventType: input.eventType,
      riskLevel: input.riskLevel,
      riskScore: Math.max(0, Math.min(100, Math.round(input.riskScore))),
      summary: clampStr(input.summary, 300) || 'Admin security event',
      evidence: clampStr(input.evidence, 1500),
      source: 'admin',
      status: 'reviewed',
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSecurityEventStatus(
  eventId: string,
  status: 'open' | 'reviewed' | 'dismissed'
): Promise<void> {
  const path = `securityEvents/${eventId}`;
  try {
    await updateDoc(doc(db, 'securityEvents', eventId), { status });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeUserSecurityProfile(
  uid: string,
  onUpdate: (profile: SecurityProfile | null) => void,
  onError?: (error: unknown) => void
): () => void {
  const ref = doc(db, 'securityProfiles', uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate({
        ...(snap.data() as Omit<SecurityProfile, 'userId'>),
        userId: snap.id,
      });
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.GET, `securityProfiles/${uid}`);
    }
  );
}

export function subscribeUserAppeals(
  uid: string,
  onUpdate: (appeals: SecurityAppeal[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const q = query(collection(db, 'securityAppeals'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SecurityAppeal, 'id'>),
      }));
      list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      onUpdate(list);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'securityAppeals');
    }
  );
}

export function subscribeAllSecurityProfilesForAdmin(
  onUpdate: (profiles: SecurityProfile[]) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    collection(db, 'securityProfiles'),
    (snap) => {
      const list = snap.docs.map((d) => ({
        ...(d.data() as Omit<SecurityProfile, 'userId'>),
        userId: d.id,
      }));
      list.sort((a, b) => b.riskScore - a.riskScore);
      onUpdate(list);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'securityProfiles');
    }
  );
}

export function subscribeSecurityCasesForAdmin(
  onUpdate: (casesMap: Record<string, SecurityCase>) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    collection(db, 'securityCases'),
    (snap) => {
      const map: Record<string, SecurityCase> = {};
      snap.docs.forEach((d) => {
        map[d.id] = {
          ...(d.data() as Omit<SecurityCase, 'userId'>),
          userId: d.id,
        };
      });
      onUpdate(map);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'securityCases');
    }
  );
}

export function subscribeSecurityEventsForAdmin(
  onUpdate: (events: SecurityEventRecord[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const q = query(collection(db, 'securityEvents'), orderBy('createdAt', 'desc'), limit(250));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SecurityEventRecord, 'id'>),
      }));
      onUpdate(list);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'securityEvents');
    }
  );
}

export function subscribeSecurityAppealsForAdmin(
  onUpdate: (appeals: SecurityAppeal[]) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    collection(db, 'securityAppeals'),
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SecurityAppeal, 'id'>),
      }));
      list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      onUpdate(list);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'securityAppeals');
    }
  );
}

export function subscribeSecurityAuditLogsForAdmin(
  onUpdate: (logs: SecurityAuditLog[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const q = query(collection(db, 'securityAuditLogs'), orderBy('createdAt', 'desc'), limit(200));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<SecurityAuditLog, 'id'>),
      }));
      onUpdate(list);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'securityAuditLogs');
    }
  );
}

export function subscribeUserVipSubscription(
  uid: string,
  onUpdate: (sub: VipSubscription | null) => void,
  onError?: (error: unknown) => void
): () => void {
  const ref = doc(db, 'vipSubscriptions', uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate({
        ...(snap.data() as Omit<VipSubscription, 'userId'>),
        userId: snap.id,
      });
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.GET, `vipSubscriptions/${uid}`);
    }
  );
}

export function subscribeUserAiUsage(
  uid: string,
  onUpdate: (usage: AiUsageRecord | null) => void,
  onError?: (error: unknown) => void
): () => void {
  const ref = doc(db, 'aiUsage', uid);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate({
        ...(snap.data() as Omit<AiUsageRecord, 'userId'>),
        userId: snap.id,
      });
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.GET, `aiUsage/${uid}`);
    }
  );
}

export function subscribeAllVipSubscriptionsForAdmin(
  onUpdate: (subsMap: Record<string, VipSubscription>) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    collection(db, 'vipSubscriptions'),
    (snap) => {
      const map: Record<string, VipSubscription> = {};
      snap.docs.forEach((d) => {
        map[d.id] = {
          ...(d.data() as Omit<VipSubscription, 'userId'>),
          userId: d.id,
        };
      });
      onUpdate(map);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'vipSubscriptions');
    }
  );
}

export function subscribeAllAiUsageForAdmin(
  onUpdate: (usageMap: Record<string, AiUsageRecord>) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    collection(db, 'aiUsage'),
    (snap) => {
      const map: Record<string, AiUsageRecord> = {};
      snap.docs.forEach((d) => {
        map[d.id] = {
          ...(d.data() as Omit<AiUsageRecord, 'userId'>),
          userId: d.id,
        };
      });
      onUpdate(map);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'aiUsage');
    }
  );
}

export interface ExecuteSecurityActionParams {
  targetUser: UserProfile;
  existingProfile?: SecurityProfile | null;
  actionType: SecurityAdminActionType;
  reason: string;
  durationMs?: number;
  durationLabel?: string;
  sendDirectMessage?: boolean;
  directMessageText?: string;
  nextVipStatus?: VipStatus;
  nextVipTier?: VipTier;
  nextBillingCycle?: BillingCycle;
  resetAiQuota?: boolean;
  riskScoreOverride?: number;
  riskLevelOverride?: SecurityRiskLevel;
}

export async function executeSecurityAdminAction(
  params: ExecuteSecurityActionParams
): Promise<void> {
  const { targetUser, existingProfile, actionType } = params;
  const targetUid = targetUser.uid;
  const reason = clampStr(params.reason, 500);
  const durationMs = Math.max(0, Math.round(params.durationMs || 0));
  const durationLabel = clampStr(params.durationLabel || '', 64);

  if (targetUser.email?.toLowerCase() === ADMIN_EMAIL) {
    throw new Error('Administrator account cannot be restricted or banned.');
  }
  if (actionType === 'perm_ban' && reason.length < 5) {
    throw new Error('A documented reason (at least 5 characters) is required for permanent bans.');
  }
  if (actionType === 'temp_ban' && durationMs <= 0) {
    throw new Error('A valid temporary ban duration (hh:mm:ss) is required.');
  }

  const profileRef = doc(db, 'securityProfiles', targetUid);
  const existingSnap = await getDoc(profileRef);
  const prevData = existingSnap.exists()
    ? ({ ...(existingSnap.data() as SecurityProfile), userId: targetUid } as SecurityProfile)
    : existingProfile || null;

  const nowMs = Date.now();
  let restrictionStatus: RestrictionStatus = prevData?.restrictionStatus || 'active';
  let banType: BanType = prevData?.banType || 'none';
  let banReason = prevData?.banReason || '';
  let banDurationLabel = prevData?.banDurationLabel || '';
  let banDurationMs = prevData?.banDurationMs || 0;
  let banStartedAt: Timestamp | null = prevData?.banStartedAt ?? null;
  let banExpiresAt: Timestamp | null = prevData?.banExpiresAt ?? null;
  let aiRestrictedUntil: Timestamp | null = prevData?.aiRestrictedUntil ?? null;
  let messagingRestrictedUntil: Timestamp | null = prevData?.messagingRestrictedUntil ?? null;
  let warningCount = prevData?.warningCount || 0;
  let lastWarningAt: Timestamp | null = prevData?.lastWarningAt ?? null;
  let underInvestigation = prevData?.underInvestigation ?? false;
  let vipStatus: VipStatus = prevData?.vipStatus || 'none';
  const riskScore =
    typeof params.riskScoreOverride === 'number'
      ? Math.max(0, Math.min(100, Math.round(params.riskScoreOverride)))
      : prevData?.riskScore || 0;
  const riskLevel: SecurityRiskLevel = params.riskLevelOverride || prevData?.riskLevel || 'low';
  const eventCount = prevData?.eventCount || 0;
  const lastEventAt: Timestamp | null = prevData?.lastEventAt ?? null;

  let auditDetails = '';
  let shouldReactivateUserProfile = false;

  switch (actionType) {
    case 'send_warning': {
      warningCount += 1;
      lastWarningAt = Timestamp.fromMillis(nowMs);
      auditDetails = `Official security warning #${warningCount} issued.`;
      break;
    }
    case 'restrict_ai': {
      const dur = durationMs > 0 ? durationMs : 24 * 3600 * 1000;
      aiRestrictedUntil = Timestamp.fromMillis(nowMs + dur);
      auditDetails = `AI access restricted for ${durationLabel || '24:00:00'}.`;
      break;
    }
    case 'clear_ai_restriction': {
      aiRestrictedUntil = null;
      auditDetails = 'AI access restriction lifted.';
      break;
    }
    case 'restrict_messaging': {
      const dur = durationMs > 0 ? durationMs : 24 * 3600 * 1000;
      messagingRestrictedUntil = Timestamp.fromMillis(nowMs + dur);
      auditDetails = `Messaging restricted for ${durationLabel || '24:00:00'}.`;
      break;
    }
    case 'clear_messaging_restriction': {
      messagingRestrictedUntil = null;
      auditDetails = 'Messaging restriction lifted.';
      break;
    }
    case 'temp_ban': {
      restrictionStatus = 'temp_banned';
      banType = 'temporary';
      banReason = reason || 'Temporary security ban enforced by FinTrack Admin.';
      banDurationMs = durationMs;
      banDurationLabel = durationLabel || '24:00:00';
      banStartedAt = Timestamp.fromMillis(nowMs);
      banExpiresAt = Timestamp.fromMillis(nowMs + durationMs);
      underInvestigation = false;
      auditDetails = `Temporary ban applied (${banDurationLabel}). User financial data preserved.`;
      break;
    }
    case 'perm_ban': {
      restrictionStatus = 'perm_banned';
      banType = 'permanent';
      banReason = reason;
      banDurationMs = 0;
      banDurationLabel = 'Permanent';
      banStartedAt = Timestamp.fromMillis(nowMs);
      banExpiresAt = null;
      underInvestigation = false;
      auditDetails = 'Permanent account ban confirmed by administrator. User financial data & evidence preserved.';
      break;
    }
    case 'reactivate_account': {
      restrictionStatus = 'active';
      banType = 'none';
      banReason = '';
      banDurationMs = 0;
      banDurationLabel = '';
      banStartedAt = null;
      banExpiresAt = null;
      aiRestrictedUntil = null;
      messagingRestrictedUntil = null;
      underInvestigation = false;
      shouldReactivateUserProfile = true;
      auditDetails = 'Account reactivated and all bans/restrictions cleared.';
      break;
    }
    case 'mark_under_investigation': {
      if (banType === 'none') {
        restrictionStatus = 'under_investigation';
      }
      underInvestigation = true;
      auditDetails = 'Account flagged for manual administrator investigation.';
      break;
    }
    case 'resolve_investigation': {
      underInvestigation = false;
      if (restrictionStatus === 'under_investigation') {
        restrictionStatus = 'active';
      }
      auditDetails = 'Investigation resolved.';
      break;
    }
    case 'update_vip_status': {
      const targetTier: VipTier =
        params.nextVipTier || (params.nextVipStatus === 'none' ? 'starter' : 'gold');
      vipStatus = targetTier === 'starter' ? 'none' : 'vip';
      auditDetails = `VIP membership updated to "${VIP_TIER_CONFIGS[targetTier].classLabel} (${VIP_TIER_CONFIGS[targetTier].name})" (${params.nextBillingCycle || 'monthly'}).`;
      break;
    }
    default:
      break;
  }

  const batch = writeBatch(db);
  const cleanEmail = clampStr(targetUser.email, 160) || 'user@fintrack.app';
  const cleanDisplayName = clampStr(targetUser.displayName, 100) || 'FinTrack User';

  if (!existingSnap.exists()) {
    batch.set(profileRef, {
      userId: targetUid,
      userEmail: cleanEmail,
      displayName: cleanDisplayName,
      restrictionStatus,
      banType,
      banReason,
      banDurationLabel,
      banDurationMs,
      banStartedAt,
      banExpiresAt,
      aiRestrictedUntil,
      messagingRestrictedUntil,
      warningCount,
      lastWarningAt,
      riskLevel,
      riskScore,
      underInvestigation,
      vipStatus,
      eventCount,
      lastEventAt,
      updatedBy: ADMIN_EMAIL,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.update(profileRef, {
      userEmail: cleanEmail,
      displayName: cleanDisplayName,
      restrictionStatus,
      banType,
      banReason,
      banDurationLabel,
      banDurationMs,
      banStartedAt,
      banExpiresAt,
      aiRestrictedUntil,
      messagingRestrictedUntil,
      warningCount,
      lastWarningAt,
      riskLevel,
      riskScore,
      underInvestigation,
      vipStatus,
      eventCount,
      lastEventAt,
      updatedBy: ADMIN_EMAIL,
      updatedAt: serverTimestamp(),
    });
  }

  if (actionType === 'update_vip_status') {
    const targetTier: VipTier =
      params.nextVipTier || (params.nextVipStatus === 'none' ? 'starter' : 'gold');
    const cycle: BillingCycle = params.nextBillingCycle || 'monthly';
    const tierSpec = VIP_TIER_CONFIGS[targetTier];
    const priceInr = tierSpec.pricesInr[cycle];
    const cycleDays = BILLING_CYCLE_LABELS[cycle].days;
    const periodKey = `sub-${Math.floor(nowMs / 1000)}-c0`;
    const subRef = doc(db, 'vipSubscriptions', targetUid);
    const existingSubSnap = await getDoc(subRef);
    const subPayload = {
      userId: targetUid,
      tier: targetTier,
      billingCycle: cycle,
      status: 'active',
      priceInr,
      paymentReference: `ADMIN-${Math.floor(nowMs / 1000)}`,
      periodKey,
      periodStartAt: serverTimestamp(),
      periodEndAt: Timestamp.fromMillis(nowMs + cycleDays * 24 * 60 * 60 * 1000),
      autoRenew: true,
      updatedBy: ADMIN_EMAIL,
      updatedAt: serverTimestamp(),
    };

    if (!existingSubSnap.exists()) {
      batch.set(subRef, {
        ...subPayload,
        createdAt: serverTimestamp(),
      });
    } else {
      batch.update(subRef, subPayload);
    }

    if (params.resetAiQuota !== false) {
      const monthEndMs = nowMs + 30 * 24 * 60 * 60 * 1000;
      batch.set(doc(db, 'aiUsage', targetUid), {
        userId: targetUid,
        tier: targetTier,
        periodKey,
        periodStartAt: Timestamp.fromMillis(nowMs),
        periodEndAt: Timestamp.fromMillis(monthEndMs),
        insightsUsed: 0,
        insightsLimit: tierSpec.insightsLimit,
        advisorUsed: 0,
        advisorLimit: tierSpec.advisorLimit,
        forecastUsed: 0,
        lastResetAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  if (shouldReactivateUserProfile && targetUser.accountStatus === 'deactivated') {
    batch.update(doc(db, 'users', targetUid), {
      accountStatus: 'active',
      deactivatedAt: null,
      updatedAt: serverTimestamp(),
    });
  }

  const auditId = generateDocId();
  batch.set(doc(db, 'securityAuditLogs', auditId), {
    targetUserId: targetUid,
    targetUserEmail: cleanEmail,
    adminEmail: ADMIN_EMAIL,
    actionType,
    reason,
    details: clampStr(auditDetails, 1000),
    durationLabel: durationLabel || (actionType === 'perm_ban' ? 'Permanent' : ''),
    createdAt: serverTimestamp(),
  });

  if (params.sendDirectMessage) {
    const msgText = clampStr(
      params.directMessageText || reason || auditDetails,
      1500
    );
    if (msgText) {
      const msgId = generateDocId();
      batch.set(doc(db, 'users', targetUid, 'adminMessages', msgId), {
        userId: targetUid,
        heading: DEFAULT_ADMIN_MESSAGE_HEADING,
        message: msgText,
        senderEmail: ADMIN_EMAIL,
        isRead: false,
        readAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `securityProfiles/${targetUid}`);
  }
}

export async function saveSecurityCaseNotes(params: {
  targetUid: string;
  targetEmail: string;
  internalNotes: string;
  evidenceSummary: string;
}): Promise<void> {
  const caseRef = doc(db, 'securityCases', params.targetUid);
  const existing = await getDoc(caseRef);
  const cleanNotes = clampStr(params.internalNotes, 3000);
  const cleanEvidence = clampStr(params.evidenceSummary, 2000);

  const batch = writeBatch(db);
  if (!existing.exists()) {
    batch.set(caseRef, {
      userId: params.targetUid,
      internalNotes: cleanNotes,
      evidenceSummary: cleanEvidence,
      lastReviewedBy: ADMIN_EMAIL,
      lastReviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.update(caseRef, {
      internalNotes: cleanNotes,
      evidenceSummary: cleanEvidence,
      lastReviewedBy: ADMIN_EMAIL,
      lastReviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const auditId = generateDocId();
  batch.set(doc(db, 'securityAuditLogs', auditId), {
    targetUserId: params.targetUid,
    targetUserEmail: clampStr(params.targetEmail, 160),
    adminEmail: ADMIN_EMAIL,
    actionType: 'update_internal_notes',
    reason: 'Admin internal investigation notes updated',
    details: 'Updated case evidence summary and private admin notes.',
    durationLabel: '',
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `securityCases/${params.targetUid}`);
  }
}

export async function submitSecurityAppeal(input: {
  userId: string;
  userEmail: string;
  displayName: string;
  banType: BanType;
  banReason: string;
  appealReason: string;
  explanation: string;
}): Promise<string> {
  const appealReason = clampStr(input.appealReason, 160);
  const explanation = clampStr(input.explanation, 1500);
  if (appealReason.length < 3) {
    throw new Error('Please choose or enter an appeal reason (at least 3 characters).');
  }
  if (explanation.length < 10) {
    throw new Error('Please provide a clear explanation (at least 10 characters).');
  }

  const msgCheck = analyzeMessageSecurity(`${appealReason} ${explanation}`, input.userId);
  if (msgCheck.flagged && msgCheck.violationType) {
    void logClientSecurityEvent({
      userId: input.userId,
      userEmail: input.userEmail,
      category: 'messaging_security',
      eventType: msgCheck.violationType,
      riskLevel: msgCheck.riskLevel,
      summary: `Blocked unsafe appeal submission: ${msgCheck.reason}`,
      evidence: `violation=${msgCheck.violationType}`,
    });
    throw new Error(msgCheck.reason);
  }

  const id = generateDocId();
  const path = `securityAppeals/${id}`;
  try {
    await setDoc(doc(db, 'securityAppeals', id), {
      userId: input.userId,
      userEmail: clampStr(input.userEmail, 160) || 'user@fintrack.app',
      displayName: clampStr(input.displayName, 100) || 'FinTrack User',
      banType: input.banType,
      banReason: clampStr(input.banReason, 500),
      appealReason,
      explanation,
      status: 'pending' as AppealStatus,
      adminDecisionNote: '',
      reviewedBy: '',
      reviewedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function reviewSecurityAppeal(params: {
  appeal: SecurityAppeal;
  targetUser?: UserProfile | null;
  status: Exclude<AppealStatus, 'pending'>;
  adminDecisionNote: string;
  reactivateOnApprove?: boolean;
  sendDirectMessage?: boolean;
}): Promise<void> {
  const { appeal, status, targetUser } = params;
  const note = clampStr(params.adminDecisionNote, 1000);
  if (!note) {
    throw new Error('Please enter a decision note before updating the appeal.');
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'securityAppeals', appeal.id), {
    status,
    adminDecisionNote: note,
    reviewedBy: ADMIN_EMAIL,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (status === 'approved' && params.reactivateOnApprove) {
    const profileRef = doc(db, 'securityProfiles', appeal.userId);
    const secSnap = await getDoc(profileRef);
    if (secSnap.exists()) {
      batch.update(profileRef, {
        userEmail: clampStr(appeal.userEmail, 160),
        displayName: clampStr(appeal.displayName, 100),
        restrictionStatus: 'active',
        banType: 'none',
        banReason: '',
        banDurationLabel: '',
        banDurationMs: 0,
        banStartedAt: null,
        banExpiresAt: null,
        aiRestrictedUntil: null,
        messagingRestrictedUntil: null,
        underInvestigation: false,
        updatedBy: ADMIN_EMAIL,
        updatedAt: serverTimestamp(),
      });
    }
    if (!targetUser || targetUser.accountStatus === 'deactivated') {
      batch.update(doc(db, 'users', appeal.userId), {
        accountStatus: 'active',
        deactivatedAt: null,
        updatedAt: serverTimestamp(),
      });
    }
  }

  const auditId = generateDocId();
  batch.set(doc(db, 'securityAuditLogs', auditId), {
    targetUserId: appeal.userId,
    targetUserEmail: clampStr(appeal.userEmail, 160),
    adminEmail: ADMIN_EMAIL,
    actionType: 'review_appeal',
    reason: note,
    details: `Appeal ${appeal.id} marked "${status}"${
      status === 'approved' && params.reactivateOnApprove ? ' and account reactivated' : ''
    }.`,
    durationLabel: '',
    createdAt: serverTimestamp(),
  });

  if (params.sendDirectMessage) {
    const msgId = generateDocId();
    batch.set(doc(db, 'users', appeal.userId, 'adminMessages', msgId), {
      userId: appeal.userId,
      heading: DEFAULT_ADMIN_MESSAGE_HEADING,
      message: clampStr(`Appeal Update (${status.toUpperCase()}): ${note}`, 1500),
      senderEmail: ADMIN_EMAIL,
      isRead: false,
      readAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `securityAppeals/${appeal.id}`);
  }
}

// --- VIP UPI Payment Requests & Admin Verification ---
export function subscribeUserVipPaymentRequests(
  uid: string,
  onUpdate: (requests: VipPaymentRequest[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const q = query(collection(db, 'vipPaymentRequests'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<VipPaymentRequest, 'id'>),
      }));
      list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      onUpdate(list);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'vipPaymentRequests');
    }
  );
}

export function subscribeAllVipPaymentRequestsForAdmin(
  onUpdate: (requests: VipPaymentRequest[]) => void,
  onError?: (error: unknown) => void
): () => void {
  return onSnapshot(
    collection(db, 'vipPaymentRequests'),
    (snap) => {
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<VipPaymentRequest, 'id'>),
      }));
      list.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (a.status !== 'pending' && b.status === 'pending') return 1;
        return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
      });
      onUpdate(list);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'vipPaymentRequests');
    }
  );
}

export async function reviewVipPaymentRequest(params: {
  request: VipPaymentRequest;
  decision: 'approved' | 'rejected';
  adminNote?: string;
}): Promise<void> {
  const { request, decision } = params;
  if (request.status !== 'pending') {
    throw new Error('This VIP payment request has already been reviewed.');
  }

  const cleanNote = clampStr(params.adminNote || '', 500);
  if (decision === 'rejected' && cleanNote.length < 3) {
    throw new Error('Please enter a short reason before rejecting the payment request.');
  }

  const nowMs = Date.now();
  const batch = writeBatch(db);
  const reqRef = doc(db, 'vipPaymentRequests', request.id);

  batch.update(reqRef, {
    status: decision,
    adminNote: cleanNote,
    reviewedBy: ADMIN_EMAIL,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const tierSpec = VIP_TIER_CONFIGS[request.tier];
  const cycleSpec = BILLING_CYCLE_LABELS[request.billingCycle];
  const cleanEmail = clampStr(request.userEmail, 160) || 'user@fintrack.app';
  const cleanDisplayName = clampStr(request.displayName, 100) || 'FinTrack User';

  if (decision === 'approved') {
    const periodKey = `sub-${Math.floor(nowMs / 1000)}-c0`;
    const subRef = doc(db, 'vipSubscriptions', request.userId);
    const existingSubSnap = await getDoc(subRef);
    const subPaymentRef = clampStr(
      `FTVIP-${request.paymentReference.replace(/^FTPAY-/, '')}`,
      100
    );

    const subPayload = {
      userId: request.userId,
      tier: request.tier,
      billingCycle: request.billingCycle,
      status: 'active',
      priceInr: request.amountInr,
      paymentReference: subPaymentRef,
      periodKey,
      periodStartAt: serverTimestamp(),
      periodEndAt: Timestamp.fromMillis(nowMs + cycleSpec.days * 24 * 60 * 60 * 1000),
      autoRenew: true,
      updatedBy: ADMIN_EMAIL,
      updatedAt: serverTimestamp(),
    };

    if (!existingSubSnap.exists()) {
      batch.set(subRef, {
        ...subPayload,
        createdAt: serverTimestamp(),
      });
    } else {
      batch.update(subRef, subPayload);
    }

    const monthEndMs = nowMs + 30 * 24 * 60 * 60 * 1000;
    batch.set(doc(db, 'aiUsage', request.userId), {
      userId: request.userId,
      tier: request.tier,
      periodKey,
      periodStartAt: Timestamp.fromMillis(nowMs),
      periodEndAt: Timestamp.fromMillis(monthEndMs),
      insightsUsed: 0,
      insightsLimit: tierSpec.insightsLimit,
      advisorUsed: 0,
      advisorLimit: tierSpec.advisorLimit,
      forecastUsed: 0,
      lastResetAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const secRef = doc(db, 'securityProfiles', request.userId);
    const secSnap = await getDoc(secRef);
    const nextVipStatus: VipStatus = request.tier === 'starter' ? 'none' : 'vip';

    if (!secSnap.exists()) {
      batch.set(secRef, {
        userId: request.userId,
        userEmail: cleanEmail,
        displayName: cleanDisplayName,
        restrictionStatus: 'active',
        banType: 'none',
        banReason: '',
        banDurationLabel: '',
        banDurationMs: 0,
        banStartedAt: null,
        banExpiresAt: null,
        aiRestrictedUntil: null,
        messagingRestrictedUntil: null,
        warningCount: 0,
        lastWarningAt: null,
        riskLevel: 'low',
        riskScore: 0,
        underInvestigation: false,
        vipStatus: nextVipStatus,
        eventCount: 0,
        lastEventAt: null,
        updatedBy: ADMIN_EMAIL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.update(secRef, {
        vipStatus: nextVipStatus,
        updatedBy: ADMIN_EMAIL,
        updatedAt: serverTimestamp(),
      });
    }
  }

  const auditId = generateDocId();
  batch.set(doc(db, 'securityAuditLogs', auditId), {
    targetUserId: request.userId,
    targetUserEmail: cleanEmail,
    adminEmail: ADMIN_EMAIL,
    actionType: 'update_vip_status',
    reason: clampStr(
      cleanNote ||
        (decision === 'approved'
          ? `Confirmed UPI payment (UTR: ${request.utrReference}) to ${request.upiId}`
          : `Rejected UPI payment (UTR: ${request.utrReference})`),
      500
    ),
    details: clampStr(
      `${decision === 'approved' ? 'Approved' : 'Rejected'} ${tierSpec.classLabel} ${tierSpec.name} (${cycleSpec.label}, ₹${request.amountInr}) · Ref ${request.paymentReference} · UTR ${request.utrReference}`,
      1000
    ),
    durationLabel: cycleSpec.label,
    createdAt: serverTimestamp(),
  });

  const msgId = generateDocId();
  const userMessage =
    decision === 'approved'
      ? `Your UPI payment of ₹${request.amountInr} (UTR: ${request.utrReference}) for ${tierSpec.classLabel} — ${tierSpec.name} (${cycleSpec.label}) has been CONFIRMED. Your VIP features are now active.${cleanNote ? ` Admin note: ${cleanNote}` : ''}`
      : `Your UPI payment verification request of ₹${request.amountInr} (UTR: ${request.utrReference}) for ${tierSpec.classLabel} — ${tierSpec.name} (${cycleSpec.label}) was REJECTED.${cleanNote ? ` Reason: ${cleanNote}` : ''} VIP features remain locked.`;

  batch.set(doc(db, 'users', request.userId, 'adminMessages', msgId), {
    userId: request.userId,
    heading: decision === 'approved' ? 'VIP PAYMENT CONFIRMED' : 'VIP PAYMENT REJECTED',
    message: clampStr(userMessage, 1500),
    senderEmail: ADMIN_EMAIL,
    isRead: false,
    readAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `vipPaymentRequests/${request.id}`);
  }
}
