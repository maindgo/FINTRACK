import { auth } from '../firebase';
import {
  AIChatMessage,
  AiUsageSummary,
  BillRecord,
  BudgetRecord,
  BillingCycle,
  GeminiAIInsightsResult,
  RecurringTransaction,
  SanitizedFinancialSnapshot,
  SavingsGoal,
  SecurityEventRecord,
  SubscriptionStatus,
  TransactionRecord,
  VipTier,
  VoiceParsedTransaction,
} from '../types/finance';
import { buildMonthlySeries } from '../utils/analytics';
import { VIP_UPI_ID } from '../utils/constants';
import {
  formatMonthLabel,
  getCurrentMonthStr,
  getPreviousMonthStr,
  getTodayStr,
} from '../utils/formatters';

export class AIInsightsApiError extends Error {
  status: number;
  code: string;
  retryAfterSeconds?: number;
  currentTier?: VipTier;
  requiredTier?: VipTier;
  usage?: AiUsageSummary;

  constructor(
    message: string,
    status: number,
    code: string,
    retryAfterSeconds?: number,
    extra?: {
      currentTier?: VipTier;
      requiredTier?: VipTier;
      usage?: AiUsageSummary;
    }
  ) {
    super(message);
    this.name = 'AIInsightsApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.currentTier = extra?.currentTier;
    this.requiredTier = extra?.requiredTier;
    this.usage = extra?.usage;
  }
}

export interface SnapshotInput {
  transactions: TransactionRecord[];
  budgets: BudgetRecord[];
  bills: BillRecord[];
  savingsGoals: SavingsGoal[];
  recurringTransactions: RecurringTransaction[];
  monthlyBudgetLimit: number;
}

