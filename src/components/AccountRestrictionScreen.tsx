import React, { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  LogOut,
  Mail,
  Megaphone,
  MessageSquareWarning,
  Send,
  ShieldAlert,
  ShieldX,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { auth } from '../firebase';
import { submitSecurityAppeal } from '../services/firestoreService';
import { formatDurationHhMmSs } from '../services/securityDetectionService';
import { SUPPORT_EMAIL } from '../utils/constants';
import { AdminPopupMessageModal } from './AdminPopupMessageModal';

const APPEAL_REASON_PRESETS = [
  'I believe this restriction was a mistake / false positive',
  'My account may have been accessed without my permission',
  'I have resolved the issue and request a manual review',
  'Requesting clarification on the restriction reason',
] as const;

const APPEAL_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300',
  under_review: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300',
  approved: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300',
  rejected: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300',
};

export function AccountRestrictionScreen() {
  const {
    user,
    profile,
    isAccountDeactivated,
    isAccountBanned,
    activeBanType,
    banExpiresAtMs,
    isMessagingRestricted,
    messagingRestrictedUntilMs,
    securityProfile,
    userAppeals,
    adminMessages,
    acknowledgeAdminMessage,
  } = useFinance();

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealReason, setAppealReason] = useState<string>(APPEAL_REASON_PRESETS[0]);
  const [explanation, setExplanation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [appealError, setAppealError] = useState('');
  const [appealSuccess, setAppealSuccess] = useState('');

  useEffect(() => {
    const hasCountdown =
      (activeBanType === 'temporary' && banExpiresAtMs !== null) ||
      (isMessagingRestricted && messagingRestrictedUntilMs !== null);
    if (!hasCountdown) return;
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeBanType, banExpiresAtMs, isMessagingRestricted, messagingRestrictedUntilMs]);

  if (!user) return null;

  const remainingBanMs =
    activeBanType === 'temporary' && banExpiresAtMs !== null
      ? Math.max(0, banExpiresAtMs - nowMs)
      : 0;

  const remainingMsgRestrictMs =
    isMessagingRestricted && messagingRestrictedUntilMs !== null
      ? Math.max(0, messagingRestrictedUntilMs - nowMs)
      : 0;

  const isPermanent = activeBanType === 'permanent';
  const isTemporary = activeBanType === 'temporary';

  const title = isPermanent
    ? 'Account Permanently Banned'
    : isTemporary
    ? 'Account Temporarily Banned'
    : 'Account Deactivated';

  const banReason =
    securityProfile?.banReason ||
    (isAccountDeactivated
      ? 'Your FinTrack account has been deactivated by an administrator.'
      : 'Security restriction enforced by FinTrack Administrator.');

  const hasOpenAppeal = userAppeals.some(
    (a) => a.status === 'pending' || a.status === 'under_review'
  );

  const handleSubmitAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    setAppealError('');
    setAppealSuccess('');

    if (isMessagingRestricted && remainingMsgRestrictMs > 0) {
      setAppealError(
        `Messaging is temporarily restricted for ${formatDurationHhMmSs(remainingMsgRestrictMs)}.`
      );
      return;
    }

    setSubmitting(true);
    try {
      await submitSecurityAppeal({
        userId: user.uid,
        userEmail: user.email || profile?.email || 'user@fintrack.app',
        displayName: profile?.displayName || user.displayName || 'FinTrack User',
        banType: isAccountBanned ? activeBanType : 'none',
        banReason,
        appealReason,
        explanation,
      });
      setAppealSuccess(
        'Your appeal has been submitted to the FinTrack Security Center for administrator review.'
      );
      setExplanation('');
      setAppealOpen(false);
    } catch (err) {
      setAppealError((err as Error)?.message || 'Failed to submit appeal.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/80 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
        {/* Status Header */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
            {isPermanent ? (
              <ShieldX className="w-6 h-6" />
            ) : isTemporary ? (
              <Clock className="w-6 h-6" />
            ) : (
              <ShieldAlert className="w-6 h-6" />
            )}
          </div>
          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">{title}</h1>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
                {isPermanent
                  ? 'Permanent Restriction'
                  : isTemporary
                  ? `Temporary (${securityProfile?.banDurationLabel || 'Timed'})`
                  : 'Deactivated'}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Account: <span className="font-semibold text-slate-900 dark:text-slate-200">{user.email}</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span className="font-mono text-[11px]">ID: {user.uid}</span>
            </p>
          </div>
        </div>

        {/* Countdown for Temporary Ban */}
        {isTemporary && banExpiresAtMs !== null && (
          <div className="rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
                  Temporary Ban Time Remaining (hh:mm:ss)
                </div>
                <div className="text-[11px] text-amber-800 dark:text-amber-300">
                  Ends on{' '}
                  {new Date(banExpiresAtMs).toLocaleString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-900 dark:text-amber-200">
              {formatDurationHhMmSs(remainingBanMs)}
            </div>
          </div>
        )}

        {/* Reason & Data Preservation Assurance */}
        <div className="rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
            <FileWarning className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            <span>Reason &amp; Restriction Scope</span>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{banReason}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed pt-1 border-t border-slate-200/70 dark:border-slate-800">
            Access to protected features, AI tools, VIP features, and backend APIs is blocked while restricted. Your existing financial records and history have NOT been deleted and remain safely preserved during review.
          </p>
        </div>

        {/* Appeal Action & Form (For Both Temporary and Permanent Bans + Deactivated Accounts) */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <MessageSquareWarning className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Believe this restriction was issued in error?</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Submit a review appeal explaining why your {isPermanent ? 'permanent ban' : isTemporary ? 'temporary ban' : 'account restriction'} should be lifted.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setAppealOpen((prev) => !prev);
                setAppealError('');
              }}
              disabled={isMessagingRestricted && remainingMsgRestrictMs > 0}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{appealOpen ? 'Close Appeal Form' : 'Appeal Ban'}</span>
            </button>
          </div>

          {isMessagingRestricted && remainingMsgRestrictMs > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2">
              <span>Messaging is temporarily restricted on this account.</span>
              <span className="font-mono tabular-nums font-bold">
                {formatDurationHhMmSs(remainingMsgRestrictMs)}
              </span>
            </div>
          )}

          {appealSuccess && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{appealSuccess}</span>
            </div>
          )}

          {appealError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{appealError}</span>
            </div>
          )}

          {appealOpen && (
            <form onSubmit={handleSubmitAppeal} className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              {hasOpenAppeal && (
                <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-[11px] text-blue-800 dark:text-blue-300">
                  You already have an active appeal in review. Adding another submission will create a supplemental appeal record.
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Appeal Reason
                </label>
                <select
                  value={appealReason}
                  onChange={(e) => setAppealReason(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                >
                  {APPEAL_REASON_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Detailed Explanation (min 10 characters)
                </label>
                <textarea
                  rows={4}
                  required
                  minLength={10}
                  maxLength={1500}
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  placeholder="Explain why your account should be reviewed and restored..."
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                />
                <div className="text-[11px] text-right font-mono tabular-nums text-slate-400">
                  {explanation.length}/1500
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAppealOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Submitting...' : 'Submit Appeal'}</span>
                </button>
              </div>
            </form>
          )}

          {/* User's Previous Appeals */}
          {userAppeals.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                Your Submitted Appeals ({userAppeals.length})
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {userAppeals.map((appeal) => {
                  const statusClass =
                    APPEAL_STATUS_STYLES[appeal.status] || APPEAL_STATUS_STYLES.pending;
                  return (
                    <div
                      key={appeal.id}
                      className="rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-3 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {appeal.appealReason}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded border ${statusClass}`}
                        >
                          {appeal.status.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                        {appeal.explanation}
                      </p>
                      {appeal.adminDecisionNote && (
                        <div className="pt-1.5 border-t border-slate-200/70 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-200">
                          <span className="font-semibold">Admin Review Note:</span>{' '}
                          {appeal.adminDecisionNote}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Admin Messages (Still delivered even when banned/deactivated) */}
        {adminMessages.length > 0 && (
          <div className="text-left space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
              <Megaphone className="w-4 h-4 shrink-0" />
              <span>Messages from Administrator ({adminMessages.length})</span>
            </div>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {adminMessages.map((msg) => {
                const sentAt =
                  msg.createdAt && typeof msg.createdAt.seconds === 'number'
                    ? new Date(msg.createdAt.seconds * 1000).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Recent';
                return (
                  <div
                    key={msg.id}
                    className="rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 p-3.5 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        {msg.heading}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
                        {sentAt}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-line">
                      {msg.message}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer Support & Sign Out */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Mail className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              Support:{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-semibold text-emerald-600 dark:text-emerald-400 underline"
              >
                {SUPPORT_EMAIL}
              </a>
            </span>
          </div>

          <button
            type="button"
            onClick={() => signOut(auth)}
            className="inline-flex items-center justify-center gap-1.5 py-2 px-4 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      <AdminPopupMessageModal
        messages={adminMessages.filter((m) => !m.isRead)}
        onAcknowledge={acknowledgeAdminMessage}
      />
    </div>
  );
}
