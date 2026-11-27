import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_MODEL = 'gemini-4-hydrogen';
const PORT = Number(process.env.PORT) || 3000;

interface RateLimitEntry {
  timestamps: number[];
}

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_MAX_REQUESTS = 15;
const rateLimitStore = new Map<string, RateLimitEntry>();

function getClientKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : req.ip || 'unknown';
  return `ip:${ip}`;
}

function aiRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const key = getClientKey(req);
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (entry.timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldest = entry.timestamps[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: `Too many AI requests. Please wait ${retryAfterSeconds} seconds before trying again.`,
      code: 'RATE_LIMITED',
      retryAfterSeconds,
    });
    return;
  }

  entry.timestamps.push(now);
  rateLimitStore.set(key, entry);

  // Prevent unbounded memory growth on long-running servers
  if (rateLimitStore.size > 1000) {
    for (const [storedKey, storedVal] of rateLimitStore.entries()) {
      const fresh = storedVal.timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
      if (fresh.length === 0) {
        rateLimitStore.delete(storedKey);
      }
    }
  }

  next();
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sanitizeText(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function toSafeNumber(val: unknown, min = 0, max = 1_000_000_000): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.min(max, Math.max(min, Number(num.toFixed(2))));
}

function toSafeNullableNumber(val: unknown, min = -10_000, max = 100_000): number | null {
  if (val === null || val === undefined) return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  return Math.min(max, Math.max(min, Number(num.toFixed(2))));
}

interface SanitizedFinancialSnapshot {
  currencyLabel: string;
  currentMonthLabel: string;
  previousMonthLabel: string;
  transactionCount: number;
  currentMonthTransactionCount: number;
  previousMonthTransactionCount: number;
  monthlySummary: {
    income: number;
    expenses: number;
    savings: number;
    savingsRatePct: number | null;
    prevIncome: number;
    prevExpenses: number;
    prevSavings: number;
    incomeGrowthPct: number | null;
    expenseGrowthPct: number | null;
    monthlyBudgetLimit: number;
  };
  categoryBreakdown: {
    category: string;
    currentMonth: number;
    previousMonth: number;
    allTimeTotal: number;
    sharePct: number;
    changePct: number | null;
    txCount: number;
  }[];
  monthlyTrend: {
    monthLabel: string;
    income: number;
    expenses: number;
    savings: number;
  }[];
  unusualTransactions: {
    category: string;
    amount: number;
    date: string;
    multipleOfAverage: number;
  }[];
  budgets: {
    category: string;
    limitAmount: number;
    spentAmount: number;
    utilizationPct: number;
    alertThreshold: number;
  }[];
  savingsGoals: {
    label: string;
    category: string;
    targetAmount: number;
    savedAmount: number;
    remainingAmount: number;
    targetDate: string;
    status: string;
  }[];
  commitments: {
    monthlyBillsAndEmis: number;
    activeRecurringExpenseMonthly: number;
    overdueBillsCount: number;
  };
}