export function buildSanitizedFinancialSnapshot({
  transactions,
  budgets,
  bills,
  savingsGoals,
  recurringTransactions,
  monthlyBudgetLimit,
}: SnapshotInput): SanitizedFinancialSnapshot {
  const currentMonth = getCurrentMonthStr();
  const prevMonth = getPreviousMonthStr(currentMonth);
  const today = getTodayStr();

  const currentMonthTx = transactions.filter((t) => t.date.startsWith(currentMonth));
  const prevMonthTx = transactions.filter((t) => t.date.startsWith(prevMonth));

  const income = currentMonthTx
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const currentExpensesList = currentMonthTx.filter((t) => t.type === 'expense');
  const expenses = currentExpensesList.reduce((sum, t) => sum + t.amount, 0);
  const savings = income - expenses;
  const savingsRatePct =
    income > 0 ? Number((((income - expenses) / income) * 100).toFixed(2)) : null;

  const prevIncome = prevMonthTx
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const prevExpensesList = prevMonthTx.filter((t) => t.type === 'expense');
  const prevExpenses = prevExpensesList.reduce((sum, t) => sum + t.amount, 0);
  const prevSavings = prevIncome - prevExpenses;

  const incomeGrowthPct =
    prevIncome > 0 ? Number((((income - prevIncome) / prevIncome) * 100).toFixed(2)) : null;
  const expenseGrowthPct =
    prevExpenses > 0 ? Number((((expenses - prevExpenses) / prevExpenses) * 100).toFixed(2)) : null;

  // Aggregate expense categories across current month, previous month, and all-time
  const categoryMap = new Map<
    string,
    { currentMonth: number; previousMonth: number; allTimeTotal: number; txCount: number }
  >();

  const allExpenses = transactions.filter((t) => t.type === 'expense');
  for (const tx of allExpenses) {
    const entry = categoryMap.get(tx.category) || {
      currentMonth: 0,
      previousMonth: 0,
      allTimeTotal: 0,
      txCount: 0,
    };
    entry.allTimeTotal += tx.amount;
    entry.txCount += 1;
    if (tx.date.startsWith(currentMonth)) {
      entry.currentMonth += tx.amount;
    } else if (tx.date.startsWith(prevMonth)) {
      entry.previousMonth += tx.amount;
    }
    categoryMap.set(tx.category, entry);
  }

  const shareBase = expenses > 0 ? expenses : allExpenses.reduce((s, t) => s + t.amount, 0);

  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([category, vals]) => {
      const shareNumerator = expenses > 0 ? vals.currentMonth : vals.allTimeTotal;
      const sharePct = shareBase > 0 ? Number(((shareNumerator / shareBase) * 100).toFixed(2)) : 0;
      const changePct =
        vals.previousMonth > 0
          ? Number((((vals.currentMonth - vals.previousMonth) / vals.previousMonth) * 100).toFixed(2))
          : null;
      return {
        category,
        currentMonth: Number(vals.currentMonth.toFixed(2)),
        previousMonth: Number(vals.previousMonth.toFixed(2)),
        allTimeTotal: Number(vals.allTimeTotal.toFixed(2)),
        sharePct,
        changePct,
        txCount: vals.txCount,
      };
    })
    .sort((a, b) =>
      expenses > 0 ? b.currentMonth - a.currentMonth : b.allTimeTotal - a.allTimeTotal
    )
    .slice(0, 20);

  // 6-month cash flow series
  const monthlyTrend = buildMonthlySeries(transactions, 6).map((pt) => ({
    monthLabel: pt.label,
    income: Number(pt.income.toFixed(2)),
    expenses: Number(pt.expenses.toFixed(2)),
    savings: Number(pt.profit.toFixed(2)),
  }));

  // Detect unusually high expenses without sending descriptions/notes/PII
  const avgExpense =
    allExpenses.length > 0
      ? allExpenses.reduce((s, t) => s + t.amount, 0) / allExpenses.length
      : 0;
  const unusualSource = currentExpensesList.length > 0 ? currentExpensesList : allExpenses;
  const unusualTransactions =
    allExpenses.length >= 3 && avgExpense > 0
      ? unusualSource
          .filter((t) => t.amount >= avgExpense * 2)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 10)
          .map((t) => ({
            category: t.category,
            amount: Number(t.amount.toFixed(2)),
            date: t.date,
            multipleOfAverage: Number((t.amount / avgExpense).toFixed(2)),
          }))
      : [];

  // Current month budgets
  const currentBudgets = budgets
    .filter((b) => b.month === currentMonth)
    .slice(0, 20)
    .map((b) => {
      const catEntry = categoryMap.get(b.category);
      const spentAmount =
        b.category === 'Monthly Overall' ? expenses : catEntry ? catEntry.currentMonth : 0;
      const utilizationPct =
        b.limitAmount > 0 ? Number(((spentAmount / b.limitAmount) * 100).toFixed(2)) : 0;
      return {
        category: b.category,
        limitAmount: Number(b.limitAmount.toFixed(2)),
        spentAmount: Number(spentAmount.toFixed(2)),
        utilizationPct,
        alertThreshold: Number(b.alertThreshold.toFixed(2)),
      };
    });

  // Savings goals (strip userId & free-text notes)
  const sanitizedGoals = savingsGoals.slice(0, 15).map((g, idx) => ({
    label: g.name.trim() || `Savings Goal ${idx + 1}`,
    category: g.category || 'General Savings',
    targetAmount: Number(g.targetAmount.toFixed(2)),
    savedAmount: Number(g.savedAmount.toFixed(2)),
    remainingAmount: Number(Math.max(0, g.targetAmount - g.savedAmount).toFixed(2)),
    targetDate: g.targetDate || '',
    status: g.status,
  }));

  // Monthly commitments (recurring expenses + active bills/EMIs)
  const monthlyBillsAndEmis = bills
    .filter((b) => b.frequency === 'monthly' || (b.status !== 'paid' && b.dueDate.startsWith(currentMonth)))
    .reduce((sum, b) => sum + b.amount, 0);

  const activeRecurringExpenseMonthly = recurringTransactions
    .filter((r) => r.isActive && r.type === 'expense')
    .reduce((sum, r) => {
      if (r.frequency === 'daily') return sum + r.amount * 30;
      if (r.frequency === 'weekly') return sum + r.amount * 4.33;
      if (r.frequency === 'monthly') return sum + r.amount;
      if (r.frequency === 'yearly') return sum + r.amount / 12;
      return sum;
    }, 0);

  const overdueBillsCount = bills.filter(
    (b) => b.status !== 'paid' && (b.status === 'overdue' || b.dueDate < today)
  ).length;

  return {
    currencyLabel: 'INR (₹)',
    currentMonthLabel: formatMonthLabel(currentMonth),
    previousMonthLabel: formatMonthLabel(prevMonth),
    transactionCount: transactions.length,
    currentMonthTransactionCount: currentMonthTx.length,
    previousMonthTransactionCount: prevMonthTx.length,
    monthlySummary: {
      income: Number(income.toFixed(2)),
      expenses: Number(expenses.toFixed(2)),
      savings: Number(savings.toFixed(2)),
      savingsRatePct,
      prevIncome: Number(prevIncome.toFixed(2)),
      prevExpenses: Number(prevExpenses.toFixed(2)),
      prevSavings: Number(prevSavings.toFixed(2)),
      incomeGrowthPct,
      expenseGrowthPct,
      monthlyBudgetLimit: Number(monthlyBudgetLimit.toFixed(2)),
    },
    categoryBreakdown,
    monthlyTrend,
    unusualTransactions,
    budgets: currentBudgets,
    savingsGoals: sanitizedGoals,
    commitments: {
      monthlyBillsAndEmis: Number(monthlyBillsAndEmis.toFixed(2)),
      activeRecurringExpenseMonthly: Number(activeRecurringExpenseMonthly.toFixed(2)),
      overdueBillsCount,
    },
  };
}

