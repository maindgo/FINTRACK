import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import {
  AdminMessage,
  AiUsageRecord,
  AiUsageSummary,
  BanType,
  BillRecord,
  BrowserNotificationPermission,
  BudgetRecord,
  CurrencyCode,
  DebtRecord,
  FinTrackNotification,
  NotificationPrefs,
  RecordPayment,
  RecurringTransaction,
  SavingsGoal,
  SecurityAppeal,
  SecurityProfile,
  ThemeMode,
  TransactionRecord,
  UserProfile,
  VipPaymentRequest,
  VipStatus,
  VipSubscription,
  VipTier,
} from '../types/finance';
import {
  ensureUserProfile,
  logClientSecurityEvent,
  markAdminMessageRead,
  runRecurringTransactionNow,
  setMaintenanceMode,
  subscribeAllVipPaymentRequestsForAdmin,
  subscribeToMaintenanceConfig,
  subscribeUserAiUsage,
  subscribeUserAppeals,
  subscribeUserSecurityProfile,
  subscribeUserVipPaymentRequests,
  subscribeUserVipSubscription,
  updateUserProfile,
} from '../services/firestoreService';
import { fetchVipStatus } from '../services/aiInsightsService';
import { isVipTier, VIP_TIER_CONFIGS } from '../utils/vipTiers';
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
import {
  DEFAULT_NOTIFICATION_PREFS,
  dispatchNewNotificationsToDeviceBar,
  getBrowserNotificationPermission,
  loadNotificationPrefs,
  registerNotificationServiceWorker,
  requestMobileNotificationPermission,
  saveNotificationPrefs,
  sendTestSystemNotification,
} from '../services/notificationService';
import { ADMIN_EMAIL } from '../utils/constants';
import { getTodayStr } from '../utils/formatters';
import { computeFinTrackNotifications } from '../utils/notifications';

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
  notificationPrefs: NotificationPrefs;
  notifications: FinTrackNotification[];
  unreadNotificationCount: number;
  notificationPermission: BrowserNotificationPermission;
  toggleTheme: () => Promise<void>;
  setCurrency: (code: CurrencyCode) => Promise<void>;
  refreshAuthUser: () => Promise<void>;
  enterGuestMode: () => void;
  exitGuestMode: () => void;
  migrateGuestToCloud: () => Promise<number>;
  dismissGuestMigration: () => void;
  enableMobileNotifications: () => Promise<BrowserNotificationPermission>;
  updateNotificationPrefs: (updater: (prev: NotificationPrefs) => NotificationPrefs) => void;
  markNotificationRead: (signature: string) => void;
  markAllNotificationsRead: () => void;
  dismissNotification: (signature: string) => void;
  restoreDismissedNotifications: () => void;
  sendTestNotification: () => Promise<{ ok: boolean; message: string }>;
  isAdmin: boolean;
  isAccountDeactivated: boolean;
  securityProfile: SecurityProfile | null;
  userAppeals: SecurityAppeal[];
  isAccountBanned: boolean;
  activeBanType: BanType;
  banExpiresAtMs: number | null;
  isAiRestricted: boolean;
  aiRestrictedUntilMs: number | null;
  isMessagingRestricted: boolean;
  messagingRestrictedUntilMs: number | null;
  vipStatus: VipStatus;
  vipTier: VipTier;
  vipSubscription: VipSubscription | null;
  userVipPaymentRequests: VipPaymentRequest[];
  adminVipPaymentRequests: VipPaymentRequest[];
  pendingVipRequestCount: number;
  aiUsageSummary: AiUsageSummary;
  applyBackendAiUsage: (usage?: AiUsageSummary | null) => void;
  refreshVipFromBackend: () => Promise<void>;
  adminMessages: AdminMessage[];
  acknowledgeAdminMessage: (messageId: string) => Promise<void>;
  updateOpeningBalances: (bankAmount: number, cashAmount: number) => Promise<void>;
  maintenanceEnabled: boolean;
  maintenanceLoading: boolean;
  maintenanceUpdating: boolean;
  setMaintenanceEnabledMode: (enabled: boolean) => Promise<void>;
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
  const [adminMessages, setAdminMessages] = useState<AdminMessage[]>([]);
  const [securityProfile, setSecurityProfile] = useState<SecurityProfile | null>(null);
  const [vipSubscription, setVipSubscription] = useState<VipSubscription | null>(null);
  const [userVipPaymentRequests, setUserVipPaymentRequests] = useState<VipPaymentRequest[]>([]);
  const [adminVipPaymentRequests, setAdminVipPaymentRequests] = useState<VipPaymentRequest[]>([]);
  const [aiUsageRecord, setAiUsageRecord] = useState<AiUsageRecord | null>(null);
  const [backendAiUsageOverride, setBackendAiUsageOverride] = useState<AiUsageSummary | null>(null);
  const [userAppeals, setUserAppeals] = useState<SecurityAppeal[]>([]);
  const [securityNowMs, setSecurityNowMs] = useState<number>(() => Date.now());
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [notificationPermission, setNotificationPermission] = useState<BrowserNotificationPermission>(() =>
    getBrowserNotificationPermission()
  );

  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceLoading, setMaintenanceLoading] = useState(true);
  const [maintenanceUpdating, setMaintenanceUpdating] = useState(false);

  const profileInitAttempted = useRef<string | null>(null);
  const recurringProcessedSession = useRef<Set<string>>(new Set());

  const isGuest = guestActive && !firebaseUser;
  const isAdmin = Boolean(
    firebaseUser &&
      firebaseUser.emailVerified &&
      firebaseUser.email?.toLowerCase() === ADMIN_EMAIL
  );
  const isAccountDeactivated = Boolean(
    firebaseUser && !isGuest && !isAdmin && profile?.accountStatus === 'deactivated'
  );

  const banExpiresAtMs = securityProfile?.banExpiresAt
    ? securityProfile.banExpiresAt.toMillis()
    : null;
  const aiRestrictedUntilMs = securityProfile?.aiRestrictedUntil
    ? securityProfile.aiRestrictedUntil.toMillis()
    : null;
  const messagingRestrictedUntilMs = securityProfile?.messagingRestrictedUntil
    ? securityProfile.messagingRestrictedUntil.toMillis()
    : null;

  const isPermanentBan = Boolean(
    firebaseUser &&
      !isGuest &&
      !isAdmin &&
      securityProfile &&
      (securityProfile.banType === 'permanent' ||
        securityProfile.restrictionStatus === 'perm_banned')
  );
  const isTemporaryBan = Boolean(
    firebaseUser &&
      !isGuest &&
      !isAdmin &&
      securityProfile &&
      (securityProfile.banType === 'temporary' ||
        securityProfile.restrictionStatus === 'temp_banned') &&
      banExpiresAtMs !== null &&
      banExpiresAtMs > securityNowMs
  );

  const activeBanType: BanType = isPermanentBan
    ? 'permanent'
    : isTemporaryBan
    ? 'temporary'
    : 'none';
  const isAccountBanned = activeBanType !== 'none';

  const isAiRestricted = Boolean(
    firebaseUser &&
      !isGuest &&
      !isAdmin &&
      aiRestrictedUntilMs !== null &&
      aiRestrictedUntilMs > securityNowMs
  );
  const isMessagingRestricted = Boolean(
    firebaseUser &&
      !isGuest &&
      !isAdmin &&
      messagingRestrictedUntilMs !== null &&
      messagingRestrictedUntilMs > securityNowMs
  );

  const subPeriodEndMs = vipSubscription?.periodEndAt
    ? vipSubscription.periodEndAt.toMillis()
    : vipSubscription?.periodEndIso
    ? Date.parse(vipSubscription.periodEndIso)
    : null;
  const isSubWindowActive = Boolean(
    vipSubscription &&
      vipSubscription.status === 'active' &&
      isVipTier(vipSubscription.tier) &&
      (subPeriodEndMs === null || subPeriodEndMs > securityNowMs)
  );

  const vipTier: VipTier = isAdmin
    ? 'diamond'
    : isSubWindowActive && vipSubscription
    ? vipSubscription.tier
    : securityProfile?.vipStatus === 'vip'
    ? 'gold'
    : 'starter';

  const vipStatus: VipStatus =
    isAdmin || vipTier !== 'starter' || securityProfile?.vipStatus === 'vip' ? 'vip' : 'none';

  const aiUsageSummary: AiUsageSummary = React.useMemo(() => {
    const tierCfg = VIP_TIER_CONFIGS[vipTier];
    const now = new Date(securityNowMs);
    const utcMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const utcMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const utcKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const recordEndMs = aiUsageRecord?.periodEndAt
      ? aiUsageRecord.periodEndAt.toMillis()
      : aiUsageRecord?.periodEndIso
      ? Date.parse(aiUsageRecord.periodEndIso)
      : null;

    if (
      backendAiUsageOverride &&
      backendAiUsageOverride.tier === vipTier &&
      Date.parse(backendAiUsageOverride.periodEndIso) > securityNowMs
    ) {
      return backendAiUsageOverride;
    }

    const recordStillActive = Boolean(
      aiUsageRecord &&
        aiUsageRecord.tier === vipTier &&
        (recordEndMs === null || recordEndMs > securityNowMs)
    );

    const insightsUsed = recordStillActive && aiUsageRecord ? Math.max(0, aiUsageRecord.insightsUsed) : 0;
    const advisorUsed = recordStillActive && aiUsageRecord ? Math.max(0, aiUsageRecord.advisorUsed) : 0;
    const forecastUsed = recordStillActive && aiUsageRecord ? Math.max(0, aiUsageRecord.forecastUsed) : 0;

    const periodStartIso =
      recordStillActive && aiUsageRecord?.periodStartAt
        ? aiUsageRecord.periodStartAt.toDate().toISOString()
        : utcMonthStart.toISOString();
    const periodEndIso =
      recordStillActive && aiUsageRecord?.periodEndAt
        ? aiUsageRecord.periodEndAt.toDate().toISOString()
        : utcMonthEnd.toISOString();
    const lastResetIso =
      recordStillActive && aiUsageRecord?.lastResetAt
        ? aiUsageRecord.lastResetAt.toDate().toISOString()
        : periodStartIso;

    return {
      tier: vipTier,
      periodKey: recordStillActive && aiUsageRecord ? aiUsageRecord.periodKey : utcKey,
      periodStartIso,
      periodEndIso,
      insightsUsed,
      insightsLimit: tierCfg.insightsLimit,
      insightsRemaining: Math.max(0, tierCfg.insightsLimit - insightsUsed),
      advisorUsed,
      advisorLimit: tierCfg.advisorLimit,
      advisorRemaining: Math.max(0, tierCfg.advisorLimit - advisorUsed),
      forecastUsed,
      lastResetIso,
    };
  }, [vipTier, aiUsageRecord, backendAiUsageOverride, securityNowMs]);

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

  // Listen to global app maintenance status (non-PII config document)
  useEffect(() => {
    const unsub = subscribeToMaintenanceConfig(
      (cfg) => {
        setMaintenanceEnabled(cfg.enabled);
        setMaintenanceLoading(false);
      },
      () => {
        setMaintenanceLoading(false);
      }
    );
    return () => unsub();
  }, []);

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
          setAdminMessages([]);
          setSecurityProfile(null);
          setVipSubscription(null);
          setUserVipPaymentRequests([]);
          setAdminVipPaymentRequests([]);
          setAiUsageRecord(null);
          setBackendAiUsageOverride(null);
          setUserAppeals([]);
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
    setAdminMessages([]);
    setSecurityProfile(null);
    setVipSubscription(null);
    setUserVipPaymentRequests([]);
    setAdminVipPaymentRequests([]);
    setAiUsageRecord(null);
    setBackendAiUsageOverride(null);
    setUserAppeals([]);
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

  // Auto-refresh restriction clock while temporary bans/restrictions are active
  useEffect(() => {
    const hasPendingExpiry =
      (banExpiresAtMs !== null && banExpiresAtMs > securityNowMs) ||
      (aiRestrictedUntilMs !== null && aiRestrictedUntilMs > securityNowMs) ||
      (messagingRestrictedUntilMs !== null && messagingRestrictedUntilMs > securityNowMs);

    if (!hasPendingExpiry) return;
    const timer = window.setInterval(() => {
      setSecurityNowMs(Date.now());
    }, 5000);
    return () => window.clearInterval(timer);
  }, [banExpiresAtMs, aiRestrictedUntilMs, messagingRestrictedUntilMs, securityNowMs]);

  // Listen for Firestore permission-denied events and log security telemetry safely
  useEffect(() => {
    if (typeof window === 'undefined' || !firebaseUser || !firebaseUser.emailVerified) return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{
        uid?: string;
        email?: string;
        operationType?: string;
        path?: string;
      }>).detail;
      if (!detail || !detail.uid || !detail.path) return;
      const isForeignUserPath =
        detail.path.startsWith('users/') && !detail.path.startsWith(`users/${detail.uid}`);
      void logClientSecurityEvent({
        userId: detail.uid,
        userEmail: detail.email || '',
        category: isForeignUserPath ? 'data_security' : 'api_backend_security',
        eventType: isForeignUserPath ? 'cross_user_record_access' : 'unauthorized_firebase_access',
        riskLevel: isForeignUserPath ? 'high' : 'medium',
        summary: isForeignUserPath
          ? `Blocked attempt to access another user's path (${detail.path})`
          : `Firestore permission denied on ${detail.operationType || 'operation'} (${detail.path})`,
        evidence: `operation=${detail.operationType || 'unknown'}, path=${detail.path}`,
      });
    };
    window.addEventListener('fintrack-firestore-denied', handler);
    return () => window.removeEventListener('fintrack-firestore-denied', handler);
  }, [firebaseUser]);

  // Attach profile, admin messages, and security listeners when authenticated and verified
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
          const pendingName =
            typeof window !== 'undefined'
              ? window.localStorage.getItem('fintrack-pending-displayname') || ''
              : '';
          if (pendingName && typeof window !== 'undefined') {
            window.localStorage.removeItem('fintrack-pending-displayname');
          }
          await ensureUserProfile(
            uid,
            firebaseUser.email || 'user@fintrack.app',
            firebaseUser.displayName ||
              pendingName ||
              firebaseUser.email?.split('@')[0] ||
              'FinTrack User'
          );
        }
        setDataLoading(false);
      },
      (error) => handleFirestoreError(error, OperationType.GET, `users/${uid}`)
    );

    const unsubAdminMessages = onSnapshot(
      query(collection(db, 'users', uid, 'adminMessages'), where('userId', '==', uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as AdminMessage));
        list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
        setAdminMessages(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `users/${uid}/adminMessages`)
    );

    const unsubSecurityProfile = subscribeUserSecurityProfile(
      uid,
      (sec) => {
        setSecurityProfile(sec);
        setSecurityNowMs(Date.now());
      },
      () => setSecurityProfile(null)
    );

    const unsubVipSub = subscribeUserVipSubscription(
      uid,
      (sub) => {
        setVipSubscription(sub);
        setSecurityNowMs(Date.now());
      },
      () => setVipSubscription(null)
    );

    const unsubAiUsage = subscribeUserAiUsage(
      uid,
      (usage) => {
        setAiUsageRecord(usage);
        setBackendAiUsageOverride(null);
        setSecurityNowMs(Date.now());
      },
      () => setAiUsageRecord(null)
    );

    const unsubAppeals = subscribeUserAppeals(
      uid,
      (appeals) => setUserAppeals(appeals),
      () => setUserAppeals([])
    );

    const unsubUserVipRequests = subscribeUserVipPaymentRequests(
      uid,
      (reqs) => setUserVipPaymentRequests(reqs),
      () => setUserVipPaymentRequests([])
    );

    return () => {
      unsubProfile();
      unsubAdminMessages();
      unsubSecurityProfile();
      unsubVipSub();
      unsubAiUsage();
      unsubAppeals();
      unsubUserVipRequests();
    };
  }, [authReady, firebaseUser, isGuest]);

  // Listen to all VIP UPI payment requests when signed in as verified Admin
  useEffect(() => {
    if (!authReady || !isAdmin) {
      setAdminVipPaymentRequests([]);
      return;
    }
    const unsub = subscribeAllVipPaymentRequestsForAdmin(
      (reqs) => setAdminVipPaymentRequests(reqs),
      () => setAdminVipPaymentRequests([])
    );
    return () => unsub();
  }, [authReady, isAdmin]);

  // Attach protected financial collection listeners ONLY when account is active and NOT banned/deactivated
  useEffect(() => {
    if (
      !authReady ||
      !firebaseUser ||
      !firebaseUser.emailVerified ||
      isAccountDeactivated ||
      isAccountBanned
    ) {
      if (isAccountDeactivated || isAccountBanned) {
        setTransactions([]);
        setSavingsGoals([]);
        setBudgets([]);
        setDebtRecords([]);
        setRecordPayments([]);
        setBills([]);
        setRecurringTransactions([]);
      }
      return;
    }

    const uid = firebaseUser.uid;

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
      unsubTransactions();
      unsubGoals();
      unsubBudgets();
      unsubDebts();
      unsubPayments();
      unsubBills();
      unsubRecurring();
    };
  }, [authReady, firebaseUser, isAccountDeactivated, isAccountBanned]);

  const activeUid =
    isGuest
      ? GUEST_UID
      : firebaseUser && firebaseUser.emailVerified && !isAccountDeactivated && !isAccountBanned
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

  const updateOpeningBalances = useCallback(
    async (bankAmount: number, cashAmount: number) => {
      if (!activeUid) return;
      await updateUserProfile(activeUid, {
        openingBankBalance: Math.max(0, Number(bankAmount) || 0),
        openingCashBalance: Math.max(0, Number(cashAmount) || 0),
      });
    },
    [activeUid]
  );

  const currency: CurrencyCode = profile?.currency || 'INR';

  // Register notification service worker & sync permission state on focus
  useEffect(() => {
    registerNotificationServiceWorker();
    const syncPermission = () => setNotificationPermission(getBrowserNotificationPermission());
    syncPermission();
    window.addEventListener('focus', syncPermission);
    document.addEventListener('visibilitychange', syncPermission);
    return () => {
      window.removeEventListener('focus', syncPermission);
      document.removeEventListener('visibilitychange', syncPermission);
    };
  }, []);

  // Load device notification preferences for the active user
  useEffect(() => {
    if (!activeUid) {
      setNotificationPrefs(DEFAULT_NOTIFICATION_PREFS);
      return;
    }
    setNotificationPrefs(loadNotificationPrefs(activeUid));
  }, [activeUid]);

  const updateNotificationPrefs = useCallback(
    (updater: (prev: NotificationPrefs) => NotificationPrefs) => {
      setNotificationPrefs((prev) => {
        const next = updater(prev);
        if (activeUid) {
          saveNotificationPrefs(activeUid, next);
        }
        return next;
      });
    },
    [activeUid]
  );

  const enableMobileNotifications = useCallback(async (): Promise<BrowserNotificationPermission> => {
    const perm = await requestMobileNotificationPermission();
    setNotificationPermission(perm);
    if (perm === 'granted') {
      updateNotificationPrefs((prev) => ({
        ...prev,
        enabled: true,
        pushToDeviceBar: true,
      }));
    }
    return perm;
  }, [updateNotificationPrefs]);

  const allComputedNotifications = React.useMemo(() => {
    if (!activeUid || !notificationPrefs.enabled) return [];
    return computeFinTrackNotifications({
      transactions,
      budgets,
      bills,
      debtRecords,
      savingsGoals,
      recurringTransactions,
      monthlyBudgetLimit: profile?.monthlyBudgetLimit || 0,
      currency,
      categories: notificationPrefs.categories,
    });
  }, [
    activeUid,
    notificationPrefs.enabled,
    notificationPrefs.categories,
    transactions,
    budgets,
    bills,
    debtRecords,
    savingsGoals,
    recurringTransactions,
    profile?.monthlyBudgetLimit,
    currency,
  ]);

  const notifications = React.useMemo(() => {
    const dismissedSet = new Set(notificationPrefs.dismissedSignatures);
    return allComputedNotifications.filter((n) => !dismissedSet.has(n.signature));
  }, [allComputedNotifications, notificationPrefs.dismissedSignatures]);

  const unreadNotificationCount = React.useMemo(() => {
    const readSet = new Set(notificationPrefs.readSignatures);
    return notifications.filter((n) => !readSet.has(n.signature)).length;
  }, [notifications, notificationPrefs.readSignatures]);

  // Dispatch newly triggered alerts to the mobile/OS notification bar when permission is granted
  useEffect(() => {
    if (
      !activeUid ||
      dataLoading ||
      !notificationPrefs.enabled ||
      !notificationPrefs.pushToDeviceBar ||
      notificationPermission !== 'granted' ||
      notifications.length === 0
    ) {
      return;
    }

    const readSet = new Set(notificationPrefs.readSignatures);
    const unread = notifications.filter((n) => !readSet.has(n.signature));
    if (unread.length === 0) return;

    void dispatchNewNotificationsToDeviceBar(activeUid, unread, getTodayStr());
  }, [
    activeUid,
    dataLoading,
    notificationPrefs.enabled,
    notificationPrefs.pushToDeviceBar,
    notificationPrefs.readSignatures,
    notificationPermission,
    notifications,
  ]);

  const markNotificationRead = useCallback(
    (signature: string) => {
      updateNotificationPrefs((prev) =>
        prev.readSignatures.includes(signature)
          ? prev
          : { ...prev, readSignatures: [...prev.readSignatures, signature] }
      );
    },
    [updateNotificationPrefs]
  );

  const markAllNotificationsRead = useCallback(() => {
    updateNotificationPrefs((prev) => {
      const merged = Array.from(
        new Set([...prev.readSignatures, ...notifications.map((n) => n.signature)])
      );
      return { ...prev, readSignatures: merged };
    });
  }, [notifications, updateNotificationPrefs]);

  const dismissNotification = useCallback(
    (signature: string) => {
      updateNotificationPrefs((prev) => ({
        ...prev,
        readSignatures: prev.readSignatures.includes(signature)
          ? prev.readSignatures
          : [...prev.readSignatures, signature],
        dismissedSignatures: prev.dismissedSignatures.includes(signature)
          ? prev.dismissedSignatures
          : [...prev.dismissedSignatures, signature],
      }));
    },
    [updateNotificationPrefs]
  );

  const restoreDismissedNotifications = useCallback(() => {
    updateNotificationPrefs((prev) => ({
      ...prev,
      dismissedSignatures: [],
      readSignatures: [],
    }));
  }, [updateNotificationPrefs]);

  const sendTestNotification = useCallback(async () => {
    return sendTestSystemNotification();
  }, []);

  const setMaintenanceEnabledMode = useCallback(
    async (enabled: boolean) => {
      if (!isAdmin) return;
      setMaintenanceUpdating(true);
      try {
        await setMaintenanceMode(enabled);
      } finally {
        setMaintenanceUpdating(false);
      }
    },
    [isAdmin]
  );

  const acknowledgeAdminMessage = useCallback(
    async (messageId: string) => {
      if (!firebaseUser || !firebaseUser.emailVerified) return;
      await markAdminMessageRead(firebaseUser.uid, messageId);
    },
    [firebaseUser]
  );

  const applyBackendAiUsage = useCallback((usage?: AiUsageSummary | null) => {
    if (usage) {
      setBackendAiUsageOverride(usage);
    }
  }, []);

  const refreshVipFromBackend = useCallback(async () => {
    if (!firebaseUser || !firebaseUser.emailVerified || isGuest) return;
    try {
      const status = await fetchVipStatus();
      if (status.aiUsage) {
        setBackendAiUsageOverride(status.aiUsage);
      }
    } catch {
      // Firestore snapshots continue serving cached/real-time status
    }
  }, [firebaseUser, isGuest]);

  const pendingVipRequestCount = React.useMemo(
    () => adminVipPaymentRequests.filter((r) => r.status === 'pending').length,
    [adminVipPaymentRequests]
  );

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
        notificationPrefs,
        notifications,
        unreadNotificationCount,
        notificationPermission,
        toggleTheme,
        setCurrency,
        refreshAuthUser,
        enterGuestMode,
        exitGuestMode,
        migrateGuestToCloud,
        dismissGuestMigration,
        enableMobileNotifications,
        updateNotificationPrefs,
        markNotificationRead,
        markAllNotificationsRead,
        dismissNotification,
        restoreDismissedNotifications,
        sendTestNotification,
        isAdmin,
        isAccountDeactivated,
        securityProfile,
        userAppeals,
        isAccountBanned,
        activeBanType,
        banExpiresAtMs,
        isAiRestricted,
        aiRestrictedUntilMs,
        isMessagingRestricted,
        messagingRestrictedUntilMs,
        vipStatus,
        vipTier,
        vipSubscription,
        userVipPaymentRequests,
        adminVipPaymentRequests,
        pendingVipRequestCount,
        aiUsageSummary,
        applyBackendAiUsage,
        refreshVipFromBackend,
        adminMessages,
        acknowledgeAdminMessage,
        updateOpeningBalances,
        maintenanceEnabled,
        maintenanceLoading,
        maintenanceUpdating,
        setMaintenanceEnabledMode,
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