function sanitizeFinancialSnapshot(raw: unknown): SanitizedFinancialSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const summaryRaw =
    obj.monthlySummary && typeof obj.monthlySummary === 'object'
      ? (obj.monthlySummary as Record<string, unknown>)
      : {};
  const commitmentsRaw =
    obj.commitments && typeof obj.commitments === 'object'
      ? (obj.commitments as Record<string, unknown>)
      : {};

  const categoryBreakdown = Array.isArray(obj.categoryBreakdown)
    ? obj.categoryBreakdown.slice(0, 20).map((item) => {
        const c = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          category: sanitizeText(c.category, 60) || 'Other',
          currentMonth: toSafeNumber(c.currentMonth),
          previousMonth: toSafeNumber(c.previousMonth),
          allTimeTotal: toSafeNumber(c.allTimeTotal),
          sharePct: toSafeNumber(c.sharePct, 0, 100),
          changePct: toSafeNullableNumber(c.changePct),
          txCount: Math.round(toSafeNumber(c.txCount, 0, 100_000)),
        };
      })
    : [];

  const monthlyTrend = Array.isArray(obj.monthlyTrend)
    ? obj.monthlyTrend.slice(0, 12).map((item) => {
        const m = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          monthLabel: sanitizeText(m.monthLabel, 24) || 'Month',
          income: toSafeNumber(m.income),
          expenses: toSafeNumber(m.expenses),
          savings: toSafeNumber(m.savings, -1_000_000_000, 1_000_000_000),
        };
      })
    : [];

  const unusualTransactions = Array.isArray(obj.unusualTransactions)
    ? obj.unusualTransactions.slice(0, 10).map((item) => {
        const u = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          category: sanitizeText(u.category, 60) || 'Other',
          amount: toSafeNumber(u.amount),
          date: sanitizeText(u.date, 12),
          multipleOfAverage: toSafeNumber(u.multipleOfAverage, 0, 1000),
        };
      })
    : [];

  const budgets = Array.isArray(obj.budgets)
    ? obj.budgets.slice(0, 20).map((item) => {
        const b = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          category: sanitizeText(b.category, 60) || 'Category',
          limitAmount: toSafeNumber(b.limitAmount),
          spentAmount: toSafeNumber(b.spentAmount),
          utilizationPct: toSafeNumber(b.utilizationPct, 0, 10_000),
          alertThreshold: toSafeNumber(b.alertThreshold, 0, 100),
        };
      })
    : [];

  const savingsGoals = Array.isArray(obj.savingsGoals)
    ? obj.savingsGoals.slice(0, 15).map((item, idx) => {
        const g = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          label: sanitizeText(g.label, 80) || `Goal ${idx + 1}`,
          category: sanitizeText(g.category, 60) || 'General Savings',
          targetAmount: toSafeNumber(g.targetAmount),
          savedAmount: toSafeNumber(g.savedAmount),
          remainingAmount: toSafeNumber(g.remainingAmount),
          targetDate: sanitizeText(g.targetDate, 12),
          status: sanitizeText(g.status, 20) || 'active',
        };
      })
    : [];

  return {
    currencyLabel: 'INR (₹)',
    currentMonthLabel: sanitizeText(obj.currentMonthLabel, 24) || 'Current Month',
    previousMonthLabel: sanitizeText(obj.previousMonthLabel, 24) || 'Previous Month',
    transactionCount: Math.round(toSafeNumber(obj.transactionCount, 0, 100_000)),
    currentMonthTransactionCount: Math.round(toSafeNumber(obj.currentMonthTransactionCount, 0, 100_000)),
    previousMonthTransactionCount: Math.round(toSafeNumber(obj.previousMonthTransactionCount, 0, 100_000)),
    monthlySummary: {
      income: toSafeNumber(summaryRaw.income),
      expenses: toSafeNumber(summaryRaw.expenses),
      savings: toSafeNumber(summaryRaw.savings, -1_000_000_000, 1_000_000_000),
      savingsRatePct: toSafeNullableNumber(summaryRaw.savingsRatePct, -1000, 100),
      prevIncome: toSafeNumber(summaryRaw.prevIncome),
      prevExpenses: toSafeNumber(summaryRaw.prevExpenses),
      prevSavings: toSafeNumber(summaryRaw.prevSavings, -1_000_000_000, 1_000_000_000),
      incomeGrowthPct: toSafeNullableNumber(summaryRaw.incomeGrowthPct),
      expenseGrowthPct: toSafeNullableNumber(summaryRaw.expenseGrowthPct),
      monthlyBudgetLimit: toSafeNumber(summaryRaw.monthlyBudgetLimit),
    },
    categoryBreakdown,
    monthlyTrend,
    unusualTransactions,
    budgets,
    savingsGoals,
    commitments: {
      monthlyBillsAndEmis: toSafeNumber(commitmentsRaw.monthlyBillsAndEmis),
      activeRecurringExpenseMonthly: toSafeNumber(commitmentsRaw.activeRecurringExpenseMonthly),
      overdueBillsCount: Math.round(toSafeNumber(commitmentsRaw.overdueBillsCount, 0, 1000)),
    },
  };
}

