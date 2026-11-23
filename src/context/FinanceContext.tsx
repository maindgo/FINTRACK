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
import {
  clearGuestStoreData,
  getGuestRecordCount,
  GUEST_EVENT,
  GUEST_UID,
  isGuestSessionActive,
  loadGuestStore,
  migrateGuestStoreToFirestore,
  setGuestSessionActive,
} from '../services/guestStore';
import { getTodayStr } from '../utils/formatters';

interface FinanceContextValue {
  user: User | null;
  firebaseUser: User | null;
  isGuest: boolean;
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
  pendingGuestMigrationCount: number;
  toggleTheme: () => Promise<void>;
  setCurrency: (code: CurrencyCode) => Promise<void>;
  refreshAuthUser: () => Promise<void>;
  enterGuestMode: () => void;
  exitGuestMode: () => void;
  migrateGuestToCloud: () => Promise<number>;
  dismissGuestMigration: () => void;
}

const FinanceContext = createContext<FinanceContextValue | undefined>(undefined);

function sortTransactions(list: TransactionRecord[]): TransactionRecord[] {
  return [...list].sort((a, b) => {
    const cmp = b.date.localeCompare(a.date);
    if (cmp !== 0) return cmp;
    return (b.time || '').localeCompare(a.time || '');
  });
}

export function FinanceProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [guestActive, setGuestActive] = useState<boolean>(() => isGuestSessionActive());
  const [authReady, setAuthReady] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [pendingGuestMigrationCount, setPendingGuestMigrationCount] = useState(0);
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

  const isGuest = guestActive && !firebaseUser;

  const user: User | null = firebaseUser
    ? firebaseUser
    : isGuest
    ? ({
        uid: GUEST_UID,
        email: profile?.email || 'guest@local.fintrack',
        displayName: profile?.displayName || 'Guest User',
        emailVerified: true,
      } as unknown as User)
    : null;

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
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setFirebaseUser(nextUser);
      setAuthReady(true);

      if (nextUser) {
        if (isGuestSessionActive()) {
          setGuestSessionActive(false);
          setGuestActive(false);
        }
        if (nextUser.emailVerified) {
          setPendingGuestMigrationCount(getGuestRecordCount());
        }
      } else {
        setPendingGuestMigrationCount(0);
        const guestOn = isGuestSessionActive();
        setGuestActive(guestOn);
        if (!guestOn) {
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
      }
    });
    return () => unsub();
  }, []);

  const refreshAuthUser = useCallback(async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload();
      const reloaded = { ...auth.currentUser } as User;
      setFirebaseUser(reloaded);
      if (reloaded.emailVerified) {
        setPendingGuestMigrationCount(getGuestRecordCount());
      }
    }
  }, []);

  const enterGuestMode = useCallback(() => {
    recurringProcessedSession.current.clear();
    setGuestSessionActive(true);
    setGuestActive(true);
  }, []);

  const exitGuestMode = useCallback(() => {
    recurringProcessedSession.current.clear();
    setGuestSessionActive(false);
    setGuestActive(false);
    setProfile(null);
    setTransactions([]);
    setSavingsGoals([]);
    setBudgets([]);
    setDebtRecords([]);
    setRecordPayments([]);
    setBills([]);
    setRecurringTransactions([]);
    setDataLoading(false);
  }, []);

  const migrateGuestToCloud = useCallback(async (): Promise<number> => {
    if (!firebaseUser || !firebaseUser.emailVerified) return 0;
    const count = await migrateGuestStoreToFirestore(firebaseUser.uid);
    setPendingGuestMigrationCount(0);
    return count;
  }, [firebaseUser]);

  const dismissGuestMigration = useCallback(() => {
    clearGuestStoreData();
    setPendingGuestMigrationCount(0);
  }, []);

  // Guest Mode localStorage synchronization
  useEffect(() => {
    if (!authReady || !isGuest) return;

    const syncFromGuestStore = () => {
      const activeNow = isGuestSessionActive();
      if (!activeNow) {
        setGuestActive(false);
        return;
      }
      const store = loadGuestStore();
      setProfile(store.profile);
      if (store.profile.theme === 'dark' || store.profile.theme === 'light') {
        setTheme(store.profile.theme);
      }
      setTransactions(sortTransactions(store.transactions));
      setSavingsGoals([...store.savingsGoals].sort((a, b) => a.targetDate.localeCompare(b.targetDate)));
      setBudgets([...store.budgets]);
      setDebtRecords([...store.debtRecords].sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
      setRecordPayments([...store.recordPayments].sort((a, b) => b.date.localeCompare(a.date)));
      setBills([...store.bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
      setRecurringTransactions(
        [...store.recurringTransactions].sort((a, b) => a.nextRunDate.localeCompare(b.nextRunDate))
      );
      setDataLoading(false);
    };

    syncFromGuestStore();
    window.addEventListener(GUEST_EVENT, syncFromGuestStore);
    window.addEventListener('storage', syncFromGuestStore);
    return () => {
      window.removeEventListener(GUEST_EVENT, syncFromGuestStore);
      window.removeEventListener('storage', syncFromGuestStore);
    };
  }, [authReady, isGuest]);

  // Attach real-time Firestore listeners ONLY when authenticated and verified
  useEffect(() => {
    if (!authReady || !firebaseUser || !firebaseUser.emailVerified) {
      if (authReady && !isGuest) setDataLoading(false);
      return;
    }

    setDataLoading(true);
    const uid = firebaseUser.uid;

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
            firebaseUser.email || 'user@fintrack.app',
            firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'FinTrack User'
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
        setTransactions(sortTransactions(list));
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
  }, [authReady, firebaseUser, isGuest]);

  const activeUid =
    isGuest
      ? GUEST_UID
      : firebaseUser && firebaseUser.emailVerified
      ? firebaseUser.uid
      : null;

  // Execute due recurring transactions automatically once per rule per session
  useEffect(() => {
    if (!activeUid || recurringTransactions.length === 0) return;
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
        await runRecurringTransactionNow(activeUid, rule);
      } catch (err) {
        console.error('Failed to auto-run recurring rule:', err);
      }
    });
  }, [activeUid, recurringTransactions]);

  const toggleTheme = useCallback(async () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (activeUid && profile) {
      await updateUserProfile(activeUid, { theme: next });
    }
  }, [theme, activeUid, profile]);

  const setCurrency = useCallback(
    async (code: CurrencyCode) => {
      if (activeUid && profile) {
        await updateUserProfile(activeUid, { currency: code });
      }
    },
    [activeUid, profile]
  );

  const currency: CurrencyCode = profile?.currency || 'INR';

  return (
    <FinanceContext.Provider
      value={{
        user,
        firebaseUser,
        isGuest,
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
        pendingGuestMigrationCount,
        toggleTheme,
        setCurrency,
        refreshAuthUser,
        enterGuestMode,
        exitGuestMode,
        migrateGuestToCloud,
        dismissGuestMigration,
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
