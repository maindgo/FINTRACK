import { Timestamp } from 'firebase/firestore';

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED' | 'SGD' | 'AUD' | 'CAD' | 'JPY';
export type ThemeMode = 'light' | 'dark';

export type NavSection =
  | 'dashboard'
  | 'income'
  | 'expenses'
  | 'transactions'
  | 'profit-loss'
  | 'savings'
  | 'budgets'
  | 'loans-debts'
  | 'bills-emis'
  | 'reports'
  | 'insights'
  | 'settings';

export type IncomeCategory =
  | 'Salary'
  | 'Freelancing'
  | 'Business Income'
  | 'Online Earnings'
  | 'Investments'
  | 'Interest'
  | 'Other Income';

export type ExpenseCategory =
  | 'Food'
  | 'Shopping'
  | 'Transport'
  | 'Rent'
  | 'Electricity'
  | 'Internet'
  | 'Education'
  | 'Healthcare'
  | 'Entertainment'
  | 'Travel'
  | 'EMI'
  | 'Bills'
  | 'Other Expenses';

export type PaymentMethod =
  | 'UPI'
  | 'Bank Transfer'
  | 'Cash'
  | 'Credit Card'
  | 'Debit Card'
  | 'Wallet'
  | 'Net Banking'
  | 'Other';

export type TransactionType = 'income' | 'expense';
export type RecordStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overdue';
export type DebtRecordType = 'lent' | 'borrowed' | 'receivable' | 'payable' | 'loan';
export type BillType = 'bill' | 'emi' | 'subscription';
export type BillFrequency = 'one_time' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  currency: CurrencyCode;
  theme: ThemeMode;
  monthlyBudgetLimit: number;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface TransactionRecord {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  title: string;
  category: IncomeCategory | ExpenseCategory;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  paymentMethod: PaymentMethod;
  description: string;
  notes: string;
  receiptName: string;
  receiptDataUrl: string;
  recurringId: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  targetDate: string;
  category: string;
  notes: string;
  status: 'active' | 'completed';
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface SavingsContribution {
  id: string;
  userId: string;
  goalId: string;
  amount: number;
  date: string;
  note: string;
  createdAt?: Timestamp | null;
}

export interface BudgetRecord {
  id: string;
  userId: string;
  category: string;
  month: string; // YYYY-MM
  limitAmount: number;
  alertThreshold: number;
  notes: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface DebtRecord {
  id: string;
  userId: string;
  recordType: DebtRecordType;
  partyName: string;
  title: string;
  totalAmount: number;
  paidAmount: number;
  interestRate: number;
  dueDate: string;
  status: RecordStatus;
  notes: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface RecordPayment {
  id: string;
  userId: string;
  parentKind: 'debt' | 'bill';
  parentId: string;
  amount: number;
  date: string;
  method: string;
  note: string;
  createdAt?: Timestamp | null;
}

export interface BillRecord {
  id: string;
  userId: string;
  billType: BillType;
  title: string;
  provider: string;
  category: string;
  amount: number;
  paidAmount: number;
  dueDate: string;
  frequency: BillFrequency;
  status: RecordStatus;
  autoPay: boolean;
  notes: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface RecurringTransaction {
  id: string;
  userId: string;
  type: TransactionType;
  title: string;
  amount: number;
  category: IncomeCategory | ExpenseCategory;
  paymentMethod: PaymentMethod;
  frequency: RecurringFrequency;
  startDate: string;
  nextRunDate: string;
  lastRunDate: string;
  isActive: boolean;
  description: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type DashboardDateFilter = 'today' | 'week' | 'month' | 'year' | 'custom';

export type NotificationCategory =
  | 'bills'
  | 'budgets'
  | 'debts'
  | 'insights'
  | 'savings'
  | 'recurring';

export type NotificationSeverity = 'critical' | 'warning' | 'info' | 'positive';

export interface FinTrackNotification {
  id: string;
  signature: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  body: string;
  actionSection: NavSection;
  timestampLabel: string;
}

export interface NotificationCategoryPrefs {
  bills: boolean;
  budgets: boolean;
  debts: boolean;
  insights: boolean;
  savings: boolean;
  recurring: boolean;
}

export interface NotificationPrefs {
  enabled: boolean;
  pushToDeviceBar: boolean;
  showTopAlertBanner: boolean;
  categories: NotificationCategoryPrefs;
  readSignatures: string[];
  dismissedSignatures: string[];
}

export type BrowserNotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface MaintenanceConfig {
  enabled: boolean;
  updatedAt?: Timestamp | null;
}