function mapGeminiError(err: unknown): { status: number; code: string; message: string } {
  const errObj = (err && typeof err === 'object' ? err : {}) as {
    status?: number;
    code?: number | string;
    message?: string;
  };
  const msg = String(errObj.message || err || 'Unknown AI service error');
  const status = Number(errObj.status) || 500;

  if (status === 429 || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return {
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      message: 'Gemini API rate limit reached. Please wait a moment and try again.',
    };
  }
  if (
    status === 401 ||
    status === 403 ||
    msg.includes('API_KEY_INVALID') ||
    msg.includes('PERMISSION_DENIED')
  ) {
    return {
      status: 403,
      code: 'API_KEY_INVALID',
      message:
        'Gemini API access was denied. Please verify your GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (status === 404 || msg.includes('NOT_FOUND')) {
    return {
      status: 404,
      code: 'MODEL_NOT_FOUND',
      message: 'Configured Gemini model was not found.',
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 500,
    code: 'AI_REQUEST_FAILED',
    message: 'Unable to generate AI financial insights right now. Please try again shortly.',
  };
}

const INSIGHTS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    financial_summary: {
      type: Type.OBJECT,
      properties: {
        overview: { type: Type.STRING },
        monthly_income_inr: { type: Type.NUMBER },
        monthly_expenses_inr: { type: Type.NUMBER },
        total_savings_inr: { type: Type.NUMBER },
        savings_rate_pct: { type: Type.NUMBER },
        previous_month_comparison: { type: Type.STRING },
        data_availability_note: { type: Type.STRING },
      },
      required: [
        'overview',
        'monthly_income_inr',
        'monthly_expenses_inr',
        'total_savings_inr',
        'savings_rate_pct',
        'previous_month_comparison',
        'data_availability_note',
      ],
    },
    spending_analysis: {
      type: Type.OBJECT,
      properties: {
        narrative: { type: Type.STRING },
        top_categories: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              amount_inr: { type: Type.NUMBER },
              share_pct: { type: Type.NUMBER },
              previous_month_inr: { type: Type.NUMBER },
              trend_note: { type: Type.STRING },
            },
            required: ['category', 'amount_inr', 'share_pct', 'previous_month_inr', 'trend_note'],
          },
        },
      },
      required: ['narrative', 'top_categories'],
    },
    unusual_spending: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        alerts: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              amount_inr: { type: Type.NUMBER },
              reason: { type: Type.STRING },
              severity: { type: Type.STRING },
            },
            required: ['category', 'amount_inr', 'reason', 'severity'],
          },
        },
      },
      required: ['summary', 'alerts'],
    },
    savings_suggestions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          action_step: { type: Type.STRING },
          potential_monthly_saving_inr: { type: Type.NUMBER },
          priority: { type: Type.STRING },
        },
        required: ['title', 'action_step', 'potential_monthly_saving_inr', 'priority'],
      },
    },
    budget_recommendations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          current_budget_inr: { type: Type.NUMBER },
          recommended_budget_inr: { type: Type.NUMBER },
          rationale: { type: Type.STRING },
        },
        required: ['category', 'current_budget_inr', 'recommended_budget_inr', 'rationale'],
      },
    },
    savings_predictions: {
      type: Type.OBJECT,
      properties: {
        summary: { type: Type.STRING },
        disclaimer: { type: Type.STRING },
        goals: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              goal_name: { type: Type.STRING },
              target_amount_inr: { type: Type.NUMBER },
              saved_amount_inr: { type: Type.NUMBER },
              estimated_months_to_goal: { type: Type.NUMBER },
              estimated_completion_label: { type: Type.STRING },
              monthly_saving_needed_inr: { type: Type.NUMBER },
              status_note: { type: Type.STRING },
            },
            required: [
              'goal_name',
              'target_amount_inr',
              'saved_amount_inr',
              'estimated_months_to_goal',
              'estimated_completion_label',
              'monthly_saving_needed_inr',
              'status_note',
            ],
          },
        },
      },
      required: ['summary', 'disclaimer', 'goals'],
    },
  },
  required: [
    'financial_summary',
    'spending_analysis',
    'unusual_spending',
    'savings_suggestions',
    'budget_recommendations',
    'savings_predictions',
  ],
};

const ALLOWED_INCOME_CATEGORIES = [
  'Salary',
  'Freelancing',
  'Business Income',
  'Online Earnings',
  'Investments',
  'Interest',
  'Other Income',
] as const;

const ALLOWED_EXPENSE_CATEGORIES = [
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
] as const;

const ALLOWED_PAYMENT_METHODS = [
  'UPI',
  'Bank Transfer',
  'Cash',
  'Credit Card',
  'Debit Card',
  'Wallet',
  'Net Banking',
  'Other',
] as const;

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/aac',
  'audio/flac',
  'audio/3gpp',
  'audio/3gpp2',
  'audio/amr',
  'video/webm',
]);

const HINDI_WORD_NUMBERS: Record<string, number> = {
  ek: 1,
  one: 1,
  do: 2,
  two: 2,
  teen: 3,
  three: 3,
  char: 4,
  chaar: 4,
  four: 4,
  paanch: 5,
  panch: 5,
  five: 5,
  chhe: 6,
  che: 6,
  six: 6,
  saat: 7,
  seven: 7,
  aath: 8,
  eight: 8,
  nau: 9,
  nine: 9,
  das: 10,
  ten: 10,
  gyarah: 11,
  barah: 12,
  pandrah: 15,
  fifteen: 15,
  bees: 20,
  twenty: 20,
  pachees: 25,
  tees: 30,
  thirty: 30,
  chalees: 40,
  forty: 40,
  pachaas: 50,
  pachas: 50,
  fifty: 50,
  saath: 60,
  sixty: 60,
  sattar: 70,
  seventy: 70,
  assi: 80,
  eighty: 80,
  nabbe: 90,
  ninety: 90,
  sau: 100,
  hundred: 100,
  dedh: 150,
  dhai: 250,
  hazaar: 1000,
  hajar: 1000,
  thousand: 1000,
  lakh: 100000,
  lac: 100000,
};

