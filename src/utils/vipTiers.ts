import { BillingCycle, VipTier } from '../types/finance';

export interface VipTierConfig {
  id: VipTier;
  classLabel: string;
  name: string;
  badgeLabel: string;
  tagline: string;
  pricesInr: Record<BillingCycle, number>;
  insightsLimit: number;
  advisorLimit: number;
  hasAiInsights: boolean;
  hasAiAdvisor: boolean;
  hasHealthScore: boolean;
  hasDiamondForecast: boolean;
  hasPrioritySupport: boolean;
  highlights: string[];
  accentTextClass: string;
  accentBorderClass: string;
  badgeContainerClass: string;
}

export const VIP_TIER_ORDER: VipTier[] = ['starter', 'silver', 'gold', 'diamond'];

export const STARTER_PRESERVED_FEATURES: string[] = [
  'Advanced Dashboard & Net Cash-Flow Summary',
  'Financial Reports & PDF / Excel Ledger Exports',
  'Category & Overall Monthly Budgets',
  'Wallets & Accounts (Bank / UPI + Cash in Hand)',
  'Payment Reminders, Bills, EMIs & Subscriptions',
  'Automated Recurring Transactions',
  'Lending & Borrowing Management (Loans & Debts)',
  'Savings Goals, Profit & Loss & Security Lock',
];

export const VIP_TIER_CONFIGS: Record<VipTier, VipTierConfig> = {
  starter: {
    id: 'starter',
    classLabel: 'CLASS 2',
    name: 'Starter VIP',
    badgeLabel: 'Starter VIP',
    tagline: 'All core FinTrack wealth & ledger tools unlocked—zero AI add-ons.',
    pricesInr: {
      monthly: 39,
      quarterly: 99,
      yearly: 129,
    },
    insightsLimit: 0,
    advisorLimit: 0,
    hasAiInsights: false,
    hasAiAdvisor: false,
    hasHealthScore: false,
    hasDiamondForecast: false,
    hasPrioritySupport: false,
    highlights: [
      'Every existing Starter VIP module preserved intact',
      'Advanced Dashboard, Budgets & Financial Reports',
      'Wallets & Accounts (Bank/UPI + Cash)',
      'Payment Reminders, Recurring & Lending/Borrowing',
      'Starter VIP Membership Badge',
      'No AI premium features included',
    ],
    accentTextClass: 'text-slate-700 dark:text-slate-200',
    accentBorderClass: 'border-slate-300 dark:border-slate-700',
    badgeContainerClass:
      'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700',
  },
  silver: {
    id: 'silver',
    classLabel: 'CLASS 3',
    name: 'Silver VIP',
    badgeLabel: 'Silver VIP',
    tagline: 'Starter VIP plus monthly Gemini AI expense analysis & smart spending guidance.',
    pricesInr: {
      monthly: 49,
      quarterly: 129,
      yearly: 499,
    },
    insightsLimit: 10,
    advisorLimit: 0,
    hasAiInsights: true,
    hasAiAdvisor: false,
    hasHealthScore: false,
    hasDiamondForecast: false,
    hasPrioritySupport: false,
    highlights: [
      'Everything in CLASS 2 Starter VIP',
      'Basic AI Insights (10 / month)',
      'Monthly AI Expense Analysis & Anomaly Alerts',
      'AI Spending & Budget Recommendations',
      'Silver VIP Membership Badge',
    ],
    accentTextClass: 'text-sky-700 dark:text-sky-300',
    accentBorderClass: 'border-sky-300 dark:border-sky-800',
    badgeContainerClass:
      'bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800',
  },
  gold: {
    id: 'gold',
    classLabel: 'CLASS 4',
    name: 'Gold VIP',
    badgeLabel: 'Gold VIP',
    tagline: 'Silver VIP plus your conversational AI Advisor & Financial Health Score.',
    pricesInr: {
      monthly: 59,
      quarterly: 149,
      yearly: 599,
    },
    insightsLimit: 30,
    advisorLimit: 50,
    hasAiInsights: true,
    hasAiAdvisor: true,
    hasHealthScore: true,
    hasDiamondForecast: false,
    hasPrioritySupport: false,
    highlights: [
      'Everything in CLASS 3 Silver VIP',
      '30 AI Insights / month',
      '50 Conversational AI Advisor Messages / month',
      'Advanced AI Financial Advisor & Chat Assistant',
      'AI Savings Recommendations & Financial Health Score',
      'Gold VIP Membership Badge',
    ],
    accentTextClass: 'text-amber-700 dark:text-amber-300',
    accentBorderClass: 'border-amber-300 dark:border-amber-700',
    badgeContainerClass:
      'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800',
  },
  diamond: {
    id: 'diamond',
    classLabel: 'CLASS 5',
    name: 'Diamond VIP',
    badgeLabel: 'Diamond VIP',
    tagline: 'Full AI forecasting, personalized planning, top limits & priority support.',
    pricesInr: {
      monthly: 69,
      quarterly: 179,
      yearly: 699,
    },
    insightsLimit: 100,
    advisorLimit: 200,
    hasAiInsights: true,
    hasAiAdvisor: true,
    hasHealthScore: true,
    hasDiamondForecast: true,
    hasPrioritySupport: true,
    highlights: [
      'Everything in CLASS 4 Gold VIP',
      '100 AI Insights / month & 200 Advisor Messages / month',
      'Advanced AI Financial Forecasting & Future Expense Predictions',
      'Personalized Financial Planning & Advanced Health Analysis',
      'Priority Customer Support & Diamond VIP Badge',
    ],
    accentTextClass: 'text-emerald-700 dark:text-emerald-300',
    accentBorderClass: 'border-emerald-400 dark:border-emerald-700',
    badgeContainerClass:
      'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800',
  },
};

export const BILLING_CYCLE_LABELS: Record<BillingCycle, { label: string; short: string; days: number }> = {
  monthly: { label: 'Monthly', short: '/month', days: 30 },
  quarterly: { label: 'Quarterly', short: '/quarter', days: 90 },
  yearly: { label: 'Yearly', short: '/year', days: 365 },
};

export function getTierRank(tier: VipTier): number {
  switch (tier) {
    case 'diamond':
      return 4;
    case 'gold':
      return 3;
    case 'silver':
      return 2;
    default:
      return 1;
  }
}

export function tierMeetsMinimum(actual: VipTier, required: VipTier): boolean {
  return getTierRank(actual) >= getTierRank(required);
}

export function isVipTier(val: unknown): val is VipTier {
  return val === 'starter' || val === 'silver' || val === 'gold' || val === 'diamond';
}

export function isBillingCycle(val: unknown): val is BillingCycle {
  return val === 'monthly' || val === 'quarterly' || val === 'yearly';
}

export function getTierPrice(tier: VipTier, cycle: BillingCycle): number {
  return VIP_TIER_CONFIGS[tier].pricesInr[cycle];
}
