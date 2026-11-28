import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Calculator,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Crown,
  ExternalLink,
  Headphones,
  Loader2,
  Mail,
  MessageSquareText,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import {
  AIInsightsApiError,
  buildUpiPaymentUri,
  cancelVipSubscription,
  generateVipPaymentReference,
  subscribeVipPlan,
  verifyBackendVipEntitlement,
} from '../services/aiInsightsService';
import { BillingCycle, NavSection, VipTier } from '../types/finance';
import { SUPPORT_EMAIL, VIP_UPI_ID } from '../utils/constants';
import {
  BILLING_CYCLE_LABELS,
  getTierPrice,
  getTierRank,
  STARTER_PRESERVED_FEATURES,
  VIP_TIER_CONFIGS,
  VIP_TIER_ORDER,
} from '../utils/vipTiers';

interface VipPageProps {
  onNavigate: (section: NavSection) => void;
}

const UPCOMING_LAB_AUTOMATIONS = [
  {
    icon: Calculator,
    title: 'AI Accountant',
    timing: 'VIP Lab · Coming Soon',
    summary:
      'Automated monthly closing, tax-ready expense classification, GST tagging, and ledger health reviews.',
  },
  {
    icon: MessageSquareText,
    title: 'SMS Detection',
    timing: 'VIP Lab · Coming Soon',
    summary:
      'Smart parsing for bank debit/credit alerts, UPI notifications, and card SMS alerts without manual typing.',
  },
  {
    icon: Zap,
    title: 'Automatically Record Entry',
    timing: 'VIP Lab · Coming Soon',
    summary:
      'Hands-free transaction logging posting verified alerts straight into your Bank/UPI or Cash ledger.',
  },
] as const;

const MATRIX_ROWS: Array<{
  capability: string;
  values: Record<VipTier, string>;
}> = [
  {
    capability: 'Core Modules (Dashboard, Reports, Budgets, Wallets, Reminders, Recurring, Loans)',
    values: {
      starter: 'Included',
      silver: 'Included',
      gold: 'Included',
      diamond: 'Included',
    },
  },
  {
    capability: 'Membership Tier Badge',
    values: {
      starter: 'Starter VIP',
      silver: 'Silver VIP',
      gold: 'Gold VIP',
      diamond: 'Diamond VIP',
    },
  },
  {
    capability: 'AI Financial Insights Quota',
    values: {
      starter: '— (No AI)',
      silver: '10 / month',
      gold: '30 / month',
      diamond: '100 / month',
    },
  },
  {
    capability: 'Monthly AI Expense Analysis & Spending Recommendations',
    values: {
      starter: '—',
      silver: 'Included',
      gold: 'Included',
      diamond: 'Included',
    },
  },
  {
    capability: 'Conversational AI Financial Advisor',
    values: {
      starter: '—',
      silver: '—',
      gold: '50 messages / mo',
      diamond: '200 messages / mo',
    },
  },
  {
    capability: 'Financial Health Score & AI Savings Recommendations',
    values: {
      starter: '—',
      silver: '—',
      gold: 'Included',
      diamond: 'Included',
    },
  },
  {
    capability: 'Advanced AI Forecasting, Personalized Planning & Future Expense Predictions',
    values: {
      starter: '—',
      silver: '—',
      gold: '—',
      diamond: 'Included',
    },
  },
  {
    capability: 'Advanced Financial Health Analysis & Priority Customer Support',
    values: {
      starter: '—',
      silver: '—',
      gold: '—',
      diamond: 'Priority Support',
    },
  },
];

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '—';
  return new Date(parsed).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getBillingCycleSavingsPct(tier: VipTier, cycle: BillingCycle): number {
  if (cycle === 'monthly') return 0;
  const monthlyTotal =
    cycle === 'quarterly'
      ? VIP_TIER_CONFIGS[tier].pricesInr.monthly * 3
      : VIP_TIER_CONFIGS[tier].pricesInr.monthly * 12;
  const actual = VIP_TIER_CONFIGS[tier].pricesInr[cycle];
  if (monthlyTotal <= 0 || actual >= monthlyTotal) return 0;
  return Math.round(((monthlyTotal - actual) / monthlyTotal) * 100);
}

