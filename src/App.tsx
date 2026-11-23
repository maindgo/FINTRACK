import React, { useState } from 'react';
import { Wallet } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FinanceProvider, useFinance } from './context/FinanceContext';
import { AuthView } from './components/AuthView';
import { LayoutShell } from './components/LayoutShell';
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
import { NavSection, TransactionRecord, TransactionType } from './types/finance';

function FinTrackWorkspace() {
  const { user, authReady, isGuest } = useFinance();
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txInitialType, setTxInitialType] = useState<TransactionType>('expense');
  const [editingTx, setEditingTx] = useState<TransactionRecord | null>(null);
  const [receiptRecord, setReceiptRecord] = useState<TransactionRecord | null>(null);

  if (!authReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white">
          <Wallet className="w-5 h-5" />
        </div>
        <div className="text-sm font-medium text-slate-600 dark:text-slate-400">
          Loading FinTrack...
        </div>
      </div>
    );
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
