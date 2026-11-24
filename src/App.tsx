import React, { useCallback, useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FinanceProvider, useFinance } from './context/FinanceContext';
import { AppLockScreen } from './components/AppLockScreen';
import { AuthView } from './components/AuthView';
import { LayoutShell } from './components/LayoutShell';
import { MaintenancePage } from './components/MaintenancePage';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SplashLoadingScreen } from './components/SplashLoadingScreen';
import { TransactionModal } from './components/TransactionModal';
import { ReceiptPreviewModal } from './components/ReceiptPreviewModal';
import { DashboardPage } from './pages/DashboardPage';
import { LedgerCategoryPage } from './pages/LedgerCategoryPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { ProfitLossPage } from './pages/ProfitLossPage';
import { SavingsPage } from './pages/SavingsPage';
import { BudgetsPage } from './pages/BudgetsPage';
import { LoansDebtsPage } from './pages/LoansDebtsPage';
import { BillsEmisPage } from './pages/BillsEmisPage';
import { ReportsPage } from './pages/ReportsPage';
import { InsightsPage } from './pages/InsightsPage';
import { SettingsPage } from './pages/SettingsPage';
import {
  clearSecurityConfig,
  isAppSecurityConfigured,
  loadSecurityConfig,
  SECURITY_EVENT,
  SecurityLockConfig,
} from './services/securityService';
import { NavSection, TransactionRecord, TransactionType } from './types/finance';
import { NAV_ITEMS } from './utils/constants';

const VALID_SECTIONS = new Set<NavSection>(NAV_ITEMS.map((item) => item.id));