export function VipPage({ onNavigate }: VipPageProps) {
  const {
    firebaseUser,
    profile,
    isGuest,
    isAdmin,
    vipTier,
    vipSubscription,
    userVipPaymentRequests,
    aiUsageSummary,
    applyBackendAiUsage,
    refreshVipFromBackend,
    exitGuestMode,
  } = useFinance();

  const [selectedCycle, setSelectedCycle] = useState<BillingCycle>(
    vipSubscription?.billingCycle || 'monthly'
  );
  const [checkoutTier, setCheckoutTier] = useState<VipTier | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<'pay' | 'confirm'>('pay');
  const [checkoutPaymentRef, setCheckoutPaymentRef] = useState<string>('');
  const [utrInput, setUtrInput] = useState<string>('');
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [submittingCheckout, setSubmittingCheckout] = useState(false);
  const [cancelingAutoRenew, setCancelingAutoRenew] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'pending' | 'error';
    text: string;
    ref?: string;
  } | null>(null);

  useEffect(() => {
    if (isGuest || !firebaseUser?.emailVerified) return;
    let cancelled = false;
    void verifyBackendVipEntitlement(false)
      .then((res) => {
        if (!cancelled && res.aiUsage) {
          applyBackendAiUsage(res.aiUsage);
        }
      })
      .catch(() => {
        // Subscription state already streamed via Firestore listeners
      });
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, isGuest, applyBackendAiUsage]);

  const activeConfig = VIP_TIER_CONFIGS[vipTier];
  const pendingRequests = userVipPaymentRequests.filter((r) => r.status === 'pending');
  const insightsPct =
    aiUsageSummary.insightsLimit > 0
      ? Math.min(100, Math.round((aiUsageSummary.insightsUsed / aiUsageSummary.insightsLimit) * 100))
      : 0;
  const advisorPct =
    aiUsageSummary.advisorLimit > 0
      ? Math.min(100, Math.round((aiUsageSummary.advisorUsed / aiUsageSummary.advisorLimit) * 100))
      : 0;

  const canCancelAutoRenew =
    !isGuest &&
    !isAdmin &&
    vipTier !== 'starter' &&
    vipSubscription?.status === 'active' &&
    Boolean(vipSubscription?.autoRenew);

  const handleOpenCheckout = (tier: VipTier) => {
    setStatusMessage(null);
    setCheckoutError('');
    if (isGuest) {
      setStatusMessage({
        type: 'error',
        text: 'Please sign in with a verified email account to purchase a VIP plan.',
      });
      return;
    }
    if (!firebaseUser?.emailVerified) {
      setStatusMessage({
        type: 'error',
        text: 'Please verify your email address before purchasing a VIP plan.',
      });
      return;
    }
    setCheckoutPaymentRef(generateVipPaymentReference());
    setUtrInput('');
    setCopiedUpi(false);
    setCheckoutStep('pay');
    setCheckoutTier(tier);
  };

  const activeUpiDeepLink = checkoutTier
    ? buildUpiPaymentUri({
        amountInr: getTierPrice(checkoutTier, selectedCycle),
        tierName: VIP_TIER_CONFIGS[checkoutTier].name,
        billingCycle: selectedCycle,
        paymentReference: checkoutPaymentRef || 'FTPAY-UPI',
      })
    : '';

  const handleCopyUpiId = async () => {
    try {
      await navigator.clipboard.writeText(VIP_UPI_ID);
      setCopiedUpi(true);
      window.setTimeout(() => setCopiedUpi(false), 2500);
    } catch {
      setCopiedUpi(false);
    }
  };

  const handleLaunchUpiApp = () => {
    if (!activeUpiDeepLink) return;
    setCheckoutError('');
    setCheckoutStep('confirm');
    window.location.href = activeUpiDeepLink;
  };

  const handleSubmitPaymentForAdminReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutTier) return;
    const trimmedUtr = utrInput.trim();
    if (trimmedUtr.length < 4) {
      setCheckoutError(
        'Please enter your UPI Transaction ID / UTR Reference (at least 4 characters) so the Admin can verify your payment.'
      );
      return;
    }

    setSubmittingCheckout(true);
    setCheckoutError('');
    setStatusMessage(null);
    try {
      const priceInr = getTierPrice(checkoutTier, selectedCycle);
      const res = await subscribeVipPlan({
        tier: checkoutTier,
        billingCycle: selectedCycle,
        submittedPriceInr: priceInr,
        paymentReference: checkoutPaymentRef,
        utrReference: trimmedUtr,
        paymentMethodLabel: `UPI (${VIP_UPI_ID})`,
        displayName: profile?.displayName || firebaseUser?.displayName || '',
      });
      const targetSpec = VIP_TIER_CONFIGS[checkoutTier];
      setStatusMessage({
        type: 'pending',
        text: `UPI payment request submitted for ${targetSpec.classLabel} — ${targetSpec.name} (₹${res.amountInr}). Notification sent to the Admin Panel—your VIP features will unlock only after Admin confirmation.`,
        ref: `Ref: ${res.paymentReference} · UTR: ${res.utrReference}`,
      });
      setCheckoutTier(null);
      setUtrInput('');
    } catch (err: unknown) {
      const msg =
        err instanceof AIInsightsApiError
          ? err.message
          : (err as Error)?.message || 'Unable to submit payment verification request.';
      setCheckoutError(msg);
    } finally {
      setSubmittingCheckout(false);
    }
  };

  const handleCancelAutoRenew = async () => {
    setCancelingAutoRenew(true);
    setStatusMessage(null);
    try {
      const res = await cancelVipSubscription();
      await refreshVipFromBackend();
      setStatusMessage({
        type: 'success',
        text: `Auto-renewal turned off. Your ${VIP_TIER_CONFIGS[res.tier].name} benefits stay active through ${formatShortDate(res.periodEndIso)}.`,
      });
    } catch (err: unknown) {
      const msg =
        err instanceof AIInsightsApiError
          ? err.message
          : (err as Error)?.message || 'Unable to update auto-renewal status.';
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setCancelingAutoRenew(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Feedback Banner */}
      {statusMessage && (
        <div
          className={`rounded-xl border px-4 py-3.5 flex items-start justify-between gap-3 text-xs ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : statusMessage.type === 'pending'
              ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
              : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-800 dark:text-red-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : statusMessage.type === 'pending' ? (
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <div className="font-semibold">{statusMessage.text}</div>
              {statusMessage.ref && (
                <div className="font-mono text-[11px] opacity-80">{statusMessage.ref}</div>
              )}
              {isGuest && statusMessage.type === 'error' && (
                <button
                  type="button"
                  onClick={exitGuestMode}
                  className="mt-1 font-semibold underline text-slate-900 dark:text-white"
                >
                  Sign In Now
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            aria-label="Dismiss notification"
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Pending UPI Payment Admin Verification Banner */}
      {pendingRequests.length > 0 && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-4 space-y-2.5">
          <div className="flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <div className="font-bold text-amber-900 dark:text-amber-200">
                VIP Payment Verification Pending Admin Approval ({pendingRequests.length})
              </div>
              <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
                Your UPI payment notification has been sent to the FinTrack Admin Panel. VIP features remain locked until the Admin confirms your transaction to{' '}
                <span className="font-mono font-semibold">{VIP_UPI_ID}</span>.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pl-6">
            {pendingRequests.map((req) => {
              const reqSpec = VIP_TIER_CONFIGS[req.tier];
              return (
                <div
                  key={req.id}
                  className="rounded-lg bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800/70 px-3.5 py-2.5 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {reqSpec.classLabel} · {reqSpec.name} ({BILLING_CYCLE_LABELS[req.billingCycle].label})
                    </span>
                    <span className="font-mono font-bold text-amber-700 dark:text-amber-300">
                      ₹{req.amountInr}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    UTR: {req.utrReference} · Ref: {req.paymentReference}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Active Membership Hero & Quota Status Card */}
      <section className="bg-slate-900 text-white border border-slate-800 rounded-2xl p-6 sm:p-8">
        <div className="grid lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold ${activeConfig.badgeContainerClass}`}
              >
                <Crown className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {activeConfig.classLabel} · {activeConfig.badgeLabel}
                </span>
              </span>
              {isAdmin && (
                <span className="text-xs font-mono text-emerald-400">
                  Admin Full Access
                </span>
              )}
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
              FinTrack VIP Membership &amp; AI Tiers
            </h2>

            <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
              Every Starter VIP wealth and accounting tool stays 100% preserved inside CLASS 2. Upgrade across Silver, Gold, or Diamond VIP to unlock monthly Gemini AI Insights, Conversational Financial Advisor, Financial Health Score, and Predictive Forecasting.
            </p>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-300 pt-1">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Plan Cycle:{' '}
                  <strong className="text-white">
                    {isAdmin
                      ? 'Unlimited'
                      : BILLING_CYCLE_LABELS[vipSubscription?.billingCycle || 'monthly'].label}
                  </strong>
                </span>
              </div>
              {vipSubscription?.periodEndAt && !isAdmin && (
                <div className="flex items-center gap-1.5 font-mono tabular-nums">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    {vipSubscription.autoRenew ? 'Renews' : 'Valid Until'}:{' '}
                    <strong className="text-white">
                      {new Date(vipSubscription.periodEndAt.seconds * 1000).toLocaleDateString(
                        'en-IN',
                        { day: '2-digit', month: 'short', year: 'numeric' }
                      )}
                    </strong>
                  </span>
                </div>
              )}
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('ai-insights')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4" />
                <span>Open AI Financial Insights</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              {canCancelAutoRenew && (
                <button
                  type="button"
                  disabled={cancelingAutoRenew}
                  onClick={() => void handleCancelAutoRenew()}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-700 bg-slate-800/80 text-slate-200 text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                >
                  {cancelingAutoRenew && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Cancel Auto-Renew</span>
                </button>
              )}
            </div>
          </div>

          {/* Right Column: Live Monthly AI Quota Meters */}
          <div className="lg:col-span-5 bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Monthly AI Usage Quota</span>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                Resets {formatShortDate(aiUsageSummary.periodEndIso)}
              </span>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">AI Insights Runs</span>
                  <span className="font-mono tabular-nums font-semibold text-white">
                    {aiUsageSummary.insightsLimit > 0
                      ? `${aiUsageSummary.insightsUsed} / ${aiUsageSummary.insightsLimit}`
                      : 'Not included in Starter'}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      insightsPct >= 90 ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${insightsPct}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">AI Advisor Messages</span>
                  <span className="font-mono tabular-nums font-semibold text-white">
                    {aiUsageSummary.advisorLimit > 0
                      ? `${aiUsageSummary.advisorUsed} / ${aiUsageSummary.advisorLimit}`
                      : 'Gold & Diamond VIP'}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      advisorPct >= 90 ? 'bg-amber-500' : 'bg-sky-500'
                    }`}
                    style={{ width: `${advisorPct}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
              <span>Backend verified enforcement</span>
              <span className="font-mono tabular-nums text-slate-300">
                Forecasts run: {aiUsageSummary.forecastUsed}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Preserved Starter VIP Core Features Strip */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Preserved in CLASS 2 Starter VIP &amp; Every Higher Tier
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Zero features removed or moved out of Starter VIP
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
          {STARTER_PRESERVED_FEATURES.map((feat) => (
            <div
              key={feat}
              className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300"
            >
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <span>{feat}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Interactive Billing Cycle Switcher + 4-Tier Plan Grid */}
      <section className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              Choose Your VIP Membership Class
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Transparent INR pricing with instant quota provisioning and automatic monthly resets.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Billing Cycle"
            className="inline-flex items-center p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-fit"
          >
            {(['monthly', 'quarterly', 'yearly'] as BillingCycle[]).map((cycle) => {
              const active = selectedCycle === cycle;
              return (
                <button
                  key={cycle}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedCycle(cycle)}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {BILLING_CYCLE_LABELS[cycle].label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
          {VIP_TIER_ORDER.map((tierId) => {
            const spec = VIP_TIER_CONFIGS[tierId];
            const isCurrent = vipTier === tierId;
            const currentRank = getTierRank(vipTier);
            const targetRank = getTierRank(tierId);
            const price = spec.pricesInr[selectedCycle];
            const savingsPct = getBillingCycleSavingsPct(tierId, selectedCycle);
            const hasPendingForPlan = pendingRequests.some(
              (r) => r.tier === tierId && r.billingCycle === selectedCycle
            );

            return (
              <div
                key={tierId}
                className={`bg-white dark:bg-slate-900 rounded-xl p-5 flex flex-col justify-between gap-5 border ${
                  isCurrent
                    ? `${spec.accentBorderClass} ring-1 ring-inset ring-emerald-500/30`
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono font-bold tracking-wider text-slate-500 dark:text-slate-400">
                      {spec.classLabel}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${spec.badgeContainerClass}`}
                    >
                      <Crown className="w-3 h-3 shrink-0" />
                      {spec.badgeLabel}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <h4 className="text-base font-bold text-slate-900 dark:text-white">
                      {spec.name}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed min-h-[36px]">
                      {spec.tagline}
                    </p>
                  </div>

                  <div className="pt-1 pb-2 border-b border-slate-100 dark:border-slate-800 space-y-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                        ₹{price}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {BILLING_CYCLE_LABELS[selectedCycle].short}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 min-h-[16px]">
                      {savingsPct > 0
                        ? `Save ~${savingsPct}% vs monthly`
                        : `₹${spec.pricesInr.monthly}/mo · ₹${spec.pricesInr.quarterly}/qtr · ₹${spec.pricesInr.yearly}/yr`}
                    </div>
                  </div>

                  {/* Monthly Quotas Box */}
                  <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">AI Insights</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                        {spec.insightsLimit > 0 ? `${spec.insightsLimit} / month` : 'Not included'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">AI Advisor Chat</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                        {spec.advisorLimit > 0 ? `${spec.advisorLimit} msg / mo` : 'Not included'}
                      </span>
                    </div>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                    {spec.highlights.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <Check className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${spec.accentTextClass}`} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  type="button"
                  disabled={
                    (isCurrent && vipSubscription?.billingCycle === selectedCycle) ||
                    hasPendingForPlan
                  }
                  onClick={() => handleOpenCheckout(tierId)}
                  className={`w-full py-2.5 px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    hasPendingForPlan
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 cursor-default border border-amber-300 dark:border-amber-800'
                      : isCurrent && vipSubscription?.billingCycle === selectedCycle
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-default border border-slate-200 dark:border-slate-700'
                      : targetRank > currentRank
                      ? 'bg-slate-900 dark:bg-emerald-600 text-white hover:opacity-90'
                      : 'border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {hasPendingForPlan
                    ? 'Pending Admin Approval'
                    : isCurrent && vipSubscription?.billingCycle === selectedCycle
                    ? 'Current Plan'
                    : isCurrent
                    ? `Switch to ${BILLING_CYCLE_LABELS[selectedCycle].label}`
                    : targetRank > currentRank
                    ? `Upgrade to ${spec.name}`
                    : `Select ${spec.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 4-Tier AI Capabilities & Benefits Comparison Matrix */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              CLASS 2 – CLASS 5 Feature &amp; AI Allowance Comparison
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All core accounting features stay in Starter VIP; tiers scale AI depth, monthly allowance, and priority support.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Server-Verified Quotas</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-6">Capability</th>
                <th className="py-3 px-4">CLASS 2 · Starter</th>
                <th className="py-3 px-4">CLASS 3 · Silver</th>
                <th className="py-3 px-4">CLASS 4 · Gold</th>
                <th className="py-3 px-6">CLASS 5 · Diamond</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {MATRIX_ROWS.map((row) => (
                <tr key={row.capability} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-6 font-medium text-slate-900 dark:text-white">
                    {row.capability}
                  </td>
                  {VIP_TIER_ORDER.map((t) => {
                    const val = row.values[t];
                    const isDash = val.startsWith('—');
                    return (
                      <td
                        key={t}
                        className={`py-3 px-4 whitespace-nowrap font-mono tabular-nums ${
                          isDash
                            ? 'text-slate-400'
                            : 'text-emerald-700 dark:text-emerald-400 font-semibold'
                        }`}
                      >
                        {val}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Diamond Priority Customer Support + Upcoming VIP Lab Automations */}
      <div className="grid lg:grid-cols-12 gap-5">
        <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <Headphones className="w-4 h-4" />
              </div>
              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                CLASS 5 · Diamond VIP Benefit
              </span>
            </div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Priority Customer Support Desk
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Diamond VIP members receive expedited assistance for ledger sync, account inquiries, AI planning tuning, and billing support directly at{' '}
              <span className="font-mono text-slate-800 dark:text-slate-200">{SUPPORT_EMAIL}</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                vipTier === 'diamond'
                  ? '[Diamond VIP Priority Support] FinTrack Assistance'
                  : 'FinTrack VIP Plan Inquiry'
              )}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>
                {vipTier === 'diamond' ? 'Contact Priority Support' : 'Contact Support'}
              </span>
            </a>
            {vipTier !== 'diamond' && (
              <button
                type="button"
                onClick={() => handleOpenCheckout('diamond')}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                Unlock Diamond Support
              </button>
            )}
          </div>
        </section>

        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Upcoming VIP Lab Automations
              </h3>
            </div>
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
              In Active Development
            </span>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {UPCOMING_LAB_AUTOMATIONS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Icon className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      Coming Soon
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    {item.title}
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {item.summary}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* User VIP UPI Payment Request History */}
      {userVipPaymentRequests.length > 0 && (
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Your VIP UPI Payment Verification Requests
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Track admin confirmation or rejection status for UPI payments made to{' '}
                <span className="font-mono">{VIP_UPI_ID}</span>.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-6">Plan &amp; Cycle</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">UTR / UPI Ref</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-6">Admin Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {userVipPaymentRequests.map((req) => {
                  const tierSpec = VIP_TIER_CONFIGS[req.tier];
                  return (
                    <tr key={req.id}>
                      <td className="py-3 px-6 font-medium text-slate-900 dark:text-white">
                        {tierSpec.classLabel} · {tierSpec.name} ({BILLING_CYCLE_LABELS[req.billingCycle].label})
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                        ₹{req.amountInr}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        <div>{req.utrReference}</div>
                        <div className="text-slate-400">{req.paymentReference}</div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {req.status === 'approved' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            Confirmed
                          </span>
                        ) : req.status === 'rejected' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                            Rejected
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            Pending Admin Review
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-6 text-slate-600 dark:text-slate-400">
                        {req.adminNote ||
                          (req.status === 'pending'
                            ? 'Awaiting confirmation from Admin Panel'
                            : '—')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* UPI App Redirect & Admin Verification Checkout Modal */}
      {checkoutTier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-6 space-y-5 max-h-[92vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                  {VIP_TIER_CONFIGS[checkoutTier].classLabel} · UPI PAYMENT
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  {checkoutStep === 'pay'
                    ? `Pay via UPI for ${VIP_TIER_CONFIGS[checkoutTier].name}`
                    : `Submit UPI Payment Confirmation`}
                </h3>
              </div>
              <button
                type="button"
                disabled={submittingCheckout}
                onClick={() => setCheckoutTier(null)}
                aria-label="Close Checkout"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Membership Plan</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {VIP_TIER_CONFIGS[checkoutTier].badgeLabel}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Billing Cycle</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {BILLING_CYCLE_LABELS[selectedCycle].label} ({BILLING_CYCLE_LABELS[selectedCycle].days} days)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Pay To UPI ID</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {VIP_UPI_ID}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500 dark:text-slate-400">Payment Reference</span>
                <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  {checkoutPaymentRef}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-900 dark:text-white">Amount Payable</span>
                <span className="font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                  ₹{getTierPrice(checkoutTier, selectedCycle)}
                </span>
              </div>
            </div>

            {/* Recipient UPI ID Copy Box */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Official FinTrack Merchant UPI ID
                </div>
                <div className="text-sm font-mono font-bold text-slate-900 dark:text-white truncate">
                  {VIP_UPI_ID}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyUpiId()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
              >
                {copiedUpi ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy UPI ID</span>
                  </>
                )}
              </button>
            </div>

            {checkoutError && (
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{checkoutError}</span>
              </div>
            )}

            {checkoutStep === 'pay' ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3.5 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Admin Verification Required</span>
                  </div>
                  <p className="leading-relaxed">
                    Clicking Pay will open your UPI app (GPay, PhonePe, Paytm, BHIM) to pay{' '}
                    <strong>₹{getTierPrice(checkoutTier, selectedCycle)}</strong> to{' '}
                    <span className="font-mono font-semibold">{VIP_UPI_ID}</span>. VIP features do NOT unlock automatically—your request goes to the Admin Panel for confirmation.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleLaunchUpiApp}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90"
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>
                      Open UPI App &amp; Pay ₹{getTierPrice(checkoutTier, selectedCycle)}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCheckoutError('');
                      setCheckoutStep('confirm');
                    }}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Already Paid to {VIP_UPI_ID}? Enter UTR Reference
                  </button>

                  <button
                    type="button"
                    onClick={() => setCheckoutTier(null)}
                    className="w-full px-4 py-2 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmitPaymentForAdminReview} className="space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">
                    Step 2 of 2: Enter UPI Transaction ID / UTR
                  </span>
                  <a
                    href={activeUpiDeepLink}
                    className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Open UPI App Again</span>
                  </a>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="vip-utr-input"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    UPI Transaction ID / 12-Digit UTR *
                  </label>
                  <input
                    id="vip-utr-input"
                    type="text"
                    required
                    minLength={4}
                    maxLength={64}
                    value={utrInput}
                    onChange={(e) => setUtrInput(e.target.value)}
                    placeholder="e.g. 432198765432 or UPI Ref ID"
                    className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Found in your UPI app payment receipt. Sent directly to Admin for confirmation or rejection.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={submittingCheckout}
                    onClick={() => setCheckoutStep('pay')}
                    className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={submittingCheckout || utrInput.trim().length < 4}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    {submittingCheckout && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>
                      {submittingCheckout
                        ? 'Sending to Admin...'
                        : 'Submit Payment for Admin Approval'}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
