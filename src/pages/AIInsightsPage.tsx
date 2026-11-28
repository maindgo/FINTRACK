import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Crown,
  Headphones,
  Info,
  Lightbulb,
  Loader2,
  Lock,
  Mail,
  PiggyBank,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  User as UserIcon,
  Wallet,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import {
  AIInsightsApiError,
  buildSanitizedFinancialSnapshot,
  fetchAIInsights,
  fetchDiamondForecast,
  sendAIChatMessage,
} from '../services/aiInsightsService';
import { formatDurationHhMmSs } from '../services/securityDetectionService';
import { AIChatMessage, GeminiAIInsightsResult, NavSection } from '../types/finance';
import { SUPPORT_EMAIL } from '../utils/constants';
import { formatCurrency } from '../utils/formatters';
import { tierMeetsMinimum, VIP_TIER_CONFIGS } from '../utils/vipTiers';

interface AIInsightsPageProps {
  onNavigate?: (section: NavSection) => void;
}

const STARTER_QUESTIONS = [
  'How much did I spend on food this month?',
  'Where am I spending the most?',
  'How can I save ₹5,000 every month?',
  'Compare my expenses with last month.',
] as const;

function formatInr(amount: number): string {
  return formatCurrency(amount, 'INR');
}

function getSeverityClasses(severity: string) {
  const s = severity.toLowerCase();
  if (s === 'critical') {
    return {
      wrapper:
        'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-900 text-red-900 dark:text-red-200',
      iconColor: 'text-red-600 dark:text-red-400',
      Icon: AlertTriangle,
    };
  }
  if (s === 'warning') {
    return {
      wrapper:
        'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200',
      iconColor: 'text-amber-600 dark:text-amber-400',
      Icon: AlertTriangle,
    };
  }
  return {
    wrapper:
      'bg-blue-50/60 dark:bg-blue-950/25 border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-200',
    iconColor: 'text-blue-600 dark:text-blue-400',
    Icon: Info,
  };
}

function getPriorityStyle(priority: string): string {
  const p = priority.toLowerCase();
  if (p === 'high') {
    return 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800';
  }
  if (p === 'medium') {
    return 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800';
  }
  return 'text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700';
}