function extractAmountFromSpeech(text: string): number {
  const normalized = text.replace(/,/g, '').toLowerCase();
  // Match numeric values (including 2.5k, 1500, 240.50)
  const kMatch = normalized.match(/\b(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) {
    const val = Number(kMatch[1]) * 1000;
    if (Number.isFinite(val) && val > 0) return Number(val.toFixed(2));
  }
  const numMatch = normalized.match(/\b(\d+(?:\.\d{1,2})?)\b/);
  if (numMatch) {
    const val = Number(numMatch[1]);
    if (Number.isFinite(val) && val > 0) return Number(val.toFixed(2));
  }

  // Fallback: Hindi/Hinglish/English word numbers (e.g. "paanch sau", "do hazaar", "dedh sau")
  const tokens = normalized.split(/\s+/);
  let total = 0;
  let current = 0;
  let foundWordNumber = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i].replace(/[^\p{L}]/gu, '');
    const val = HINDI_WORD_NUMBERS[tok];
    if (val === undefined) continue;
    foundWordNumber = true;
    if (val === 150 || val === 250) {
      const nextTok = (tokens[i + 1] || '').replace(/[^\p{L}]/gu, '');
      if (nextTok === 'sau' || nextTok === 'hundred') {
        current += val;
        i += 1;
      } else if (nextTok === 'hazaar' || nextTok === 'hajar' || nextTok === 'thousand') {
        total += val * 10;
        i += 1;
      } else {
        current += val;
      }
    } else if (val === 100) {
      current = (current || 1) * 100;
    } else if (val >= 1000) {
      total += (current || 1) * val;
      current = 0;
    } else {
      current += val;
    }
  }
  const sum = total + current;
  return foundWordNumber && sum > 0 ? sum : 0;
}

function shiftDateDays(isoDate: string, deltaDays: number): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return isoDate;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function parseVoiceTranscriptFallback(
  transcript: string,
  fallbackDate: string,
  fallbackTime: string
): Record<string, unknown> {
  const lower = transcript.toLowerCase();
  const amount = extractAmountFromSpeech(transcript);

  const incomePattern =
    /\b(received|receive|earned|earn|salary|tankhwa|income|refund|credited|credit|bonus|freelance|freelancing|interest|dividend|mili|mila|mile|aaya|aayi|aaye|kamai|kamaaya|recibido|reçu|erhalten|recebido)\b/i;
  const type = incomePattern.test(lower) ? 'income' : 'expense';

  let paymentMethod = 'UPI';
  if (/\b(cash|nakad|nagad|notes|efectivo|espèces|bargeld)\b/i.test(lower)) {
    paymentMethod = 'Cash';
  } else if (/\b(credit\s*card|cc)\b/i.test(lower)) {
    paymentMethod = 'Credit Card';
  } else if (/\b(debit\s*card|atm)\b/i.test(lower)) {
    paymentMethod = 'Debit Card';
  } else if (/\b(bank|neft|imps|rtgs|transfer|account|khata|wire)\b/i.test(lower)) {
    paymentMethod = 'Bank Transfer';
  } else if (/\b(net\s*banking)\b/i.test(lower)) {
    paymentMethod = 'Net Banking';
  } else if (/\b(wallet)\b/i.test(lower)) {
    paymentMethod = 'Wallet';
  } else if (/\b(upi|gpay|google\s*pay|phonepe|paytm|bhim|qr)\b/i.test(lower)) {
    paymentMethod = 'UPI';
  }

  let category = type === 'income' ? 'Other Income' : 'Other Expenses';
  if (type === 'income') {
    if (/\b(salary|tankhwa|wage|paycheck|sueldo|salaire)\b/i.test(lower)) category = 'Salary';
    else if (/\b(freelanc|client|project|gig)\b/i.test(lower)) category = 'Freelancing';
    else if (/\b(business|shop|dukaan|sales|vyapar)\b/i.test(lower)) category = 'Business Income';
    else if (/\b(interest|byaj)\b/i.test(lower)) category = 'Interest';
    else if (/\b(invest|dividend|mutual|stock|sip)\b/i.test(lower)) category = 'Investments';
    else if (/\b(online|youtube|affiliate)\b/i.test(lower)) category = 'Online Earnings';
  } else {
    if (/\b(food|lunch|dinner|breakfast|chai|tea|coffee|samosa|snack|zomato|swiggy|restaurant|khana|nashta|biryani|pizza|burger|meal|grocery|groceries|kirana|sabzi|milk|doodh|paneer|roti|comida|almuerzo)\b/i.test(lower)) {
      category = 'Food';
    } else if (/\b(auto|rickshaw|cab|uber|ola|rapido|metro|bus|petrol|diesel|fuel|train|ticket|parking|toll|transport|commute)\b/i.test(lower)) {
      category = 'Transport';
    } else if (/\b(rent|kiraya|lease)\b/i.test(lower)) {
      category = 'Rent';
    } else if (/\b(electric|electricity|bijli|power\s*bill)\b/i.test(lower)) {
      category = 'Electricity';
    } else if (/\b(internet|wifi|broadband|recharge|jio|airtel|vi|mobile\s*bill)\b/i.test(lower)) {
      category = 'Internet';
    } else if (/\b(doctor|medicine|dawai|medical|hospital|clinic|pharmacy|health|checkup)\b/i.test(lower)) {
      category = 'Healthcare';
    } else if (/\b(school|college|tuition|course|book|books|exam|fees|education)\b/i.test(lower)) {
      category = 'Education';
    } else if (/\b(movie|netflix|prime|spotify|game|concert|party|entertainment)\b/i.test(lower)) {
      category = 'Entertainment';
    } else if (/\b(flight|hotel|trip|vacation|travel|yatra)\b/i.test(lower)) {
      category = 'Travel';
    } else if (/\b(emi|loan|installment|kist)\b/i.test(lower)) {
      category = 'EMI';
    } else if (/\b(bill|water|gas|cylinder|dth|maintenance)\b/i.test(lower)) {
      category = 'Bills';
    } else if (/\b(shop|shopping|amazon|flipkart|myntra|clothes|kapde|shoes|mall|market|gift)\b/i.test(lower)) {
      category = 'Shopping';
    }
  }

  let date = fallbackDate;
  if (/\b(yesterday|beeta\s*kal|kal\s*raat|ayer|hier|gestern)\b/i.test(lower)) {
    date = shiftDateDays(fallbackDate, -1);
  }

  const cleanedTitle = transcript
    .replace(/\b(\d+(?:,\d+)*(?:\.\d+)?\s*k?)\b/gi, '')
    .replace(/\b(rs\.?|inr|rupees?|rupaye|rupaya|bucks|dollars?|usd|eur|euros?|gbp|paid|spent|spend|for|on|via|by|from|using|with|se|ke|ki|ka|ko|par|pe|mein|me|maine|diya|diye|kharch|kiye|kiya|liya|mila|mili|received|aaj|today|yesterday)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const title = cleanedTitle
    ? cleanedTitle.slice(0, 60).replace(/^\w/, (c) => c.toUpperCase())
    : type === 'income'
    ? `${category} Received`
    : `${category} Expense`;

  return {
    transcript,
    type,
    amount,
    title,
    category,
    paymentMethod,
    date,
    time: fallbackTime,
    description: transcript.slice(0, 200),
    missingAmountReason:
      amount > 0 ? '' : 'No monetary amount was detected. Please enter the amount below.',
  };
}

function mapVoiceGeminiError(err: unknown): { status: number; code: string; message: string } {
  const mapped = mapGeminiError(err);
  if (mapped.code === 'AI_REQUEST_FAILED') {
    return {
      ...mapped,
      message:
        'Voice AI could not reach Gemini right now. Please try Browser Live Dictation or type your entry below.',
    };
  }
  return mapped;
}

const VOICE_TRANSACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    transcript: { type: Type.STRING },
    type: { type: Type.STRING },
    amount: { type: Type.NUMBER },
    title: { type: Type.STRING },
    category: { type: Type.STRING },
    paymentMethod: { type: Type.STRING },
    date: { type: Type.STRING },
    time: { type: Type.STRING },
    description: { type: Type.STRING },
    missingAmountReason: { type: Type.STRING },
  },
  required: [
    'transcript',
    'type',
    'amount',
    'title',
    'category',
    'paymentMethod',
    'date',
    'time',
    'description',
    'missingAmountReason',
  ],
};

