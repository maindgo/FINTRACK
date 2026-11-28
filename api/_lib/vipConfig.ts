export type VipTier = 'starter' | 'silver' | 'gold' | 'diamond';
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly';
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';

export interface BackendVipTierSpec {
  id: VipTier;
  classLabel: string;
  name: string;
  pricesInr: Record<BillingCycle, number>;
  insightsLimit: number;
  advisorLimit: number;
}

export const BACKEND_VIP_TIERS: Record<VipTier, BackendVipTierSpec> = {
  starter: {
    id: 'starter',
    classLabel: 'CLASS 2',
    name: 'Starter VIP',
    pricesInr: { monthly: 39, quarterly: 99, yearly: 129 },
    insightsLimit: 0,
    advisorLimit: 0,
  },
  silver: {
    id: 'silver',
    classLabel: 'CLASS 3',
    name: 'Silver VIP',
    pricesInr: { monthly: 49, quarterly: 129, yearly: 499 },
    insightsLimit: 10,
    advisorLimit: 0,
  },
  gold: {
    id: 'gold',
    classLabel: 'CLASS 4',
    name: 'Gold VIP',
    pricesInr: { monthly: 59, quarterly: 149, yearly: 599 },
    insightsLimit: 30,
    advisorLimit: 50,
  },
  diamond: {
    id: 'diamond',
    classLabel: 'CLASS 5',
    name: 'Diamond VIP',
    pricesInr: { monthly: 69, quarterly: 179, yearly: 699 },
    insightsLimit: 100,
    advisorLimit: 200,
  },
};

export const BILLING_CYCLE_DAYS: Record<BillingCycle, number> = {
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

export function isValidVipTier(val: unknown): val is VipTier {
  return val === 'starter' || val === 'silver' || val === 'gold' || val === 'diamond';
}

export function isValidBillingCycle(val: unknown): val is BillingCycle {
  return val === 'monthly' || val === 'quarterly' || val === 'yearly';
}

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

export function getMonthPeriodWindow(nowMs = Date.now()): {
  periodKey: string;
  periodStartIso: string;
  periodEndIso: string;
} {
  const now = new Date(nowMs);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0));
  const periodKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  return {
    periodKey,
    periodStartIso: start.toISOString(),
    periodEndIso: end.toISOString(),
  };
}

/**
 * Computes the active 1-month AI quota window anchored to a subscription period
 * (or UTC calendar month for Starter / legacy admin VIP grants), advancing automatically
 * each 30-day cycle so AI counters reset cleanly per user and subscription period.
 */
export function computeQuotaPeriodWindow(
  subscriptionStartMs: number | null,
  nowMs = Date.now(),
  storedSubPeriodKey?: string | null
): {
  periodKey: string;
  periodStartIso: string;
  periodEndIso: string;
} {
  if (!subscriptionStartMs || !Number.isFinite(subscriptionStartMs) || subscriptionStartMs <= 0) {
    return getMonthPeriodWindow(nowMs);
  }
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  const elapsed = Math.max(0, nowMs - subscriptionStartMs);
  const cycleIndex = Math.floor(elapsed / monthMs);
  const startMs = subscriptionStartMs + cycleIndex * monthMs;
  const endMs = startMs + monthMs;

  let basePrefix = `sub-${Math.floor(subscriptionStartMs / 1000)}`;
  if (storedSubPeriodKey && /^sub-[a-zA-Z0-9_-]+?-c\d+$/.test(storedSubPeriodKey)) {
    basePrefix = storedSubPeriodKey.replace(/-c\d+$/, '');
  }

  return {
    periodKey: `${basePrefix}-c${cycleIndex}`,
    periodStartIso: new Date(startMs).toISOString(),
    periodEndIso: new Date(endMs).toISOString(),
  };
}

export const MERCHANT_UPI_ID = 'tntmilan06@slc';
export const MERCHANT_PAYEE_NAME = 'FinTrack';

export function buildUpiPaymentUri(params: {
  amountInr: number;
  tierName: string;
  billingCycle: BillingCycle;
  paymentReference: string;
}): string {
  const note = `FinTrack ${params.tierName} ${params.billingCycle}`;
  const query = [
    `pa=${encodeURIComponent(MERCHANT_UPI_ID)}`,
    `pn=${encodeURIComponent(MERCHANT_PAYEE_NAME)}`,
    `am=${encodeURIComponent(String(params.amountInr))}`,
    `cu=INR`,
    `tr=${encodeURIComponent(params.paymentReference)}`,
    `tn=${encodeURIComponent(note)}`,
  ].join('&');
  return `upi://pay?${query}`;
}
