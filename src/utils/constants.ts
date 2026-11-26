import {
  CurrencyCode,
  ExpenseCategory,
  IncomeCategory,
  NavSection,
  PaymentMethod,
} from '../types/finance';

export const INCOME_CATEGORIES: IncomeCategory[] = [
  'Salary',
  'Freelancing',
  'Business Income',
  'Online Earnings',
  'Investments',
  'Interest',
  'Other Income',
];

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Food',
  'Shopping',
  'Transport',
  'Rent',
  'Electricity',
  'Internet',
  'Education',
  'Healthcare',
  'Entertainment',
  'Travel',
  'EMI',
  'Bills',
  'Other Expenses',
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  'UPI',
  'Bank Transfer',
  'Cash',
  'Credit Card',
  'Debit Card',
  'Wallet',
  'Net Banking',
  'Other',
];

export const CASH_PAYMENT_METHODS: PaymentMethod[] = ['Cash'];

export const BANK_PAYMENT_METHODS: PaymentMethod[] = [
  'UPI',
  'Bank Transfer',
  'Net Banking',
  'Debit Card',
  'Credit Card',
  'Wallet',
  'Other',
];

export function isCashPaymentMethod(method?: string | null): boolean {
  return (method || '').trim().toLowerCase() === 'cash';
}

export const SAVINGS_CATEGORIES: string[] = [
  'Emergency Fund',
  'Home & Property',
  'Retirement',
  'Education',
  'Travel & Leisure',
  'Vehicle',
  'Investment Corpus',
  'General Savings',
];

export const CURRENCIES: { code: CurrencyCode; symbol: string; name: string; locale: string }[] = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee (INR)', locale: 'en-IN' },
  { code: 'USD', symbol: '$', name: 'US Dollar (USD)', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro (EUR)', locale: 'de-DE' },
  { code: 'GBP', symbol: '£', name: 'British Pound (GBP)', locale: 'en-GB' },
  { code: 'AED', symbol: 'AED', name: 'UAE Dirham (AED)', locale: 'en-AE' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar (SGD)', locale: 'en-SG' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar (AUD)', locale: 'en-AU' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar (CAD)', locale: 'en-CA' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen (JPY)', locale: 'ja-JP' },
];

export const NAV_ITEMS: { id: NavSection; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'income', label: 'Income' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'profit-loss', label: 'Profit & Loss' },
  { id: 'savings', label: 'Savings' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'loans-debts', label: 'Loans & Debts' },
  { id: 'bills-emis', label: 'Bills & EMIs' },
  { id: 'reports', label: 'Reports & Analytics' },
  { id: 'insights', label: 'Financial Insights' },
  { id: 'ai-insights', label: 'AI Insights' },
  { id: 'vip', label: 'VIP' },
  { id: 'admin', label: 'Admin Panel' },
  { id: 'settings', label: 'Settings' },
];

export const DEFAULT_ADMIN_MESSAGE_HEADING = 'IMPORTANT MESSAGE FROM ADMINISTRATOR';

export const CHART_COLORS = [
  '#2563EB', // Blue
  '#16A34A', // Emerald Green
  '#0EA5E9', // Sky Blue
  '#D97706', // Amber
  '#6366F1', // Indigo
  '#0D9488', // Teal
  '#E11D48', // Rose
  '#64748B', // Slate
];

export const FIELD_LIMITS = {
  DISPLAY_NAME_MAX: 100,
  TITLE_MAX: 140,
  PARTY_NAME_MAX: 120,
  PROVIDER_MAX: 120,
  CATEGORY_MAX: 60,
  DESCRIPTION_MAX: 500,
  NOTES_MAX: 1000,
  SHORT_NOTE_MAX: 300,
  RECEIPT_NAME_MAX: 160,
  RECEIPT_DATA_MAX: 250000,
  AMOUNT_MAX: 1000000000,
};

export const ADMIN_EMAIL = 'maind.go2000@gmail.com';
export const SUPPORT_EMAIL = 'support.maindgo@gmail.com';

export const MAINTENANCE_UPDATE_ITEMS = [
  'AI Accountant soon',
  'Budget Forecasting',
  'Including AI',
  'Fix Bugs',
] as const;

export const MAINTENANCE_BANNER_TEXT =
  'growth yourself with FinTrack If you have any problem or Suggestions to add-on in FinTrack please Contact us on support.maindgo@gmail.com freely we appreciate your thoughts Thanks for Using on FinTrack';