function normalizeVoiceTransaction(
  raw: Record<string, unknown>,
  fallbackDate: string,
  fallbackTime: string
) {
  const type = raw.type === 'income' ? 'income' : 'expense';
  const rawAmt = Number(raw.amount);
  const amount =
    Number.isFinite(rawAmt) && rawAmt > 0
      ? Math.min(1_000_000_000, Number(rawAmt.toFixed(2)))
      : 0;

  const allowedCats: readonly string[] =
    type === 'income' ? ALLOWED_INCOME_CATEGORIES : ALLOWED_EXPENSE_CATEGORIES;
  const rawCat = sanitizeText(raw.category, 60);
  const matchedCat =
    allowedCats.find((c) => c.toLowerCase() === rawCat.toLowerCase()) ||
    (type === 'income' ? 'Other Income' : 'Other Expenses');

  const rawPm = sanitizeText(raw.paymentMethod, 40);
  const matchedPm =
    ALLOWED_PAYMENT_METHODS.find((m) => m.toLowerCase() === rawPm.toLowerCase()) || 'UPI';

  const rawDate = sanitizeText(raw.date, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : fallbackDate;

  const rawTime = sanitizeText(raw.time, 5);
  const time = /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : fallbackTime;

  const title =
    sanitizeText(raw.title, 140) ||
    (type === 'income' ? `${matchedCat} Received` : `${matchedCat} Expense`);

  const transcript = sanitizeText(raw.transcript, 500);
  const description = sanitizeText(raw.description, 500);
  const missingAmountReason =
    amount > 0
      ? ''
      : sanitizeText(raw.missingAmountReason, 240) ||
        'No clear monetary amount was detected in the voice recording.';

  return {
    transcript,
    type,
    amount,
    title,
    category: matchedCat,
    paymentMethod: matchedPm,
    date,
    time,
    description,
    missingAmountReason,
  };
}

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);

  const json128kb = express.json({ limit: '128kb' });
  const json4mb = express.json({ limit: '4mb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/ai/voice-transaction') {
      json4mb(req, res, next);
    } else {
      json128kb(req, res, next);
    }
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(getGeminiClient()),
    });
  });

  app.post('/api/ai/insights', aiRateLimiter, async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured yet. Add GEMINI_API_KEY in Settings > Secrets to enable Gemini AI Financial Insights.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      snapshot?: unknown;
    };
    const snapshot = sanitizeFinancialSnapshot(body.snapshot);
    if (!snapshot) {
      res.status(400).json({ error: 'Invalid financial snapshot payload.', code: 'BAD_REQUEST' });
      return;
    }

    if (snapshot.transactionCount === 0) {
      res.status(400).json({
        error: 'At least one transaction is required to generate AI financial insights.',
        code: 'INSUFFICIENT_DATA',
      });
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: `Analyze this sanitized personal finance snapshot and return structured JSON insights in Indian Rupees (₹):\n${JSON.stringify(
          snapshot
        )}`,
        config: {
          systemInstruction: [
            'You are FinTrack AI Financial Analyst, a concise, accurate, personal finance analyst.',
            'STRICT RULES:',
            '1. Base every number and statement strictly on the provided JSON snapshot. Never fabricate transactions, balances, or categories.',
            '2. Express ALL currency amounts in Indian Rupees (₹).',
            '3. Keep overview and narratives concise (2-3 sentences max), practical, and grounded in actual figures.',
            '4. If previous month data, budgets, or savings goals are missing/empty, state clearly that those specific comparisons or goal timelines cannot be generated until data is added (and return empty arrays where appropriate).',
            '5. Clearly label savings_predictions as estimates based on historical cash flow, NOT guarantees. Never recommend specific stocks, mutual funds, crypto, or promise investment returns.',
            '6. For severity use one of: "info", "warning", "critical". For priority use one of: "high", "medium", "low".',
          ].join('\n'),
          responseMimeType: 'application/json',
          responseSchema: INSIGHTS_RESPONSE_SCHEMA,
        },
      });

      const rawText = (response.text || '').trim();
      if (!rawText) {
        res.status(502).json({
          error: 'Gemini returned an empty response. Please try again.',
          code: 'EMPTY_RESPONSE',
        });
        return;
      }

      const cleanedJson = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleanedJson);
      } catch {
        res.status(502).json({
          error: 'Gemini returned an unexpected format. Please try refreshing AI Insights.',
          code: 'INVALID_JSON_RESPONSE',
        });
        return;
      }

      res.json({
        model: GEMINI_MODEL,
        generatedAt: new Date().toISOString(),
        insights: parsed,
      });
    } catch (err: unknown) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post('/api/ai/chat', aiRateLimiter, async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured yet. Add GEMINI_API_KEY in Settings > Secrets to use the AI Financial Assistant.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      question?: unknown;
      history?: unknown;
      snapshot?: unknown;
    };

    const question = sanitizeText(body.question, 600);
    if (!question) {
      res.status(400).json({ error: 'Please enter a financial question.', code: 'BAD_REQUEST' });
      return;
    }

    const snapshot = sanitizeFinancialSnapshot(body.snapshot);
    if (!snapshot) {
      res.status(400).json({ error: 'Invalid financial snapshot payload.', code: 'BAD_REQUEST' });
      return;
    }

    const history = Array.isArray(body.history)
      ? body.history
          .slice(-8)
          .map((m) => {
            const msg = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
            const role = msg.role === 'assistant' ? 'Assistant' : 'User';
            const content = sanitizeText(msg.content, 800);
            return content ? `${role}: ${content}` : '';
          })
          .filter(Boolean)
          .join('\n')
      : '';

    try {
      const prompt = [
        `Sanitized Financial Snapshot (Amounts in INR ₹):`,
        JSON.stringify(snapshot),
        history ? `\nRecent Conversation:\n${history}` : '',
        `\nUser Question: ${question}`,
      ]
        .filter(Boolean)
        .join('\n');

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: [
            'You are FinTrack AI Chat Assistant.',
            'Answer the user question accurately using ONLY the provided Sanitized Financial Snapshot.',
            'All currency amounts must be formatted in Indian Rupees (₹).',
            'If a requested figure or category is missing from the snapshot, clearly say that no records were found for it rather than guessing.',
            'Clearly distinguish between actual recorded figures and estimates (e.g., savings targets or projections).',
            'Do not give guaranteed investment returns or personalized investment/stock/crypto advice.',
            'Keep answers well-structured, concise, and practical (short paragraphs or bullet points).',
          ].join('\n'),
        },
      });

      const answer = (response.text || '').trim();
      if (!answer) {
        res.status(502).json({
          error: 'Assistant returned an empty response. Please try again.',
          code: 'EMPTY_RESPONSE',
        });
        return;
      }

      res.json({
        model: GEMINI_MODEL,
        answer,
        answeredAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      const mapped = mapGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  app.post('/api/ai/voice-transaction', aiRateLimiter, async (req: Request, res: Response) => {
    const ai = getGeminiClient();

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      audioBase64?: unknown;
      mimeType?: unknown;
      transcriptText?: unknown;
      languageHint?: unknown;
      languageLabel?: unknown;
      localDate?: unknown;
      localTime?: unknown;
    };

    const rawDate = sanitizeText(body.localDate, 10);
    const todayFallback = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : new Date().toISOString().slice(0, 10);
    const rawTime = sanitizeText(body.localTime, 5);
    const timeFallback = /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : '12:00';

    const transcriptText = sanitizeText(body.transcriptText, 600);
    const languageHint = sanitizeText(body.languageHint, 32);
    const languageLabel = sanitizeText(body.languageLabel, 80);
    const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : '';
    const rawBaseMime = sanitizeText(body.mimeType, 80).split(';')[0].trim().toLowerCase();
    const baseMime = rawBaseMime === 'video/webm' ? 'audio/webm' : rawBaseMime;

    if (!audioBase64 && !transcriptText) {
      res.status(400).json({
        error: 'Please record a voice clip or speak/type a transaction phrase.',
        code: 'BAD_REQUEST',
      });
      return;
    }

    if (audioBase64) {
      if (!ALLOWED_AUDIO_MIME_TYPES.has(rawBaseMime)) {
        res.status(400).json({
          error: 'Unsupported audio recording format. Please try Browser Live Dictation or type your entry.',
          code: 'UNSUPPORTED_AUDIO_FORMAT',
        });
        return;
      }
      if (audioBase64.length > 3_200_000 || !/^[A-Za-z0-9+/=]+$/.test(audioBase64)) {
        res.status(400).json({
          error: 'Voice recording is too large or invalid. Please keep recordings under 15 seconds.',
          code: 'AUDIO_TOO_LARGE',
        });
        return;
      }
    }

    // If GEMINI_API_KEY is missing, parse transcriptText cleanly via multilingual fallback
    if (!ai) {
      if (transcriptText) {
        const fallbackTx = normalizeVoiceTransaction(
          parseVoiceTranscriptFallback(transcriptText, todayFallback, timeFallback),
          todayFallback,
          timeFallback
        );
        res.json({ model: 'local-multilingual-fallback', transaction: fallbackTx });
        return;
      }
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured yet for audio transcription. Use Browser Live Dictation or type your entry below.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    const langContext =
      languageLabel && languageHint && languageHint !== 'auto'
        ? `User preferred spoken language/region: ${languageLabel} (${languageHint}). Also support mixed English/Hinglish or any other spoken language.`
        : 'Auto-detect ANY spoken language worldwide (including English, Hindi, Hinglish, all Indian regional languages, and all international languages).';

    const buildInstructionPrompt = (textInput: string) =>
      [
        'Extract a personal finance transaction from the user spoken/typed input into strict JSON.',
        langContext,
        `Reference Today Date: ${todayFallback}. Reference Current Time: ${timeFallback}.`,
        `Allowed type values: "income" or "expense". Default to "expense" unless user indicates received/earned/salary/refund/credited/income (or equivalents like "mila", "aaya", "recibido", "reçu", etc.).`,
        `Allowed income categories: ${ALLOWED_INCOME_CATEGORIES.join(', ')}.`,
        `Allowed expense categories: ${ALLOWED_EXPENSE_CATEGORIES.join(', ')}.`,
        `Allowed paymentMethod values: ${ALLOWED_PAYMENT_METHODS.join(', ')}. Map PhonePe/GPay/Google Pay/Paytm/BHIM/UPI/QR to "UPI"; NEFT/IMPS/RTGS/Bank/Transfer/Khata to "Bank Transfer"; Cash/Nakad/Efectivo to "Cash"; Credit/Debit cards accordingly.`,
        'Understand spoken number words in Hindi/Hinglish (e.g., "paanch sau"=500, "dedh sau"=150, "dhai sau"=250, "do hazaar"=2000) and all world languages.',
        'If the user mentions yesterday (e.g., "yesterday", "kal" in past context, "ayer", "hier", "gestern"), subtract 1 day from Reference Today Date.',
        'Keep "transcript" in the original spoken words/language. Write a concise clean "title" and "description" (in English or natural merchant form).',
        'If no numeric monetary amount is spoken, set amount to 0 and explain briefly in missingAmountReason.',
        textInput
          ? `Spoken/Typed input: "${textInput}"`
          : 'Listen carefully to the attached audio clip and extract the transaction.',
      ].join('\n');

    let resolvedTranscript = transcriptText;
    let modelUsed = GEMINI_MODEL;

    // Step 1: When audio is sent, transcribe first with dedicated gemini-3.5-transcribe model
    if (audioBase64 && !resolvedTranscript) {
      try {
        const transcribeResp = await ai.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: {
            parts: [
              { inlineData: { mimeType: baseMime, data: audioBase64 } },
              {
                text: `Transcribe this short financial voice note verbatim in the exact language or dialect spoken (including Hinglish, Hindi, regional Indian languages, or any world language). ${langContext} Return only the spoken text.`,
              },
            ],
          },
        });
        const transcribed = sanitizeText(transcribeResp.text || '', 600);
        if (transcribed) {
          resolvedTranscript = transcribed;
        }
      } catch {
        // Fall through to multimodal gemini-4-hydrogen below
      }
    }

    try {
      let rawText = '';

      if (resolvedTranscript) {
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: buildInstructionPrompt(resolvedTranscript),
          config: {
            systemInstruction:
              'You are FinTrack Multilingual Voice AI Parser. Convert personal finance phrases from ANY language or country worldwide (including English, Hindi, Hinglish, Marathi, Gujarati, Bengali, Tamil, Telugu, Spanish, French, German, Arabic, Japanese, etc.) into clean structured JSON.',
            responseMimeType: 'application/json',
            responseSchema: VOICE_TRANSACTION_SCHEMA,
          },
        });
        rawText = (response.text || '').trim();
      } else if (audioBase64) {
        // Direct multimodal audio fallback with gemini-4-hydrogen if gemini-3.5-transcribe returned empty
        const response = await ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: {
            parts: [
              { inlineData: { mimeType: baseMime, data: audioBase64 } },
              { text: buildInstructionPrompt('') },
            ],
          },
          config: {
            systemInstruction:
              'You are FinTrack Multilingual Voice AI Parser. Listen to audio in ANY language worldwide (including English, Hindi, Hinglish, all Indian languages, and all international languages) and output clean structured JSON.',
            responseMimeType: 'application/json',
            responseSchema: VOICE_TRANSACTION_SCHEMA,
          },
        });
        rawText = (response.text || '').trim();
      }

      if (!rawText) {
        if (resolvedTranscript) {
          const fallbackTx = normalizeVoiceTransaction(
            parseVoiceTranscriptFallback(resolvedTranscript, todayFallback, timeFallback),
            todayFallback,
            timeFallback
          );
          res.json({ model: 'local-multilingual-fallback', transaction: fallbackTx });
          return;
        }
        res.status(502).json({
          error: 'Could not hear speech clearly in the recording. Please try speaking closer to the mic or use Live Dictation.',
          code: 'EMPTY_RESPONSE',
        });
        return;
      }

      const cleanedJson = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(cleanedJson);
      } catch {
        if (resolvedTranscript) {
          const fallbackTx = normalizeVoiceTransaction(
            parseVoiceTranscriptFallback(resolvedTranscript, todayFallback, timeFallback),
            todayFallback,
            timeFallback
          );
          res.json({ model: 'local-multilingual-fallback', transaction: fallbackTx });
          return;
        }
        res.status(502).json({
          error: 'Could not parse the voice transaction cleanly. Please try speaking again.',
          code: 'INVALID_JSON_RESPONSE',
        });
        return;
      }

      const parsedObj =
        parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)
          ? (parsedRaw as Record<string, unknown>)
          : {};
      if (resolvedTranscript && !parsedObj.transcript) {
        parsedObj.transcript = resolvedTranscript;
      }
      const transaction = normalizeVoiceTransaction(parsedObj, todayFallback, timeFallback);

      res.json({
        model: modelUsed,
        transaction,
      });
    } catch (err: unknown) {
      // If we have a transcript (from Browser Live Dictation, typing, or gemini-3.5-transcribe), never fail the user on a transient Gemini error
      if (resolvedTranscript) {
        const fallbackTx = normalizeVoiceTransaction(
          parseVoiceTranscriptFallback(resolvedTranscript, todayFallback, timeFallback),
          todayFallback,
          timeFallback
        );
        res.json({
          model: 'local-multilingual-fallback',
          transaction: fallbackTx,
        });
        return;
      }
      const mapped = mapVoiceGeminiError(err);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  const distDir = path.resolve(__dirname, 'dist');
  const distIndex = path.resolve(distDir, 'index.html');
  const useViteDev =
    process.env.VITE_DEV_MODE === 'true' ||
    (process.env.NODE_ENV !== 'production' && !fs.existsSync(distIndex));

  if (useViteDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API endpoint not found.', code: 'NOT_FOUND' });
        return;
      }
      res.sendFile(distIndex);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FinTrack server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
