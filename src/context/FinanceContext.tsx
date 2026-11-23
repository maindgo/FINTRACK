import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  BillRecord,
  BudgetRecord,
  CurrencyCode,
  DebtRecord,
  RecordPayment,
  RecurringTransaction,
  SavingsGoal,
  ThemeMode,
  TransactionRecord,
  UserProfile,
} from '../types/finance';
import {
  ensureUserProfile,
  runRecurringTransactionNow,
  updateUserProfile,
} from '../services/firestoreService';
import { getTodayStr } from '../utils/formatters';

interface FinanceContextValue {
  user: User | null;
  authReady: boolean;
  dataLoading: boolean;
  profile: UserProfile | null;
  currency: CurrencyCode;
  theme: ThemeMode;
  transactions: TransactionRecord[];
  savingsGoals: SavingsGoal[];
  budgets: BudgetRecord[];
  debtRecords: DebtRecord[];
  recordPayments: RecordPayment[];
  bills: BillRecord[];
  recurringTransactions: RecurringTransaction[];
  toggleTheme: () => Promise<void>;
  setCurrency: (code: CurrencyCode) => Promise<void>;
  refreshAuthUser: () => Promise<void>;
}

const FinanceContext = createContext<FinanceContextValue | undefined>(undefined);

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem('fintrack-theme') === 'dark' ? 'dark' : 'light';
    }
    return 'light';
  });

  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [budgets, setBudgets] = useState<BudgetRecord[]>([]);
  const [debtRecords, setDebtRecords] = useState<DebtRecord[]>([]);
  const [recordPayments, setRecordPayments] = useState<RecordPayment[]>([]);
  const [bills, setBills] = useState<BillRecord[]>([]);
  const [recurringTransactions, setRecurringTransactions] = useState<RecurringTransaction[]>([]);

  const profileInitAttempted = useRef<string | null>(null);
  const recurringProcessedSession = useRef<Set<string>>(new Set());

  // Apply theme class to <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    window.localStorage.setItem('fintrack-theme', theme);
  }, [theme]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setProfile(null);
        setTransactions([]);
        setSavingsGoals([]);
        setBudgets([]);
        setDebtRecords([]);
        setRecordPayments([]);
        setBills([]);
        setRecurringTransactions([]);
        setDataLoading(false);
        profileInitAttempted.current = null;
        recurringProcessedSession.current.clear();
      }
    });
    return () => unsub();
  }, []);

  const refreshAuthUser = useCallback(async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload();
      setUser({ ...auth.currentUser } as User);
    }
  }, []);

  // Attach real-time Firestore listeners ONLY when authenticated and verified
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) {
      if (authReady) setDataLoading(false);
      return;
    }

    setDataLoading(true);
    const uid = user.uid;

    const unsubProfile = onSnapshot(
      doc(db, 'users', uid),
      async (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setProfile(data);
          if (data.theme === 'dark' || data.theme === 'light') {
            setTheme(data.theme);
          }
        } else if (profileInitAttempted.current !== uid) {
          profileInitAttempted.current = uid;
          await ensureUserProfile(
            uid,
            user.email || 'user@fintrack.app',
            user.displayName || user.email?.split('@')[0] || 'FinTrack User'
          );
        }
        setDataLoading(false);
      },
      (error) => handleFirestoreError(error, OperationType.GET, `users/${uid}`)
    );

    const unsubTransactions = onSnapshot(
      query(collection(db, 'users', uid, 'transactions'), where('userId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as TransactionRecord));
        list.sort((a, b) => {
          const cmp = b.date.localeCompare(a.date);
          if (cmp !== 0) return cmp;
          return (b.time || '').localeCompare(a.time || '');
        });
        setTransactions(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/transactions`)
    );

    const unsubGoals = onSnapshot(
      query(collection(db, 'users', uid, 'savingsGoals'), where('userId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SavingsGoal));
        list.sort((a, b) => a.targetDate.localeCompare(b.targetDate));
        setSavingsGoals(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/savingsGoals`)
    );

    const unsubBudgets = onSnapshot(
      query(collection(db, 'users', uid, 'budgets'), where('userId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BudgetRecord));
        setBudgets(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/budgets`)
    );

    const unsubDebts = onSnapshot(
      query(collection(db, 'users', uid, 'debtRecords'), where('userId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DebtRecord));
        list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        setDebtRecords(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/debtRecords`)
    );

    const unsubPayments = onSnapshot(
      query(collection(db, 'users', uid, 'recordPayments'), where('userId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RecordPayment));
        list.sort((a, b) => b.date.localeCompare(a.date));
        setRecordPayments(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/recordPayments`)
    );

    const unsubBills = onSnapshot(
      query(collection(db, 'users', uid, 'bills'), where('userId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BillRecord));
        list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        setBills(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/bills`)
    );

    const unsubRecurring = onSnapshot(
      query(collection(db, 'users', uid, 'recurringTransactions'), where('userId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as RecurringTransaction));
        list.sort((a, b) => a.nextRunDate.localeCompare(b.nextRunDate));
        setRecurringTransactions(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/recurringTransactions`)
    );

    return () => {
      unsubProfile();
      unsubTransactions();
      unsubGoals();
      unsubBudgets();
      unsubDebts();
      unsubPayments();
      unsubBills();
      unsubRecurring();
    };
  }, [authReady, user]);

  // Execute due recurring transactions automatically once per rule per session
  useEffect(() => {
    if (!user || !user.emailVerified || recurringTransactions.length === 0) return;
    const today = getTodayStr();
    const dueRules = recurringTransactions.filter(
      (r) =>
        r.isActive &&
        r.nextRunDate <= today &&
        !recurringProcessedSession.current.has(`${r.id}:${r.nextRunDate}`)
    );

    if (dueRules.length === 0) return;

    dueRules.forEach(async (rule) => {
      const key = `${rule.id}:${rule.nextRunDate}`;
      recurringProcessedSession.current.add(key);
      try {
        await runRecurringTransactionNow(user.uid, rule);
      } catch (err) {
        console.error('Failed to auto-run recurring rule:', err);
      }
    });
  }, [user, recurringTransactions]);

  const toggleTheme = useCallback(async () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (user && user.emailVerified && profile) {
      await updateUserProfile(user.uid, { theme: next });
    }
  }, [theme, user, profile]);

  const setCurrency = useCallback(
    async (code: CurrencyCode) => {
      if (user && user.emailVerified && profile) {
        await updateUserProfile(user.uid, { currency: code });
      }
    },
    [user, profile]
  );

  const currency: CurrencyCode = profile?.currency || 'INR';

  return (
    <FinanceContext.Provider
      value={{
        user,
        authReady,
        dataLoading,
        profile,
        currency,
        theme,
        transactions,
        savingsGoals,
        budgets,
        debtRecords,
        recordPayments,
        bills,
        recurringTransactions,
        toggleTheme,
        setCurrency,
        refreshAuthUser,
      }}
    >
      {children}
    </FinanceContext.Provider>
  );
}

export function useFinance(): FinanceContextValue {
  const ctx = useContext(FinanceContext);
  if (!ctx) {
    throw new Error('useFinance must be used inside FinanceProvider');
  }
  return ctx;
}