async function parseErrorResponse(res: Response): Promise<AIInsightsApiError> {
  let message = `Request failed with status ${res.status}.`;
  let code = 'AI_REQUEST_FAILED';
  let retryAfterSeconds: number | undefined;
  let currentTier: VipTier | undefined;
  let requiredTier: VipTier | undefined;
  let usage: AiUsageSummary | undefined;

  try {
    const data = (await res.json()) as {
      error?: string;
      code?: string;
      retryAfterSeconds?: number;
      currentTier?: VipTier;
      requiredTier?: VipTier;
      usage?: AiUsageSummary;
    };
    if (data.error) message = data.error;
    if (data.code) code = data.code;
    if (typeof data.retryAfterSeconds === 'number') {
      retryAfterSeconds = data.retryAfterSeconds;
    }
    if (data.currentTier) currentTier = data.currentTier;
    if (data.requiredTier) requiredTier = data.requiredTier;
    if (data.usage) usage = data.usage;
  } catch {
    // Keep fallback error message
  }

  return new AIInsightsApiError(message, res.status, code, retryAfterSeconds, {
    currentTier,
    requiredTier,
    usage,
  });
}

async function getAuthHeaders(includeJsonContentType = true): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  const user = auth.currentUser;
  if (user) {
    try {
      const token = await user.getIdToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Backend will cleanly reject missing/expired token with 401
    }
  }
  return headers;
}

export async function checkAIHealth(): Promise<{ ok: boolean; geminiConfigured: boolean }> {
  const res = await fetch('/api/health', { method: 'GET' });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as { ok: boolean; geminiConfigured: boolean };
}

export async function fetchAIInsights(
  snapshot: SanitizedFinancialSnapshot
): Promise<{
  model: string;
  generatedAt: string;
  tier?: VipTier;
  usage?: AiUsageSummary;
  insights: GeminiAIInsightsResult;
}> {
  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/ai/insights', {
    method: 'POST',
    headers,
    body: JSON.stringify({ snapshot }),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return (await res.json()) as {
    model: string;
    generatedAt: string;
    tier?: VipTier;
    usage?: AiUsageSummary;
    insights: GeminiAIInsightsResult;
  };
}

export async function sendAIChatMessage(params: {
  question: string;
  history: Pick<AIChatMessage, 'role' | 'content'>[];
  snapshot: SanitizedFinancialSnapshot;
}): Promise<{
  model: string;
  answer: string;
  answeredAt: string;
  tier?: VipTier;
  usage?: AiUsageSummary;
}> {
  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return (await res.json()) as {
    model: string;
    answer: string;
    answeredAt: string;
    tier?: VipTier;
    usage?: AiUsageSummary;
  };
}

export async function fetchDiamondForecast(
  snapshot: SanitizedFinancialSnapshot
): Promise<{
  model: string;
  generatedAt: string;
  tier?: VipTier;
  usage?: AiUsageSummary;
  diamond_forecast: NonNullable<GeminiAIInsightsResult['diamond_forecast']>;
}> {
  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/ai/forecast', {
    method: 'POST',
    headers,
    body: JSON.stringify({ snapshot }),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return (await res.json()) as {
    model: string;
    generatedAt: string;
    tier?: VipTier;
    usage?: AiUsageSummary;
    diamond_forecast: NonNullable<GeminiAIInsightsResult['diamond_forecast']>;
  };
}

export async function parseVoiceTransaction(params: {
  audioBase64?: string;
  mimeType?: string;
  transcriptText?: string;
  languageHint?: string;
  languageLabel?: string;
  localDate: string;
  localTime: string;
}): Promise<{ model: string; transaction: VoiceParsedTransaction }> {
  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/ai/voice-transaction', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  return (await res.json()) as {
    model: string;
    transaction: VoiceParsedTransaction;
  };
}