function FinTrackWorkspace() {
  const {
    user,
    firebaseUser,
    authReady,
    dataLoading,
    isGuest,
    exitGuestMode,
    isAdmin,
    maintenanceEnabled,
    maintenanceLoading,
  } = useFinance();
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);
  const [maxWaitElapsed, setMaxWaitElapsed] = useState(false);
  const [showAdminSignIn, setShowAdminSignIn] = useState(false);
  const [adminBypassMaintenance, setAdminBypassMaintenance] = useState(false);
  const prevMaintenanceRef = useRef(maintenanceEnabled);
  const [activeSection, setActiveSection] = useState<NavSection>(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('section') as NavSection | null;
      if (param && VALID_SECTIONS.has(param)) return param;
    }
    return 'dashboard';
  });
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txInitialType, setTxInitialType] = useState<TransactionType>('expense');
  const [editingTx, setEditingTx] = useState<TransactionRecord | null>(null);
  const [receiptRecord, setReceiptRecord] = useState<TransactionRecord | null>(null);

  const [securityConfig, setSecurityConfig] = useState<SecurityLockConfig>(() =>
    loadSecurityConfig()
  );
  const [isAppLocked, setIsAppLocked] = useState<boolean>(() => {
    const cfg = loadSecurityConfig();
    return isAppSecurityConfigured(cfg) && cfg.lockBeforeLogin;
  });
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    const syncSecurity = () => {
      setSecurityConfig(loadSecurityConfig());
    };
    window.addEventListener(SECURITY_EVENT, syncSecurity);
    window.addEventListener('storage', syncSecurity);
    return () => {
      window.removeEventListener(SECURITY_EVENT, syncSecurity);
      window.removeEventListener('storage', syncSecurity);
    };
  }, []);

  // Auto-lock when app is backgrounded/hidden beyond configured timeout
  useEffect(() => {
    const onVisibilityChange = () => {
      const cfg = loadSecurityConfig();
      if (!isAppSecurityConfigured(cfg)) return;
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenAtRef.current !== null) {
        const elapsedMs = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = null;
        if (cfg.autoLockMinutes > 0 && elapsedMs >= cfg.autoLockMinutes * 60_000) {
          setIsAppLocked(true);
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const handleLockApp = useCallback(() => {
    if (isAppSecurityConfigured(loadSecurityConfig())) {
      setIsAppLocked(true);
    }
  }, []);

  const handleResetLockAndSignOut = useCallback(async () => {
    clearSecurityConfig();
    exitGuestMode();
    if (auth.currentUser) {
      await signOut(auth);
    }
    setIsAppLocked(false);
  }, [exitGuestMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; section?: NavSection } | undefined;
      if (data?.type === 'FINTRACK_NAVIGATE' && data.section && VALID_SECTIONS.has(data.section)) {
        setActiveSection(data.section);
      }
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    if (prevMaintenanceRef.current !== maintenanceEnabled) {
      prevMaintenanceRef.current = maintenanceEnabled;
      setAdminBypassMaintenance(false);
      if (!maintenanceEnabled) {
        setShowAdminSignIn(false);
      }
    }
  }, [maintenanceEnabled]);

  useEffect(() => {
    const minTimer = setTimeout(() => setMinSplashElapsed(true), 1600);
    const maxTimer = setTimeout(() => setMaxWaitElapsed(true), 3200);
    return () => {
      clearTimeout(minTimer);
      clearTimeout(maxTimer);
    };
  }, []);

  useEffect(() => {
    if (isAdmin) {
      setShowAdminSignIn(false);
    }
  }, [isAdmin]);

  const isSignedInVerified = Boolean(user && (isGuest || user.emailVerified));
  const waitingForInitialData =
    isSignedInVerified && !isAppLocked && dataLoading && !maxWaitElapsed;

  if (!authReady || maintenanceLoading || !minSplashElapsed || waitingForInitialData) {
    return (
      <SplashLoadingScreen
        statusLabel={
          !authReady || maintenanceLoading
            ? 'Loading FinTrack...'
            : waitingForInitialData
            ? 'Syncing your dashboard...'
            : 'Growth Yourself with FinTrack'
        }
      />
    );
  }

  // Enforce PIN / Biometric Lock BEFORE login and BEFORE workspace access
  if (isAppLocked && isAppSecurityConfigured(securityConfig)) {
    return (
      <AppLockScreen
        config={securityConfig}
        isSignedInOrGuest={Boolean(firebaseUser || isGuest)}
        onUnlock={() => setIsAppLocked(false)}
        onResetLockAndSignOut={handleResetLockAndSignOut}
      />
    );
  }

  // Route application to Scheduled Maintenance page when enabled by Admin
  if (maintenanceEnabled) {
    if (!isAdmin) {
      if (showAdminSignIn && (!firebaseUser || !firebaseUser.emailVerified)) {
        return <AuthView onBackToMaintenance={() => setShowAdminSignIn(false)} />;
      }
      return <MaintenancePage onRequestAdminSignIn={() => setShowAdminSignIn(true)} />;
    }
    if (!adminBypassMaintenance) {
      return (
        <MaintenancePage
          onRequestAdminSignIn={() => {}}
          onAdminEnterApp={() => setAdminBypassMaintenance(true)}
        />
      );
    }
  }

  if (!user || (!isGuest && !user.emailVerified)) {
    return <AuthView />;
  }

  const openAddTransaction = (type: TransactionType) => {
    setEditingTx(null);
    setTxInitialType(type);
    setTxModalOpen(true);
  };

  const openEditTransaction = (record: TransactionRecord) => {
    setEditingTx(record);
    setTxInitialType(record.type);
    setTxModalOpen(true);
  };

  return (
    <LayoutShell
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      onQuickAddTransaction={openAddTransaction}
      securityConfigured={isAppSecurityConfigured(securityConfig)}
      onLockApp={handleLockApp}
      onPreviewMaintenance={() => setAdminBypassMaintenance(false)}
    >
      {activeSection === 'dashboard' && (
        <DashboardPage
          onNavigate={setActiveSection}
          onAddTransaction={openAddTransaction}
        />
      )}
      {activeSection === 'income' && (
        <LedgerCategoryPage
          mode="income"
          onAddNew={openAddTransaction}
          onEdit={openEditTransaction}
          onViewReceipt={setReceiptRecord}
        />
      )}
      {activeSection === 'expenses' && (
        <LedgerCategoryPage
          mode="expense"
          onAddNew={openAddTransaction}
          onEdit={openEditTransaction}
          onViewReceipt={setReceiptRecord}
        />
      )}
      {activeSection === 'transactions' && (
        <TransactionsPage
          onAddNew={openAddTransaction}
          onEdit={openEditTransaction}
          onViewReceipt={setReceiptRecord}
        />
      )}
      {activeSection === 'profit-loss' && <ProfitLossPage />}
      {activeSection === 'savings' && <SavingsPage />}
      {activeSection === 'budgets' && <BudgetsPage />}
      {activeSection === 'loans-debts' && <LoansDebtsPage />}
      {activeSection === 'bills-emis' && <BillsEmisPage />}
      {activeSection === 'reports' && <ReportsPage />}
      {activeSection === 'insights' && <InsightsPage />}
      {activeSection === 'settings' && <SettingsPage />}

      <TransactionModal
        open={txModalOpen}
        uid={user.uid}
        initialType={txInitialType}
        editingRecord={editingTx}
        onClose={() => {
          setTxModalOpen(false);
          setEditingTx(null);
        }}
      />

      <ReceiptPreviewModal
        record={receiptRecord}
        onClose={() => setReceiptRecord(null)}
      />
      <OfflineIndicator />
    </LayoutShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <FinanceProvider>
        <FinTrackWorkspace />
      </FinanceProvider>
    </ErrorBoundary>
  );
}
