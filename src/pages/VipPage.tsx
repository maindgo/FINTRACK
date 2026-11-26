import React from 'react';
import {
  ArrowRight,
  Bot,
  Calculator,
  Check,
  Clock,
  Crown,
  FileSpreadsheet,
  Mail,
  MessageSquareText,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { NavSection } from '../types/finance';
import { SUPPORT_EMAIL } from '../utils/constants';

interface VipPageProps {
  onNavigate: (section: NavSection) => void;
}

const VIP_FEATURES = [
  {
    icon: Calculator,
    title: 'AI Accountant',
    timing: 'Coming Soon',
    summary:
      'Automated monthly financial closing, tax-ready expense classification, GST & deduction tagging, and actionable CA-style ledger health reviews.',
    mechanism: 'Analyzes your recurring cash flows, invoices, and category patterns automatically.',
  },
  {
    icon: MessageSquareText,
    title: 'SMS Detection',
    timing: 'Coming Soon',
    summary:
      'Smart parsing for bank debit/credit alerts, UPI notifications, and card transaction SMS messages without manual typing.',
    mechanism: 'Extracts merchant, amount, date, and payment mode (UPI, Bank Transfer, Card) securely.',
  },
  {
    icon: Zap,
    title: 'Automatically Record Entry',
    timing: 'Coming Soon',
    summary:
      'Hands-free transaction logging that posts verified SMS and bill alerts straight into your Bank/UPI or Cash ledger in real time.',
    mechanism: 'Eliminates forgotten daily spends and keeps your current balances synced continuously.',
  },
  {
    icon: TrendingUp,
    title: 'Predictive Cash-Flow Autopilot',
    timing: 'Coming Soon',
    summary:
      'Multi-month surplus forecasting, upcoming EMI collision warnings, and dynamic savings allocation targets tailored to your income rhythm.',
    mechanism: 'Combines bills, recurring rules, and historical spending velocity.',
  },
  {
    icon: ReceiptText,
    title: 'Smart Receipt & Invoice OCR',
    timing: 'Coming Soon',
    summary:
      'Scan grocery bills, utility statements, or vendor invoices to automatically extract totals, tax breakdowns, and line items.',
    mechanism: 'One-tap camera capture with instant category assignment and receipt archiving.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Scheduled CA Audit Packs & Priority Support',
    timing: 'Coming Soon',
    summary:
      'Automated monthly PDF/Excel financial packs covering P&L, Balance Sheet, Trial Balance, and direct priority support.',
    mechanism: 'Export-ready statements delivered on schedule with priority support access.',
  },
] as const;

const COMPARISON_ROWS = [
  {
    capability: 'Income, Expense, Savings, Budgets, Loans & Bills Tracking',
    standard: 'Included Free',
    vip: 'Included',
  },
  {
    capability: 'Separate Bank / UPI & Cash in Hand Balance Tracking',
    standard: 'Included Free',
    vip: 'Included',
  },
  {
    capability: 'Voice AI Entry & AI Financial Insights Chat',
    standard: 'Included Free',
    vip: 'Expanded Priority Quota',
  },
  {
    capability: 'AI Accountant (Automated Tax & Ledger Closing)',
    standard: '—',
    vip: 'Coming Soon',
  },
  {
    capability: 'SMS Detection & Automatically Record Entry',
    standard: '—',
    vip: 'Coming Soon',
  },
  {
    capability: 'Smart Receipt OCR & Automated Monthly Audit Packs',
    standard: '—',
    vip: 'Coming Soon',
  },
] as const;

export function VipPage({ onNavigate }: VipPageProps) {
  return (
    <div className="space-y-8">
      {/* Hero Banner */}
      <section className="bg-slate-900 dark:bg-slate-900 text-white border border-slate-800 rounded-2xl p-6 sm:p-8 lg:p-10">
        <div className="max-w-3xl space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-amber-400">
            <Crown className="w-4 h-4 shrink-0" />
            <span>FinTrack VIP</span>
            <span aria-hidden="true">·</span>
            <span>Coming Soon</span>
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white [text-wrap:balance]">
            Autonomous AI Accounting, SMS Detection &amp; Hands-Free Entry Recording
          </h2>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-2xl">
            FinTrack VIP is in active development to bring zero-effort automation to your personal and business finances—combining an AI Accountant, automatic SMS transaction detection, smart entry recording, and predictive planning.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('ai-insights')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4" />
              <span>Use AI Insights Now</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <a
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('FinTrack VIP Early Access Inquiry')}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-700 bg-slate-800/80 text-slate-100 text-xs font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <Mail className="w-4 h-4 text-amber-400" />
              <span>Request Early Access / Feedback</span>
            </a>
          </div>
        </div>
      </section>

      {/* Upcoming VIP Features Grid */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              What&apos;s Coming in FinTrack VIP
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Built to save hours of manual bookkeeping while keeping your Bank/UPI, Cash, and Savings totals accurate.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Rolling out soon</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {VIP_FEATURES.map((feat) => {
            const Icon = feat.icon;
            return (
              <div
                key={feat.title}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      {feat.timing}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                      {feat.title}
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {feat.summary}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                  {feat.mechanism}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Standard vs VIP Comparison */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              FinTrack Standard vs. FinTrack VIP
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All core money management tools stay free—VIP adds autonomous capture and AI accounting.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Private &amp; User-Controlled</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-3 px-6">Capability</th>
                <th className="py-3 px-4">Standard (Active Today)</th>
                <th className="py-3 px-6">VIP (Coming Soon)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {COMPARISON_ROWS.map((row) => (
                <tr key={row.capability} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-6 font-medium text-slate-900 dark:text-white">
                    {row.capability}
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                    {row.standard === 'Included Free' ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                        <Check className="w-3.5 h-3.5" />
                        {row.standard}
                      </span>
                    ) : (
                      <span className="text-slate-400">{row.standard}</span>
                    )}
                  </td>
                  <td className="py-3 px-6 whitespace-nowrap">
                    {row.vip === 'Coming Soon' ? (
                      <span className="font-semibold text-amber-600 dark:text-amber-400">
                        Coming Soon
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                        <Check className="w-3.5 h-3.5" />
                        {row.vip}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Bottom Contact / Suggestion Strip */}
      <section className="bg-slate-100 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div className="space-y-0.5">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">
              Want a specific feature in FinTrack VIP?
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Send your suggestions directly to{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>{' '}
              — we actively prioritize user-requested automations.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap self-start sm:self-auto shrink-0"
        >
          Back to Dashboard
        </button>
      </section>
    </div>
  );
}