export function parseVoicePhraseLocally(
  transcript: string,
  localDate: string,
  localTime: string
): VoiceParsedTransaction {
  const cleaned = transcript.trim();
  const lower = cleaned.toLowerCase();
  const kMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*k\b/i);
  const numMatch = lower.replace(/,/g, '').match(/\b(\d+(?:\.\d{1,2})?)\b/);
  const amount = kMatch
    ? Number((Number(kMatch[1]) * 1000).toFixed(2))
    : numMatch
    ? Number(Number(numMatch[1]).toFixed(2))
    : 0;

  const isIncome =
    /\b(received|receive|earned|earn|salary|tankhwa|income|refund|credited|credit|bonus|freelance|mila|mili|aaya|aayi)\b/i.test(
      lower
    );
  const type = isIncome ? 'income' : 'expense';
  let paymentMethod: VoiceParsedTransaction['paymentMethod'] = 'UPI';
  if (/\b(cash|nakad|nagad)\b/i.test(lower)) paymentMethod = 'Cash';
  else if (/\b(bank|neft|imps|rtgs|transfer)\b/i.test(lower)) paymentMethod = 'Bank Transfer';
  else if (/\b(credit\s*card)\b/i.test(lower)) paymentMethod = 'Credit Card';
  else if (/\b(debit\s*card)\b/i.test(lower)) paymentMethod = 'Debit Card';

  let category: VoiceParsedTransaction['category'] =
    type === 'income' ? 'Other Income' : 'Other Expenses';
  if (type === 'income') {
    if (/\b(salary|tankhwa)\b/i.test(lower)) category = 'Salary';
    else if (/\b(freelanc)\b/i.test(lower)) category = 'Freelancing';
    else if (/\b(business)\b/i.test(lower)) category = 'Business Income';
  } else {
    if (/\b(food|lunch|dinner|breakfast|chai|tea|coffee|snack|khana|grocery|groceries)\b/i.test(lower)) {
      category = 'Food';
    } else if (/\b(auto|cab|uber|ola|metro|bus|petrol|fuel|transport)\b/i.test(lower)) {
      category = 'Transport';
    } else if (/\b(rent|kiraya)\b/i.test(lower)) {
      category = 'Rent';
    } else if (/\b(electric|bijli)\b/i.test(lower)) {
      category = 'Electricity';
    } else if (/\b(internet|wifi|recharge)\b/i.test(lower)) {
      category = 'Internet';
    } else if (/\b(doctor|medicine|medical|health)\b/i.test(lower)) {
      category = 'Healthcare';
    } else if (/\b(shop|shopping|amazon|flipkart)\b/i.test(lower)) {
      category = 'Shopping';
    }
  }

  return {
    transcript: cleaned,
    type,
    amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
    title: type === 'income' ? `${category} Received` : `${category} Expense`,
    category,
    paymentMethod,
    date: localDate,
    time: localTime,
    description: cleaned.slice(0, 200),
    missingAmountReason:
      amount > 0 ? '' : 'No monetary amount was detected. Please enter the amount below.',
  };
}