export function AIInsightsPage({ onNavigate }: AIInsightsPageProps) {
  const {
    transactions,
    budgets,
    bills,
    savingsGoals,
    recurringTransactions,
    profile,
    currency,
    isAiRestricted,
    aiRestrictedUntilMs,
    vipTier,
    aiUsageSummary,
    applyBackendAiUsage,
    isAdmin,
    isGuest,
  } = useFinance();

  const canUseInsights = !isGuest && (isAdmin || tierMeetsMinimum(vipTier, 'silver'));
  const canUseHealthScore = !isGuest && (isAdmin || tierMeetsMinimum(vipTier, 'gold'));
  const canUseAdvisor = !isGuest && (isAdmin || tierMeetsMinimum(vipTier, 'gold'));
  const canUseForecast = !isGuest && (isAdmin || tierMeetsMinimum(vipTier, 'diamond'));
  const tierConfig = VIP_TIER_CONFIGS[vipTier];

  const snapshot = useMemo(
    () =>
      buildSanitizedFinancialSnapshot({
        transactions,
        budgets,
        bills,
        savingsGoals,
        recurringTransactions,
        monthlyBudgetLimit: profile?.monthlyBudgetLimit || 0,
      }),
    [transactions, budgets, bills, savingsGoals, recurringTransactions, profile?.monthlyBudgetLimit]
  );

  const [aiResult, setAiResult] = useState<GeminiAIInsightsResult | null>(null);
  const [diamondForecastState, setDiamondForecastState] = useState<
    GeminiAIInsightsResult['diamond_forecast'] | null
  >(null);
  const [generatedAt, setGeneratedAt] = useState<string>('');
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [insightsError, setInsightsError] = useState<string>('');
  const [forecastError, setForecastError] = useState<string>('');

  const [chatMessages, setChatMessages] = useState<AIChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');

  const lastAutoFetchedKeyRef = useRef<string>('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const hasTransactions = snapshot.transactionCount > 0;
  const hasPreviousMonthData = snapshot.previousMonthTransactionCount > 0;

  const snapshotSignature = useMemo(() => {
    return [
      vipTier,
      snapshot.transactionCount,
      snapshot.monthlySummary.income,
      snapshot.monthlySummary.expenses,
      snapshot.monthlySummary.prevExpenses,
      snapshot.budgets.length,
      snapshot.savingsGoals.length,
    ].join('|');
  }, [snapshot, vipTier]);

  const loadInsights = useCallback(async () => {
    if (!canUseInsights || isAiRestricted || !hasTransactions) {
      setAiResult(null);
      setDiamondForecastState(null);
      setInsightsError('');
      return;
    }

    setLoadingInsights(true);
    setInsightsError('');
    try {
      const data = await fetchAIInsights(snapshot);
      setAiResult(data.insights);
      setDiamondForecastState(data.insights.diamond_forecast || null);
      setGeneratedAt(data.generatedAt);
      if (data.usage) {
        applyBackendAiUsage(data.usage);
      }
    } catch (err: unknown) {
      if (err instanceof AIInsightsApiError) {
        if (err.usage) applyBackendAiUsage(err.usage);
        setInsightsError(err.message);
      } else {
        setInsightsError('Unable to reach the AI Insights service. Please try again.');
      }
    } finally {
      setLoadingInsights(false);
    }
  }, [applyBackendAiUsage, canUseInsights, hasTransactions, isAiRestricted, snapshot]);

  const handleRefreshDiamondForecast = async () => {
    if (!canUseForecast || isAiRestricted || !hasTransactions || loadingForecast) return;
    setLoadingForecast(true);
    setForecastError('');
    try {
      const res = await fetchDiamondForecast(snapshot);
      setDiamondForecastState(res.diamond_forecast);
      if (res.usage) {
        applyBackendAiUsage(res.usage);
      }
    } catch (err: unknown) {
      if (err instanceof AIInsightsApiError) {
        if (err.usage) applyBackendAiUsage(err.usage);
        setForecastError(err.message);
      } else {
        setForecastError('Unable to generate Diamond AI Forecast right now. Please try again.');
      }
    } finally {
      setLoadingForecast(false);
    }
  };

  useEffect(() => {
    if (!canUseInsights || isAiRestricted) {
      return;
    }
    if (!hasTransactions) {
      lastAutoFetchedKeyRef.current = '';
      setAiResult(null);
      setDiamondForecastState(null);
      return;
    }
    if (lastAutoFetchedKeyRef.current === snapshotSignature) {
      return;
    }
    lastAutoFetchedKeyRef.current = snapshotSignature;
    void loadInsights();
  }, [canUseInsights, hasTransactions, isAiRestricted, snapshotSignature, loadInsights]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, chatLoading]);

  const handleSendChat = async (questionOverride?: string) => {
    const trimmed = (questionOverride ?? chatInput).trim();
    if (!canUseAdvisor || !trimmed || chatLoading || !hasTransactions) return;
    if (trimmed.length > 600) {
      setChatError('Please keep questions under 600 characters.');
      return;
    }

    const userMsg: AIChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    const nextHistory = [...chatMessages, userMsg];
    setChatMessages(nextHistory);
    if (!questionOverride) {
      setChatInput('');
    }
    setChatError('');
    setChatLoading(true);

    try {
      const res = await sendAIChatMessage({
        question: trimmed,
        history: chatMessages.slice(-8).map((m) => ({
          role: m.role,
          content: m.content,
        })),
        snapshot,
      });

      if (res.usage) {
        applyBackendAiUsage(res.usage);
      }

      const assistantMsg: AIChatMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: res.answer,
        timestamp: new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch (err: unknown) {
      if (err instanceof AIInsightsApiError && err.usage) {
        applyBackendAiUsage(err.usage);
      }
      const message =
        err instanceof AIInsightsApiError
          ? err.message
          : 'Unable to get an AI response right now. Please try again.';
      setChatError(message);
    } finally {
      setChatLoading(false);
    }
  };

  const categoryChartData = useMemo(() => {
    return snapshot.categoryBreakdown.slice(0, 7).map((cat) => ({
      category: cat.category.length > 12 ? `${cat.category.slice(0, 11)}…` : cat.category,
      fullCategory: cat.category,
      currentMonth: cat.currentMonth,
      previousMonth: cat.previousMonth,
    }));
  }, [snapshot.categoryBreakdown]);

  const { monthlySummary } = snapshot;

  if (isAiRestricted) {
    const remainingMs = aiRestrictedUntilMs ? Math.max(0, aiRestrictedUntilMs - Date.now()) : 0;
    return (
      <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-2xl p-6 sm:p-8 max-w-2xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              AI Access Temporarily Restricted
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Your AI Insights and AI Assistant features have been temporarily restricted by FinTrack Security Center. Core accounting features remain available.
            </p>
          </div>
        </div>
        {remainingMs > 0 && (
          <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between text-xs">
            <span className="text-slate-600 dark:text-slate-400">Time remaining</span>
            <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
              {formatDurationHhMmSs(remainingMs)}
            </span>
          </div>
        )}
        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Dashboard</span>
          </button>
        )}
      </div>
    );
  }

  if (!canUseInsights) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              AI Financial Insights
            </h2>
            {!isGuest && (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${tierConfig.badgeContainerClass}`}
              >
                <Crown className="w-3 h-3" />
                {tierConfig.classLabel} · {tierConfig.badgeLabel}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Unlock monthly Gemini AI expense analysis, conversational advisor guidance, and predictive forecasting.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 max-w-3xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div className="space-y-2 flex-1">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {isGuest
                  ? 'Sign In & Upgrade to Unlock AI Insights'
                  : 'Starter VIP Core Tools Active — Upgrade for AI Insights'}
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                All standard Starter VIP tools (Dashboard, Financial Reports, Budgets, Wallets, Payment Reminders, Recurring Transactions, and Lending &amp; Borrowing) remain 100% unlocked. Upgrade to Silver VIP (₹49/mo), Gold VIP (₹59/mo), or Diamond VIP (₹69/mo) for AI-powered analysis.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="font-bold text-sky-700 dark:text-sky-300">CLASS 3 · Silver VIP</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-white">₹49/mo</div>
              <p className="text-slate-600 dark:text-slate-400">
                10 AI Insights / mo · Monthly AI expense analysis &amp; spending guidance
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="font-bold text-amber-700 dark:text-amber-300">CLASS 4 · Gold VIP</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-white">₹59/mo</div>
              <p className="text-slate-600 dark:text-slate-400">
                30 Insights + 50 Advisor messages / mo · Health Score &amp; Advisor Chat
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <div className="font-bold text-emerald-700 dark:text-emerald-300">CLASS 5 · Diamond VIP</div>
              <div className="font-mono font-semibold text-slate-900 dark:text-white">₹69/mo</div>
              <p className="text-slate-600 dark:text-slate-400">
                100 Insights + 200 Advisor · AI Forecasting, Planning &amp; Priority Support
              </p>
            </div>
          </div>

          {onNavigate && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('vip')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 transition-opacity"
              >
                <Crown className="w-4 h-4" />
                <span>Explore VIP Plans</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('insights')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <BarChart3 className="w-4 h-4" />
                <span>Open Standard Insights &amp; Analytics</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header + Active Tier Quota Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              AI Financial Insights
            </h2>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${tierConfig.badgeContainerClass}`}
            >
              <Crown className="w-3 h-3 shrink-0" />
              {tierConfig.classLabel} · {tierConfig.badgeLabel}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Personalized Gemini AI spending analysis, practical saving recommendations, and goal projections in Indian Rupees (₹).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {generatedAt && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              Updated{' '}
              {new Date(generatedAt).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          <button
            type="button"
            disabled={loadingInsights || !hasTransactions}
            onClick={() => {
              lastAutoFetchedKeyRef.current = snapshotSignature;
              void loadInsights();
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
          >
            {loadingInsights ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>{loadingInsights ? 'Analyzing...' : 'Refresh AI Insights'}</span>
          </button>
        </div>
      </div>

      {/* Live Monthly Quota & VIP Tier Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">AI Insights Quota:</span>
            <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
              {aiUsageSummary.insightsUsed} / {aiUsageSummary.insightsLimit}
            </span>
          </div>
          {canUseAdvisor && (
            <div className="flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400">Advisor Messages:</span>
              <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                {aiUsageSummary.advisorUsed} / {aiUsageSummary.advisorLimit}
              </span>
            </div>
          )}
          {aiUsageSummary.periodEndIso && (
            <div className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
              Resets{' '}
              {new Date(aiUsageSummary.periodEndIso).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tierConfig.hasPrioritySupport && (
            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                '[Diamond VIP Priority Support] AI Insights Inquiry'
              )}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold whitespace-nowrap"
            >
              <Headphones className="w-3.5 h-3.5" />
              Priority Support
            </a>
          )}
          {onNavigate && vipTier !== 'diamond' && (
            <button
              type="button"
              onClick={() => onNavigate('vip')}
              className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400 hover:underline whitespace-nowrap"
            >
              <Crown className="w-3.5 h-3.5" />
              Upgrade VIP Quota
            </button>
          )}
        </div>
      </div>

      {/* Currency / Data Boundary Banner */}
      {currency !== 'INR' && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-xl px-4 py-3 flex items-start gap-2.5 text-xs text-blue-900 dark:text-blue-200">
          <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <span>
            Your workspace currency is set to <span className="font-semibold">{currency}</span>. All AI Financial Insights and structured figures below are displayed in{' '}
            <span className="font-semibold">Indian Rupees (₹)</span> using your recorded amounts.
          </span>
        </div>
      )}

      {/* No Data State */}
      {!hasTransactions ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto">
            <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-white">
            Insufficient Financial Data for AI Insights
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
            No income or expense transactions have been recorded yet. Add your real transactions, budgets, or savings goals to generate personalized Gemini AI insights without estimated or placeholder numbers.
          </p>
        </div>
      ) : (
        <>
          {/* Error Banner (if Gemini API call failed or key missing) */}
          {insightsError && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-semibold">AI Analysis Unavailable</div>
                  <p className="text-amber-800 dark:text-amber-300">{insightsError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadInsights()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 whitespace-nowrap self-start sm:self-auto shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          )}

          {/* SECTION A: Monthly Financial Summary */}
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                A. Monthly Financial Summary ({snapshot.currentMonthLabel})
              </h3>
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Actual Recorded Data (INR ₹)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {/* Total Monthly Income */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Monthly Income
                  </span>
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatInr(monthlySummary.income)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  {monthlySummary.incomeGrowthPct !== null ? (
                    <>
                      {monthlySummary.incomeGrowthPct >= 0 ? (
                        <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <ArrowDownRight className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                      )}
                      <span className="font-mono tabular-nums">
                        {monthlySummary.incomeGrowthPct >= 0 ? '+' : ''}
                        {monthlySummary.incomeGrowthPct.toFixed(1)}%
                      </span>{' '}
                      vs {snapshot.previousMonthLabel}
                    </>
                  ) : (
                    <span>Prev month: {formatInr(monthlySummary.prevIncome)}</span>
                  )}
                </div>
              </div>

              {/* Total Monthly Expenses */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Monthly Expenses
                  </span>
                  <TrendingDown className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {formatInr(monthlySummary.expenses)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  {monthlySummary.expenseGrowthPct !== null ? (
                    <>
                      {monthlySummary.expenseGrowthPct > 0 ? (
                        <ArrowUpRight className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      )}
                      <span className="font-mono tabular-nums">
                        {monthlySummary.expenseGrowthPct >= 0 ? '+' : ''}
                        {monthlySummary.expenseGrowthPct.toFixed(1)}%
                      </span>{' '}
                      vs {snapshot.previousMonthLabel}
                    </>
                  ) : (
                    <span>Prev month: {formatInr(monthlySummary.prevExpenses)}</span>
                  )}
                </div>
              </div>

              {/* Total Savings */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Monthly Net Savings
                  </span>
                  <Wallet className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div
                  className={`text-xl font-bold font-mono tabular-nums ${
                    monthlySummary.savings >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {formatInr(monthlySummary.savings)}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Prev month net: {formatInr(monthlySummary.prevSavings)}
                </div>
              </div>

              {/* Savings Rate */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Savings Rate
                  </span>
                  <PiggyBank className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {monthlySummary.savingsRatePct !== null
                    ? `${monthlySummary.savingsRatePct.toFixed(1)}%`
                    : 'N/A'}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {monthlySummary.savingsRatePct !== null
                    ? 'Share of monthly income retained'
                    : 'Log income this month to compute rate'}
                </div>
              </div>
            </div>

            {/* AI Summary Narrative Card */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    AI Monthly Assessment
                  </h4>
                </div>
                <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  AI-Generated Summary
                </span>
              </div>

              {loadingInsights && !aiResult ? (
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 py-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  Generating personalized summary from your transaction records...
                </div>
              ) : aiResult ? (
                <div className="space-y-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  <p>{aiResult.financial_summary.overview}</p>
                  <div className="grid sm:grid-cols-2 gap-3 pt-1 text-xs">
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <div className="font-semibold text-slate-800 dark:text-slate-200 mb-1">
                        Month-over-Month Comparison
                      </div>
                      <p className="text-slate-600 dark:text-slate-400">
                        {aiResult.financial_summary.previous_month_comparison}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <div className="font-semibold text-slate-800 dark:text-slate-200 mb-1">
                        Data Completeness Note
                      </div>
                      <p className="text-slate-600 dark:text-slate-400">
                        {aiResult.financial_summary.data_availability_note}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Click &ldquo;Refresh AI Insights&rdquo; above to generate an AI summary of your monthly cash flow.
                </p>
              )}
            </div>
          </section>

          {/* SECTION B: Spending Analysis & Charts */}
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                B. Spending Analysis &amp; Category Trends
              </h3>
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Actual Transactions + AI Anomaly Detection
              </span>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Chart 1: Category Comparison (Current vs Previous Month) */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Category Spending: {snapshot.currentMonthLabel} vs {snapshot.previousMonthLabel}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {hasPreviousMonthData
                      ? 'Side-by-side comparison of your top expense categories in ₹.'
                      : 'Showing recorded expenses by category (no previous month transactions recorded yet).'}
                  </p>
                </div>

                {categoryChartData.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-xs text-slate-400">
                    No expense categories recorded yet.
                  </div>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={categoryChartData}
                        margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                        <XAxis
                          dataKey="category"
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#64748b' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => `₹${Math.round(Number(v) / 1000)}k`}
                        />
                        <Tooltip
                          formatter={(value: unknown) => formatInr(Number(value) || 0)}
                          labelFormatter={(_label, payload) =>
                            (payload?.[0]?.payload as { fullCategory?: string })?.fullCategory ||
                            String(_label)
                          }
                          contentStyle={{
                            backgroundColor: '#0f172a',
                            border: '1px solid #1e293b',
                            borderRadius: '8px',
                            color: '#f8fafc',
                            fontSize: '12px',
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                        <Bar
                          dataKey="currentMonth"
                          name={snapshot.currentMonthLabel}
                          fill="#16A34A"
                          radius={[4, 4, 0, 0]}
                        />
                        {hasPreviousMonthData && (
                          <Bar
                            dataKey="previousMonth"
                            name={snapshot.previousMonthLabel}
                            fill="#64748B"
                            radius={[4, 4, 0, 0]}
                          />
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Chart 2: 6-Month Spending & Income Trend */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    6-Month Cash Flow Trend
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Monthly income versus expenses trajectory across recent months (₹).
                  </p>
                </div>

                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={snapshot.monthlyTrend}
                      margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                      <XAxis
                        dataKey="monthLabel"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `₹${Math.round(Number(v) / 1000)}k`}
                      />
                      <Tooltip
                        formatter={(value: unknown) => formatInr(Number(value) || 0)}
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          border: '1px solid #1e293b',
                          borderRadius: '8px',
                          color: '#f8fafc',
                          fontSize: '12px',
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '12px' }} />
                      <Area
                        type="monotone"
                        dataKey="income"
                        name="Income"
                        stroke="#16A34A"
                        fill="#16A34A"
                        fillOpacity={0.14}
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="expenses"
                        name="Expenses"
                        stroke="#2563EB"
                        fill="#2563EB"
                        fillOpacity={0.14}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Top Categories & Unusual Spending */}
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Highest Spending Categories
                  </h4>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Share &amp; MoM Change
                  </span>
                </div>

                {aiResult?.spending_analysis.narrative && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                    {aiResult.spending_analysis.narrative}
                  </p>
                )}

                {snapshot.categoryBreakdown.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No expense category records available yet.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {snapshot.categoryBreakdown.slice(0, 5).map((cat) => {
                      const aiCatNote = aiResult?.spending_analysis.top_categories.find(
                        (c) => c.category.toLowerCase() === cat.category.toLowerCase()
                      )?.trend_note;

                      return (
                        <div key={cat.category} className="py-3 space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-slate-900 dark:text-white">
                              {cat.category}
                            </span>
                            <div className="flex items-center gap-3 font-mono tabular-nums">
                              <span className="text-slate-500 dark:text-slate-400">
                                {cat.sharePct.toFixed(1)}%
                              </span>
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {formatInr(
                                  monthlySummary.expenses > 0 ? cat.currentMonth : cat.allTimeTotal
                                )}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                            <span>{aiCatNote || `${cat.txCount} transaction(s)`}</span>
                            {cat.changePct !== null && (
                              <span
                                className={`font-mono tabular-nums font-semibold ${
                                  cat.changePct > 15
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : cat.changePct < 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {cat.changePct >= 0 ? '+' : ''}
                                {cat.changePct.toFixed(1)}% MoM
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Unusual Spending Alerts */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Unusual Spending Detection
                  </h4>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Spikes &ge; 2&times; Average
                  </span>
                </div>

                {aiResult?.unusual_spending.summary && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {aiResult.unusual_spending.summary}
                  </p>
                )}

                {aiResult && aiResult.unusual_spending.alerts.length > 0 ? (
                  <div className="space-y-2.5">
                    {aiResult.unusual_spending.alerts.map((alert, idx) => {
                      const sev = getSeverityClasses(alert.severity);
                      const SevIcon = sev.Icon;
                      return (
                        <div
                          key={`${alert.category}-${idx}`}
                          className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 ${sev.wrapper}`}
                        >
                          <SevIcon className={`w-4 h-4 shrink-0 mt-0.5 ${sev.iconColor}`} />
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold">{alert.category}</span>
                              <span className="font-mono tabular-nums font-bold">
                                {formatInr(alert.amount_inr)}
                              </span>
                            </div>
                            <p className="opacity-90 leading-relaxed">{alert.reason}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : snapshot.unusualTransactions.length > 0 ? (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {snapshot.unusualTransactions.map((u, idx) => (
                      <div key={`${u.category}-${u.date}-${idx}`} className="py-2.5 flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {u.category}
                          </div>
                          <div className="text-slate-500 dark:text-slate-400">
                            {u.date} · {u.multipleOfAverage.toFixed(1)}&times; your typical expense
                          </div>
                        </div>
                        <span className="font-mono tabular-nums font-semibold text-amber-600 dark:text-amber-400">
                          {formatInr(u.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center space-y-1.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mx-auto" />
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      No unusual spending spikes detected
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Individual transactions remain within normal historical bounds.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* SECTION C: Smart AI Suggestions & Budget Recommendations */}
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                C. Smart AI Suggestions &amp; Budget Recommendations
              </h3>
              <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                AI-Generated Recommendations
              </span>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Savings Suggestions */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Actionable Savings Suggestions
                  </h4>
                </div>

                {loadingInsights && !aiResult ? (
                  <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                    Generating personalized cost-cutting ideas...
                  </div>
                ) : aiResult && aiResult.savings_suggestions.length > 0 ? (
                  <div className="space-y-3">
                    {aiResult.savings_suggestions.map((item, idx) => (
                      <div
                        key={`${item.title}-${idx}`}
                        className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white">
                            {item.title}
                          </span>
                          <span
                            className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border shrink-0 ${getPriorityStyle(
                              item.priority
                            )}`}
                          >
                            {item.priority}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          {item.action_step}
                        </p>
                        {item.potential_monthly_saving_inr > 0 && (
                          <div className="text-xs font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400 pt-0.5">
                            Est. potential monthly saving: {formatInr(item.potential_monthly_saving_inr)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                    {insightsError
                      ? 'Suggestions will appear once Gemini AI analysis is available.'
                      : 'Add more categorized expenses to unlock tailored expense reduction steps.'}
                  </p>
                )}
              </div>

              {/* Budget Recommendations */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Monthly Budget Recommendations
                  </h4>
                </div>

                {loadingInsights && !aiResult ? (
                  <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                    Evaluating category allocations...
                  </div>
                ) : aiResult && aiResult.budget_recommendations.length > 0 ? (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {aiResult.budget_recommendations.map((rec, idx) => (
                      <div key={`${rec.category}-${idx}`} className="py-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {rec.category}
                          </span>
                          <div className="flex items-center gap-2 font-mono tabular-nums">
                            <span className="text-slate-500 dark:text-slate-400">
                              {rec.current_budget_inr > 0
                                ? `Current: ${formatInr(rec.current_budget_inr)}`
                                : 'No cap set'}
                            </span>
                            <span className="text-slate-400">&rarr;</span>
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                              Suggested: {formatInr(rec.recommended_budget_inr)}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                          {rec.rationale}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                    {insightsError
                      ? 'Budget recommendations will appear once Gemini AI analysis completes.'
                      : 'Set monthly budgets in the Budgets section or record category expenses for tailored budget caps.'}
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* SECTION D: Savings Predictions */}
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                D. Savings Goal Predictions
              </h3>
              <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                AI Estimates Only · Not Guarantees
              </span>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              {/* Mandatory Estimate & Non-Investment Disclaimer */}
              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3.5 py-2.5 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400">
                <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Important Notice:
                  </span>{' '}
                  {aiResult?.savings_predictions.disclaimer ||
                    'Goal timelines are projections estimated from your historical income and expense patterns. These are estimates only, not guarantees, and FinTrack does not provide personalized investment advice or guaranteed returns.'}
                </span>
              </div>

              {loadingInsights && !aiResult ? (
                <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  Calculating goal completion estimates...
                </div>
              ) : snapshot.savingsGoals.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                  {aiResult?.savings_predictions.summary ||
                    'No active savings goals found. Add a target goal in the Savings page to see estimated completion timelines.'}
                </p>
              ) : (
                <div className="space-y-4">
                  {aiResult?.savings_predictions.summary && (
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {aiResult.savings_predictions.summary}
                    </p>
                  )}

                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(aiResult?.savings_predictions.goals &&
                    aiResult.savings_predictions.goals.length > 0
                      ? aiResult.savings_predictions.goals
                      : snapshot.savingsGoals.map((g) => ({
                          goal_name: g.label,
                          target_amount_inr: g.targetAmount,
                          saved_amount_inr: g.savedAmount,
                          estimated_months_to_goal: 0,
                          estimated_completion_label: g.targetDate || 'Pending AI estimate',
                          monthly_saving_needed_inr: 0,
                          status_note: `Saved ${formatInr(g.savedAmount)} of ${formatInr(g.targetAmount)}`,
                        }))
                    ).map((goal, idx) => {
                      const pct =
                        goal.target_amount_inr > 0
                          ? Math.min(100, (goal.saved_amount_inr / goal.target_amount_inr) * 100)
                          : 0;
                      return (
                        <div
                          key={`${goal.goal_name}-${idx}`}
                          className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                {goal.goal_name}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                Est. Completion: {goal.estimated_completion_label}
                              </div>
                            </div>
                            <span className="text-xs font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                              {pct.toFixed(0)}%
                            </span>
                          </div>

                          <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-emerald-600 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>

                          <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            <span>{formatInr(goal.saved_amount_inr)}</span>
                            <span className="text-slate-400">
                              / {formatInr(goal.target_amount_inr)}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-1 pt-1 border-t border-slate-200 dark:border-slate-800">
                            {goal.monthly_saving_needed_inr > 0 && (
                              <div>
                                Needed/month:{' '}
                                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                                  {formatInr(goal.monthly_saving_needed_inr)}
                                </span>
                                {goal.estimated_months_to_goal > 0 &&
                                  ` (~${goal.estimated_months_to_goal} mo)`}
                              </div>
                            )}
                            <p>{goal.status_note}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* SECTION E: Gold+ Financial Health Score + Conversational AI Advisor */}
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                E. Financial Health Score &amp; Conversational AI Advisor
              </h3>
              <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                Gold &amp; Diamond VIP Benefit
              </span>
            </div>

            {!canUseHealthScore ? (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                    <Crown className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      Unlock Financial Health Score &amp; Conversational AI Advisor (CLASS 4 · Gold VIP)
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl">
                      Upgrade to Gold VIP (₹59/mo) for your weighted Financial Health Score, 50 monthly AI Financial Advisor messages, and 30 AI Insights runs per month.
                    </p>
                  </div>
                </div>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('vip')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap shrink-0"
                  >
                    <Crown className="w-3.5 h-3.5" />
                    Upgrade to Gold VIP
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Financial Health Score Card */}
                {aiResult?.health_score && (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                          Financial Health Score
                        </div>
                        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-2xl">
                          {aiResult.health_score.summary}
                        </p>
                      </div>
                      <div className="flex items-baseline gap-2 shrink-0">
                        <span className="text-3xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                          {aiResult.health_score.score}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">/ 100</span>
                        <span className="ml-2 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                          {aiResult.health_score.grade}
                        </span>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                      {[
                        { label: 'Savings Rate', value: aiResult.health_score.savings_rate_score },
                        {
                          label: 'Budget Discipline',
                          value: aiResult.health_score.budget_discipline_score,
                        },
                        {
                          label: 'Expense Stability',
                          value: aiResult.health_score.expense_stability_score,
                        },
                        {
                          label: 'Debt & Commitments',
                          value: aiResult.health_score.debt_commitment_score,
                        },
                      ].map((metric) => {
                        const clamped = Math.max(0, Math.min(100, Math.round(metric.value)));
                        return (
                          <div
                            key={metric.label}
                            className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-slate-600 dark:text-slate-400">
                                {metric.label}
                              </span>
                              <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                                {clamped}%
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-emerald-600"
                                style={{ width: `${clamped}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {aiResult.health_score.recommendations.length > 0 && (
                      <div className="space-y-1.5 text-xs">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          Score Improvement Actions
                        </div>
                        <ul className="grid sm:grid-cols-2 gap-2 text-slate-600 dark:text-slate-300">
                          {aiResult.health_score.recommendations.map((rec, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Conversational AI Financial Advisor Window */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">
                        Try asking:
                      </span>
                      {STARTER_QUESTIONS.map((q) => (
                        <button
                          key={q}
                          type="button"
                          disabled={chatLoading}
                          onClick={() => void handleSendChat(q)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-200 hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-400 disabled:opacity-50 transition-colors text-left"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                    {chatMessages.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setChatMessages([]);
                          setChatError('');
                        }}
                        className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
                      >
                        Clear conversation
                      </button>
                    )}
                  </div>

                  <div
                    ref={chatScrollRef}
                    className="p-4 sm:p-5 space-y-4 max-h-96 min-h-[220px] overflow-y-auto"
                  >
                    {chatMessages.length === 0 ? (
                      <div className="py-8 text-center space-y-2">
                        <Bot className="w-7 h-7 text-emerald-600 dark:text-emerald-400 mx-auto" />
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                          Conversational AI Financial Advisor ({aiUsageSummary.advisorUsed} /{' '}
                          {aiUsageSummary.advisorLimit} messages used)
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                          Ask questions grounded in your real FinTrack ledger in INR (₹) without fabricating missing figures.
                        </p>
                      </div>
                    ) : (
                      chatMessages.map((msg) => {
                        const isUser = msg.role === 'user';
                        return (
                          <div
                            key={msg.id}
                            className={`flex items-start gap-3 ${
                              isUser ? 'justify-end' : 'justify-start'
                            }`}
                          >
                            {!isUser && (
                              <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0 mt-0.5">
                                <Bot className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              </div>
                            )}
                            <div
                              className={`max-w-[85%] sm:max-w-[75%] rounded-xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed space-y-1 ${
                                isUser
                                  ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                              }`}
                            >
                              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                              <div
                                className={`text-[10px] ${
                                  isUser ? 'text-slate-300 dark:text-emerald-100' : 'text-slate-400'
                                }`}
                              >
                                {msg.timestamp}
                              </div>
                            </div>
                            {isUser && (
                              <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
                                <UserIcon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}

                    {chatLoading && (
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center shrink-0">
                          <Bot className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="rounded-xl px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                          Analyzing your ledger...
                        </div>
                      </div>
                    )}
                  </div>

                  {chatError && (
                    <div className="px-4 py-2 bg-red-50 dark:bg-red-950/30 border-t border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{chatError}</span>
                      </div>
                      {onNavigate && vipTier !== 'diamond' && (
                        <button
                          type="button"
                          onClick={() => onNavigate('vip')}
                          className="font-semibold underline whitespace-nowrap"
                        >
                          Upgrade Quota
                        </button>
                      )}
                    </div>
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSendChat();
                    }}
                    className="p-3 sm:p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2.5 bg-white dark:bg-slate-900"
                  >
                    <input
                      type="text"
                      value={chatInput}
                      maxLength={600}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask about your spending, savings, categories, or monthly comparisons..."
                      disabled={chatLoading}
                      className="flex-1 min-w-0 px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                    <button
                      type="submit"
                      disabled={chatLoading || !chatInput.trim()}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs sm:text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Ask</span>
                    </button>
                  </form>
                </div>
              </div>
            )}
          </section>

          {/* SECTION F: Diamond VIP Advanced AI Forecasting, Planning & Priority Support */}
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  F. Advanced AI Financial Forecasting &amp; Personalized Planning
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                  CLASS 5 · Diamond VIP Benefit
                </span>
                {canUseForecast && (
                  <button
                    type="button"
                    disabled={loadingForecast || !hasTransactions}
                    onClick={() => void handleRefreshDiamondForecast()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                  >
                    {loadingForecast ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>{loadingForecast ? 'Forecasting...' : 'Refresh Forecast'}</span>
                  </button>
                )}
              </div>
            </div>

            {!canUseForecast ? (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      Upgrade to CLASS 5 Diamond VIP for Predictive AI Forecasting &amp; Planning
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl">
                      Unlock 3-month AI cash-flow forecasting, category-level future expense predictions, phased personalized financial planning, emergency runway health analysis, 100 Insights + 200 Advisor messages/mo, and Priority Customer Support (₹69/mo).
                    </p>
                  </div>
                </div>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('vip')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap shrink-0"
                  >
                    <Crown className="w-3.5 h-3.5" />
                    Upgrade to Diamond VIP
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {forecastError && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{forecastError}</span>
                  </div>
                )}

                {loadingForecast && !diamondForecastState ? (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 flex items-center justify-center gap-2 text-xs text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                    Computing multi-month cash flow forecast and financial plan...
                  </div>
                ) : diamondForecastState ? (
                  <div className="space-y-5">
                    {/* Executive Forecast Summary + Chart */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                            {diamondForecastState.forecast_horizon_label}
                          </h4>
                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                            {diamondForecastState.executive_summary}
                          </p>
                        </div>
                      </div>

                      {diamondForecastState.monthly_projections.length > 0 && (
                        <div className="h-64 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={diamondForecastState.monthly_projections}
                              margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                              <XAxis
                                dataKey="month_label"
                                tick={{ fontSize: 11, fill: '#64748b' }}
                                axisLine={false}
                                tickLine={false}
                              />
                              <YAxis
                                tick={{ fontSize: 11, fill: '#64748b' }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(v) => `₹${Math.round(Number(v) / 1000)}k`}
                              />
                              <Tooltip
                                formatter={(value: unknown) => formatInr(Number(value) || 0)}
                                contentStyle={{
                                  backgroundColor: '#0f172a',
                                  border: '1px solid #1e293b',
                                  borderRadius: '8px',
                                  color: '#f8fafc',
                                  fontSize: '12px',
                                }}
                              />
                              <Legend wrapperStyle={{ fontSize: '12px' }} />
                              <Bar
                                dataKey="projected_income_inr"
                                name="Projected Income"
                                fill="#16A34A"
                                radius={[4, 4, 0, 0]}
                              />
                              <Bar
                                dataKey="projected_expenses_inr"
                                name="Projected Expenses"
                                fill="#2563EB"
                                radius={[4, 4, 0, 0]}
                              />
                              <Bar
                                dataKey="projected_savings_inr"
                                name="Projected Savings"
                                fill="#F59E0B"
                                radius={[4, 4, 0, 0]}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    {/* Future Expense Predictions + Personalized Financial Plan */}
                    <div className="grid lg:grid-cols-2 gap-5">
                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                          Future Expense Predictions (Next Month)
                        </h4>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                          {diamondForecastState.future_expense_predictions.map((pred, idx) => (
                            <div key={`${pred.category}-${idx}`} className="py-3 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-900 dark:text-white">
                                  {pred.category}
                                </span>
                                <div className="flex items-center gap-2 font-mono tabular-nums">
                                  <span className="text-slate-500">
                                    {formatInr(pred.current_monthly_inr)}
                                  </span>
                                  <span className="text-slate-400">&rarr;</span>
                                  <span className="font-bold text-slate-900 dark:text-white">
                                    {formatInr(pred.predicted_next_month_inr)}
                                  </span>
                                  <span
                                    className={`font-semibold ${
                                      pred.expected_change_pct > 5
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : 'text-emerald-600 dark:text-emerald-400'
                                    }`}
                                  >
                                    {pred.expected_change_pct >= 0 ? '+' : ''}
                                    {pred.expected_change_pct.toFixed(1)}%
                                  </span>
                                </div>
                              </div>
                              <p className="text-slate-600 dark:text-slate-400">
                                {pred.driver_note}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                          Personalized Financial Plan
                        </h4>
                        <div className="space-y-3">
                          {diamondForecastState.personalized_financial_plan.map((step, idx) => (
                            <div
                              key={`${step.phase}-${idx}`}
                              className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                                  {step.phase}
                                </span>
                                {step.target_amount_inr > 0 && (
                                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                                    Target: {formatInr(step.target_amount_inr)}
                                  </span>
                                )}
                              </div>
                              <div className="font-semibold text-slate-900 dark:text-white">
                                {step.action_title}
                              </div>
                              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                                {step.rationale}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Advanced Financial Health Analysis & Priority Support */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                        <div>
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                            Advanced Financial Health &amp; Resilience Analysis
                          </h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Resilience Rating:{' '}
                            <strong className="text-slate-900 dark:text-white">
                              {diamondForecastState.advanced_health_analysis.resilience_rating}
                            </strong>
                          </p>
                        </div>
                        <div className="font-mono tabular-nums text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-lg">
                          Est. Runway:{' '}
                          <strong className="text-emerald-600 dark:text-emerald-400">
                            {diamondForecastState.advanced_health_analysis.emergency_runway_months.toFixed(
                              1
                            )}{' '}
                            months
                          </strong>
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4 text-xs">
                        <div className="space-y-2">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            Structural Risk Factors
                          </div>
                          <ul className="space-y-1.5 text-slate-600 dark:text-slate-300">
                            {diamondForecastState.advanced_health_analysis.risk_factors.map(
                              (rf, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                                  <span>{rf}</span>
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                        <div className="space-y-2">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            Optimization Levers
                          </div>
                          <ul className="space-y-1.5 text-slate-600 dark:text-slate-300">
                            {diamondForecastState.advanced_health_analysis.optimization_levers.map(
                              (lev, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                                  <span>{lev}</span>
                                </li>
                              )
                            )}
                          </ul>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                          <Headphones className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span>
                            Diamond VIP Priority Support Desk — Direct assistance at{' '}
                            <span className="font-mono font-semibold">{SUPPORT_EMAIL}</span>
                          </span>
                        </div>
                        <a
                          href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                            '[Diamond VIP Priority Support] FinTrack Financial Planning'
                          )}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap self-start sm:self-auto"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          Contact Priority Support
                        </a>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                    <span className="text-slate-600 dark:text-slate-300">
                      Click &ldquo;Refresh Forecast&rdquo; above to generate your 3-month cash flow projection and personalized financial plan.
                    </span>
                    <button
                      type="button"
                      disabled={loadingForecast || !hasTransactions}
                      onClick={() => void handleRefreshDiamondForecast()}
                      className="px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white font-semibold hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                    >
                      Generate Forecast
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
