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
  'audio/mpeg',
  'audio/aac',
  'audio/3gpp',
]);

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
  const json2mb = express.json({ limit: '2mb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/ai/voice-transaction') {
      json2mb(req, res, next);
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
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured yet. Add GEMINI_API_KEY in Settings > Secrets to use Voice AI transaction entry.',
        code: 'MISSING_API_KEY',
      });
      return;
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      audioBase64?: unknown;
      mimeType?: unknown;
      transcriptText?: unknown;
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
    const audioBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : '';
    const baseMime = sanitizeText(body.mimeType, 80).split(';')[0].trim().toLowerCase();

    if (!audioBase64 && !transcriptText) {
      res.status(400).json({
        error: 'Please record a voice clip or speak/type a transaction phrase.',
        code: 'BAD_REQUEST',
      });
      return;
    }

    if (audioBase64) {
      if (!ALLOWED_AUDIO_MIME_TYPES.has(baseMime)) {
        res.status(400).json({
          error: 'Unsupported audio recording format. Please try again or type your entry.',
          code: 'UNSUPPORTED_AUDIO_FORMAT',
        });
        return;
      }
      if (audioBase64.length > 1_800_000 || !/^[A-Za-z0-9+/=]+$/.test(audioBase64)) {
        res.status(400).json({
          error: 'Voice recording is too large or invalid. Please keep recordings under 15 seconds.',
          code: 'AUDIO_TOO_LARGE',
        });
        return;
      }
    }

    const instructionPrompt = [
      'Extract a personal finance transaction from the user voice audio or text into strict JSON.',
      `Reference Today Date: ${todayFallback}. Reference Current Time: ${timeFallback}.`,
      `Allowed type values: "income" or "expense". Default to "expense" unless user explicitly says received/earned/salary/refund/credited/income.`,
      `Allowed income categories: ${ALLOWED_INCOME_CATEGORIES.join(', ')}.`,
      `Allowed expense categories: ${ALLOWED_EXPENSE_CATEGORIES.join(', ')}.`,
      `Allowed paymentMethod values: ${ALLOWED_PAYMENT_METHODS.join(', ')}. Map PhonePe/GPay/Paytm/BHIM/UPI/QR to "UPI"; NEFT/IMPS/RTGS/Bank to "Bank Transfer"; Cash/notes to "Cash"; Card/Credit/Debit accordingly.`,
      'If user says "yesterday", subtract 1 day from Reference Today Date. Otherwise use Reference Today Date unless a specific date is stated.',
      'Set transcript to an accurate verbatim transcription of what the user said (or the provided text).',
      'If no numeric monetary amount is spoken, set amount to 0 and explain briefly in missingAmountReason.',
      transcriptText ? `Spoken/Typed input: "${transcriptText}"` : 'Listen carefully to the attached audio clip.',
    ].join('\n');

    try {
      const contents = audioBase64
        ? [
            { text: instructionPrompt },
            { inlineData: { mimeType: baseMime, data: audioBase64 } },
          ]
        : instructionPrompt;

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents,
        config: {
          systemInstruction:
            'You are FinTrack Voice AI Parser. Convert short spoken Indian personal finance notes (English, Hindi, or Hinglish) into clean structured JSON.',
          responseMimeType: 'application/json',
          responseSchema: VOICE_TRANSACTION_SCHEMA,
        },
      });

      const rawText = (response.text || '').trim();
      if (!rawText) {
        res.status(502).json({
          error: 'Gemini returned an empty response for your voice clip. Please try again.',
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
      const transaction = normalizeVoiceTransaction(parsedObj, todayFallback, timeFallback);

      res.json({
        model: GEMINI_MODEL,
        transaction,
      });
    } catch (err: unknown) {
      const mapped = mapGeminiError(err);
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