export interface BackendSecuritySnapshot {
  uid: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
  accountStatus: 'active' | 'deactivated';
  restrictionStatus: 'active' | 'under_investigation' | 'temp_banned' | 'perm_banned';
  banType: 'none' | 'temporary' | 'permanent';
  banReason: string;
  banDurationLabel: string;
  banExpiresAtIso: string | null;
  aiRestrictedUntilIso: string | null;
  messagingRestrictedUntilIso: string | null;
  vipStatus: 'none' | 'vip';
  vipTier: VipTier;
  billingCycle: BillingCycle;
  subscriptionStatus: SubscriptionStatus;
  subscriptionEndIso: string | null;
  aiUsage?: AiUsageSummary;
  warningCount: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export async function fetchBackendSecurityStatus(): Promise<BackendSecuritySnapshot | null> {
  if (!auth.currentUser) return null;
  const headers = await getAuthHeaders(false);
  const res = await fetch('/api/security/status', { method: 'GET', headers });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  const data = (await res.json()) as { security?: BackendSecuritySnapshot };
  return data.security || null;
}

export async function reportAuthSecurityEvent(params: {
  eventType: 'failed_login' | 'signup_created' | 'unauthorized_account_access';
  email?: string;
  userId?: string;
  errorCode?: string;
}): Promise<void> {
  try {
    await fetch('/api/security/auth-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    // Telemetry reporting must never break login/signup UX
  }
}

export async function verifyBackendVipEntitlement(claimedVip = false): Promise<{
  vipStatus: 'none' | 'vip';
  vipTier: VipTier;
  billingCycle: BillingCycle;
  subscriptionStatus: SubscriptionStatus;
  subscriptionEndIso: string | null;
  aiUsage?: AiUsageSummary;
  isVipActive: boolean;
  restrictionStatus: string;
  isAdmin: boolean;
}> {
  const headers = await getAuthHeaders(false);
  const res = await fetch(
    `/api/security/vip-check?claimedVip=${claimedVip ? 'true' : 'false'}`,
    { method: 'GET', headers }
  );
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as {
    vipStatus: 'none' | 'vip';
    vipTier: VipTier;
    billingCycle: BillingCycle;
    subscriptionStatus: SubscriptionStatus;
    subscriptionEndIso: string | null;
    aiUsage?: AiUsageSummary;
    isVipActive: boolean;
    restrictionStatus: string;
    isAdmin: boolean;
  };
}

export interface BackendVipStatusResponse {
  ok: boolean;
  tier: VipTier;
  billingCycle: BillingCycle;
  subscriptionStatus: SubscriptionStatus;
  subscriptionEndIso: string | null;
  aiUsage: AiUsageSummary;
  verifiedAt: string;
}

export async function fetchVipStatus(): Promise<BackendVipStatusResponse> {
  const headers = await getAuthHeaders(false);
  const res = await fetch('/api/vip/status', { method: 'GET', headers });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as BackendVipStatusResponse;
}

export function buildUpiPaymentUri(params: {
  amountInr: number;
  tierName: string;
  billingCycle: BillingCycle;
  paymentReference: string;
}): string {
  const note = `FinTrack ${params.tierName} ${params.billingCycle}`;
  const query = [
    `pa=${encodeURIComponent(VIP_UPI_ID)}`,
    `pn=${encodeURIComponent('FinTrack')}`,
    `am=${encodeURIComponent(String(params.amountInr))}`,
    `cu=INR`,
    `tr=${encodeURIComponent(params.paymentReference)}`,
    `tn=${encodeURIComponent(note)}`,
  ].join('&');
  return `upi://pay?${query}`;
}

export function generateVipPaymentReference(): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `FTPAY-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

export async function subscribeVipPlan(params: {
  tier: VipTier;
  billingCycle: BillingCycle;
  submittedPriceInr: number;
  paymentReference: string;
  utrReference: string;
  withoutUtr?: boolean;
  screenshotName?: string;
  screenshotDataUrl?: string;
  paymentMethodLabel?: string;
  displayName?: string;
}): Promise<{
  ok: boolean;
  pendingApproval: boolean;
  status: 'pending';
  requestId: string;
  tier: VipTier;
  billingCycle: BillingCycle;
  amountInr: number;
  upiId: string;
  upiDeepLink: string;
  paymentReference: string;
  utrReference: string;
  withoutUtr?: boolean;
  submittedAtIso: string;
}> {
  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/vip/subscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as {
    ok: boolean;
    pendingApproval: boolean;
    status: 'pending';
    requestId: string;
    tier: VipTier;
    billingCycle: BillingCycle;
    amountInr: number;
    upiId: string;
    upiDeepLink: string;
    paymentReference: string;
    utrReference: string;
    withoutUtr?: boolean;
    submittedAtIso: string;
  };
}

export async function cancelVipSubscription(): Promise<{
  ok: boolean;
  status: SubscriptionStatus;
  autoRenew: boolean;
  tier: VipTier;
  periodEndIso: string;
}> {
  const headers = await getAuthHeaders(true);
  const res = await fetch('/api/vip/cancel', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return (await res.json()) as {
    ok: boolean;
    status: SubscriptionStatus;
    autoRenew: boolean;
    tier: VipTier;
    periodEndIso: string;
  };
}

export async function fetchAdminSecurityTelemetry(): Promise<SecurityEventRecord[]> {
  const headers = await getAuthHeaders(false);
  const res = await fetch('/api/admin/security-telemetry', { method: 'GET', headers });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  const data = (await res.json()) as { events?: SecurityEventRecord[] };
  return Array.isArray(data.events) ? data.events : [];
}
