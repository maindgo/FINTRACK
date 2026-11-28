import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  BotOff,
  CheckCircle2,
  Clock,
  Crown,
  Eye,
  FileText,
  Gavel,
  History,
  Loader2,
  MessageSquareOff,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { useFinance } from '../context/FinanceContext';
import { fetchAdminSecurityTelemetry } from '../services/aiInsightsService';
import {
  executeSecurityAdminAction,
  reviewSecurityAppeal,
  saveSecurityCaseNotes,
  subscribeAllAiUsageForAdmin,
  subscribeAllSecurityProfilesForAdmin,
  subscribeAllVipSubscriptionsForAdmin,
  subscribeSecurityAppealsForAdmin,
  subscribeSecurityAuditLogsForAdmin,
  subscribeSecurityCasesForAdmin,
  subscribeSecurityEventsForAdmin,
  updateSecurityEventStatus,
} from '../services/firestoreService';
import {
  CATEGORY_LABELS,
  computeEvidenceRiskScore,
  EVENT_LABELS,
  formatDurationHhMmSs,
  parseDurationHhMmSs,
  RESTRICTION_DURATION_PRESETS,
  TEMP_BAN_DURATION_PRESETS,
} from '../services/securityDetectionService';
import {
  AiUsageRecord,
  AppealStatus,
  BillingCycle,
  SecurityAdminActionType,
  SecurityAppeal,
  SecurityAuditLog,
  SecurityCase,
  SecurityEventRecord,
  SecurityEventType,
  SecurityProfile,
  SecurityRiskLevel,
  UserProfile,
  VipSubscription,
  VipTier,
} from '../types/finance';
import { ADMIN_EMAIL } from '../utils/constants';
import { isVipTier, VIP_TIER_CONFIGS, VIP_TIER_ORDER } from '../utils/vipTiers';

type SecuritySubTab = 'accounts' | 'events' | 'appeals' | 'audit';
type DateFilterMode = 'all' | 'today' | '7d' | '30d' | 'custom';

interface AdminSecurityCenterProps {
  users: UserProfile[];
}

function toMillis(ts: { seconds?: number } | null | undefined, iso?: string): number {
  if (ts && typeof ts.seconds === 'number') {
    return ts.seconds * 1000;
  }
  if (iso) {
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function formatDateTime(ms: number): string {
  if (!ms || ms <= 0) return '—';
  return new Date(ms).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function toLocalDateKey(ms: number): string {
  if (!ms || ms <= 0) return '';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function riskTextClass(level: SecurityRiskLevel): string {
  switch (level) {
    case 'critical':
      return 'text-red-700 dark:text-red-400 font-semibold';
    case 'high':
      return 'text-orange-700 dark:text-orange-400 font-semibold';
    case 'medium':
      return 'text-amber-700 dark:text-amber-400 font-medium';
    default:
      return 'text-slate-600 dark:text-slate-400';
  }
}

function riskLabel(level: SecurityRiskLevel): string {
  switch (level) {
    case 'critical':
      return 'Critical Risk';
    case 'high':
      return 'High Risk';
    case 'medium':
      return 'Medium Risk';
    default:
      return 'Low Risk';
  }
}

const ACTION_LABELS: Record<SecurityAdminActionType, string> = {
  send_warning: 'Send Security Warning',
  restrict_ai: 'Restrict AI Access',
  clear_ai_restriction: 'Lift AI Restriction',
  restrict_messaging: 'Restrict Messaging',
  clear_messaging_restriction: 'Lift Messaging Restriction',
  temp_ban: 'Temporary Account Ban',
  perm_ban: 'Permanent Account Ban',
  reactivate_account: 'Reactivate Account',
  mark_under_investigation: 'Mark Under Investigation',
  resolve_investigation: 'Resolve Investigation',
  update_internal_notes: 'Update Internal Notes',
  review_appeal: 'Appeal Decision',
  update_vip_status: 'Update VIP Entitlement',
};

export function AdminSecurityCenter({ users }: AdminSecurityCenterProps) {
  const { isAdmin } = useFinance();

  const [subTab, setSubTab] = useState<SecuritySubTab>('accounts');
  const [profiles, setProfiles] = useState<SecurityProfile[]>([]);
  const [vipSubsMap, setVipSubsMap] = useState<Record<string, VipSubscription>>({});
  const [aiUsageMap, setAiUsageMap] = useState<Record<string, AiUsageRecord>>({});
  const [casesMap, setCasesMap] = useState<Record<string, SecurityCase>>({});
  const [firestoreEvents, setFirestoreEvents] = useState<SecurityEventRecord[]>([]);
  const [backendEvents, setBackendEvents] = useState<SecurityEventRecord[]>([]);
  const [appeals, setAppeals] = useState<SecurityAppeal[]>([]);
  const [auditLogs, setAuditLogs] = useState<SecurityAuditLog[]>([]);

  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Account filters
  const [accountSearch, setAccountSearch] = useState('');
  const [accountRiskFilter, setAccountRiskFilter] = useState<'all' | SecurityRiskLevel>('all');
  const [accountStatusFilter, setAccountStatusFilter] = useState<
    'all' | 'suspicious' | 'under_investigation' | 'temp_banned' | 'perm_banned' | 'restricted'
  >('suspicious');

  // Event filters
  const [eventUserFilter, setEventUserFilter] = useState('');
  const [eventRiskFilter, setEventRiskFilter] = useState<'all' | SecurityRiskLevel>('all');
  const [eventTypeFilter, setEventTypeFilter] = useState<'all' | SecurityEventType>('all');
  const [eventDateFilter, setEventDateFilter] = useState<DateFilterMode>('all');
  const [eventCustomDate, setEventCustomDate] = useState('');

  // Appeal filters & review modal
  const [appealStatusFilter, setAppealStatusFilter] = useState<'all' | AppealStatus>('pending');
  const [reviewingAppeal, setReviewingAppeal] = useState<SecurityAppeal | null>(null);
  const [appealDecisionStatus, setAppealDecisionStatus] =
    useState<Exclude<AppealStatus, 'pending'>>('approved');
  const [appealDecisionNote, setAppealDecisionNote] = useState('');
  const [appealReactivateOnApprove, setAppealReactivateOnApprove] = useState(true);
  const [appealSendDirectMsg, setAppealSendDirectMsg] = useState(true);
  const [submittingAppealReview, setSubmittingAppealReview] = useState(false);

  // Audit filter
  const [auditSearch, setAuditSearch] = useState('');

  // Inspector & enforcement modal state
  const [inspectedUid, setInspectedUid] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<SecurityAdminActionType>('send_warning');
  const [durationInput, setDurationInput] = useState('24:00:00');
  const [actionReason, setActionReason] = useState('');
  const [sendDirectMsg, setSendDirectMsg] = useState(true);
  const [directMsgText, setDirectMsgText] = useState('');
  const [permConfirmChecked, setPermConfirmChecked] = useState(false);
  const [permConfirmText, setPermConfirmText] = useState('');
  const [nextVipTierChoice, setNextVipTierChoice] = useState<VipTier>('gold');
  const [nextBillingCycleChoice, setNextBillingCycleChoice] = useState<BillingCycle>('monthly');
  const [resetAiQuotaOnVipUpdate, setResetAiQuotaOnVipUpdate] = useState(true);
  const [submittingAction, setSubmittingAction] = useState(false);

  // Private admin case notes inside inspector
  const [caseEvidenceSummary, setCaseEvidenceSummary] = useState('');
  const [caseInternalNotes, setCaseInternalNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Live 1-second tick for temporary ban / restriction countdowns
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refreshBackendTelemetry = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingTelemetry(true);
    try {
      const list = await fetchAdminSecurityTelemetry();
      setBackendEvents(list);
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Unable to load backend security telemetry.');
    } finally {
      setLoadingTelemetry(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const unsubs = [
      subscribeAllSecurityProfilesForAdmin(setProfiles, (err) =>
        setErrorMsg((err as Error)?.message || 'Failed to subscribe to security profiles.')
      ),
      subscribeAllVipSubscriptionsForAdmin(setVipSubsMap),
      subscribeAllAiUsageForAdmin(setAiUsageMap),
      subscribeSecurityCasesForAdmin(setCasesMap),
      subscribeSecurityEventsForAdmin(setFirestoreEvents),
      subscribeSecurityAppealsForAdmin(setAppeals),
      subscribeSecurityAuditLogsForAdmin(setAuditLogs),
    ];
    void refreshBackendTelemetry();
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [isAdmin, refreshBackendTelemetry]);

  // Merge Firestore + backend security events chronologically
  const mergedEvents = useMemo(() => {
    const seen = new Set<string>();
    const combined: SecurityEventRecord[] = [];
    for (const ev of [...firestoreEvents, ...backendEvents]) {
      const ts = toMillis(ev.createdAt, ev.createdAtIso);
      const dedupeKey =
        ev.id.startsWith('srv-') || ev.source === 'backend'
          ? ev.id
          : `${ev.userId}:${ev.eventType}:${Math.floor(ts / 3000)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      combined.push(ev);
    }
    combined.sort(
      (a, b) => toMillis(b.createdAt, b.createdAtIso) - toMillis(a.createdAt, a.createdAtIso)
    );
    return combined;
  }, [firestoreEvents, backendEvents]);

  // Build unified account entries combining registered users + securityProfiles + event history
  const unifiedAccounts = useMemo(() => {
    const userById = new Map<string, UserProfile>();
    users.forEach((u) => userById.set(u.uid, u));

    const profileById = new Map<string, SecurityProfile>();
    profiles.forEach((p) => profileById.set(p.userId, p));

    const eventsByUser = new Map<string, SecurityEventRecord[]>();
    mergedEvents.forEach((ev) => {
      const uid = ev.userId || 'anonymous';
      const arr = eventsByUser.get(uid) || [];
      arr.push(ev);
      eventsByUser.set(uid, arr);
    });

    const allUids = new Set<string>();
    users.forEach((u) => allUids.add(u.uid));
    profiles.forEach((p) => allUids.add(p.userId));

    return Array.from(allUids)
      .map((uid) => {
        const userDoc = userById.get(uid) || null;
        const secProfile = profileById.get(uid) || null;
        const userEvents = eventsByUser.get(uid) || [];
        const computed = computeEvidenceRiskScore(userEvents);

        const email = userDoc?.email || secProfile?.userEmail || userEvents[0]?.userEmail || '—';
        const displayName = userDoc?.displayName || secProfile?.displayName || 'FinTrack User';
        const isSelfAdmin = email.toLowerCase() === ADMIN_EMAIL;

        const banExpiresMs = toMillis(secProfile?.banExpiresAt);
        const aiRestrictedMs = toMillis(secProfile?.aiRestrictedUntil);
        const msgRestrictedMs = toMillis(secProfile?.messagingRestrictedUntil);

        const isPermBanned =
          secProfile?.banType === 'permanent' || secProfile?.restrictionStatus === 'perm_banned';
        const isTempBanned =
          !isPermBanned &&
          secProfile?.banType === 'temporary' &&
          banExpiresMs > nowMs;
        const isUnderInvestigation =
          Boolean(secProfile?.underInvestigation) ||
          secProfile?.restrictionStatus === 'under_investigation';
        const isAiRestricted = aiRestrictedMs > nowMs;
        const isMessagingRestricted = msgRestrictedMs > nowMs;
        const isDeactivated = userDoc?.accountStatus === 'deactivated';

        const effectiveRiskScore = Math.max(secProfile?.riskScore || 0, computed.riskScore);
        const effectiveRiskLevel: SecurityRiskLevel =
          effectiveRiskScore >= 85
            ? 'critical'
            : effectiveRiskScore >= 60
            ? 'high'
            : effectiveRiskScore >= 30
            ? 'medium'
            : secProfile?.riskLevel || computed.riskLevel;

        const totalEvents = Math.max(secProfile?.eventCount || 0, userEvents.length);
        const isSuspicious =
          totalEvents > 0 ||
          effectiveRiskScore > 0 ||
          isUnderInvestigation ||
          isTempBanned ||
          isPermBanned ||
          isAiRestricted ||
          isMessagingRestricted ||
          isDeactivated ||
          (secProfile?.warningCount || 0) > 0;

        const vipSub = vipSubsMap[uid] || null;
        const aiUsage = aiUsageMap[uid] || null;
        const resolvedVipTier: VipTier = isSelfAdmin
          ? 'diamond'
          : vipSub && isVipTier(vipSub.tier) && vipSub.status !== 'expired'
          ? vipSub.tier
          : secProfile?.vipStatus === 'vip'
          ? 'gold'
          : 'starter';
        const resolvedTierConfig = VIP_TIER_CONFIGS[resolvedVipTier];

        return {
          uid,
          email,
          displayName,
          isSelfAdmin,
          userDoc,
          secProfile,
          vipSub,
          aiUsage,
          resolvedVipTier,
          resolvedTierConfig,
          userEvents,
          totalEvents,
          effectiveRiskScore,
          effectiveRiskLevel,
          isPermBanned,
          isTempBanned,
          banExpiresMs,
          isUnderInvestigation,
          isAiRestricted,
          aiRestrictedMs,
          isMessagingRestricted,
          msgRestrictedMs,
          isDeactivated,
          isSuspicious,
          lastEventMs: Math.max(
            toMillis(secProfile?.lastEventAt),
            userEvents[0] ? toMillis(userEvents[0].createdAt, userEvents[0].createdAtIso) : 0
          ),
        };
      })
      .sort((a, b) => {
        if (a.isPermBanned !== b.isPermBanned) return a.isPermBanned ? -1 : 1;
        if (a.isTempBanned !== b.isTempBanned) return a.isTempBanned ? -1 : 1;
        if (b.effectiveRiskScore !== a.effectiveRiskScore) {
          return b.effectiveRiskScore - a.effectiveRiskScore;
        }
        return b.lastEventMs - a.lastEventMs;
      });
  }, [users, profiles, vipSubsMap, aiUsageMap, mergedEvents, nowMs]);

  const kpis = useMemo(() => {
    const suspiciousAccounts = unifiedAccounts.filter(
      (a) => !a.isSelfAdmin && a.isSuspicious
    ).length;
    const underInvestigation = unifiedAccounts.filter(
      (a) => !a.isSelfAdmin && a.isUnderInvestigation
    ).length;
    const activeTempBans = unifiedAccounts.filter((a) => !a.isSelfAdmin && a.isTempBanned).length;
    const permBans = unifiedAccounts.filter((a) => !a.isSelfAdmin && a.isPermBanned).length;
    const pendingAppeals = appeals.filter(
      (a) => a.status === 'pending' || a.status === 'under_review'
    ).length;
    return { suspiciousAccounts, underInvestigation, activeTempBans, permBans, pendingAppeals };
  }, [unifiedAccounts, appeals]);

  const filteredAccounts = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    return unifiedAccounts.filter((a) => {
      if (accountStatusFilter === 'suspicious' && !a.isSuspicious) return false;
      if (accountStatusFilter === 'under_investigation' && !a.isUnderInvestigation) return false;
      if (accountStatusFilter === 'temp_banned' && !a.isTempBanned) return false;
      if (accountStatusFilter === 'perm_banned' && !a.isPermBanned) return false;
      if (
        accountStatusFilter === 'restricted' &&
        !a.isAiRestricted &&
        !a.isMessagingRestricted &&
        !a.isDeactivated
      ) {
        return false;
      }
      if (accountRiskFilter !== 'all' && a.effectiveRiskLevel !== accountRiskFilter) return false;
      if (!q) return true;
      return (
        a.uid.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.displayName.toLowerCase().includes(q)
      );
    });
  }, [unifiedAccounts, accountSearch, accountStatusFilter, accountRiskFilter]);

  const filteredEvents = useMemo(() => {
    const q = eventUserFilter.trim().toLowerCase();
    const todayKey = toLocalDateKey(nowMs);
    return mergedEvents.filter((ev) => {
      if (eventRiskFilter !== 'all' && ev.riskLevel !== eventRiskFilter) return false;
      if (eventTypeFilter !== 'all' && ev.eventType !== eventTypeFilter) return false;

      const evMs = toMillis(ev.createdAt, ev.createdAtIso);
      if (eventDateFilter === 'today') {
        if (toLocalDateKey(evMs) !== todayKey) return false;
      } else if (eventDateFilter === '7d') {
        if (!evMs || nowMs - evMs > 7 * 24 * 3600 * 1000) return false;
      } else if (eventDateFilter === '30d') {
        if (!evMs || nowMs - evMs > 30 * 24 * 3600 * 1000) return false;
      } else if (eventDateFilter === 'custom' && eventCustomDate) {
        if (toLocalDateKey(evMs) !== eventCustomDate) return false;
      }

      if (!q) return true;
      return (
        (ev.userId || '').toLowerCase().includes(q) ||
        (ev.userEmail || '').toLowerCase().includes(q) ||
        (ev.summary || '').toLowerCase().includes(q) ||
        (ev.evidence || '').toLowerCase().includes(q)
      );
    });
  }, [
    mergedEvents,
    eventUserFilter,
    eventRiskFilter,
    eventTypeFilter,
    eventDateFilter,
    eventCustomDate,
    nowMs,
  ]);

  const filteredAppeals = useMemo(() => {
    return appeals.filter((ap) =>
      appealStatusFilter === 'all' ? true : ap.status === appealStatusFilter
    );
  }, [appeals, appealStatusFilter]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (log) =>
        (log.targetUserId || '').toLowerCase().includes(q) ||
        (log.targetUserEmail || '').toLowerCase().includes(q) ||
        (log.actionType || '').toLowerCase().includes(q) ||
        (log.reason || '').toLowerCase().includes(q)
    );
  }, [auditLogs, auditSearch]);

  const inspectedAccount = useMemo(
    () => unifiedAccounts.find((a) => a.uid === inspectedUid) || null,
    [unifiedAccounts, inspectedUid]
  );

  const openInspector = (uid: string, defaultAction: SecurityAdminActionType = 'send_warning') => {
    const existingCase = casesMap[uid];
    const targetAcc = unifiedAccounts.find((a) => a.uid === uid);
    setInspectedUid(uid);
    setSelectedAction(defaultAction);
    setDurationInput(defaultAction === 'restrict_ai' || defaultAction === 'restrict_messaging' ? '06:00:00' : '24:00:00');
    setActionReason('');
    setSendDirectMsg(true);
    setDirectMsgText('');
    setPermConfirmChecked(false);
    setPermConfirmText('');
    setNextVipTierChoice(targetAcc?.resolvedVipTier || 'gold');
    setNextBillingCycleChoice(targetAcc?.vipSub?.billingCycle || 'monthly');
    setResetAiQuotaOnVipUpdate(true);
    setCaseEvidenceSummary(existingCase?.evidenceSummary || '');
    setCaseInternalNotes(existingCase?.internalNotes || '');
    setErrorMsg('');
    setFeedbackMsg('');
  };

  const durationValidation = useMemo(() => parseDurationHhMmSs(durationInput), [durationInput]);

  const needsDuration =
    selectedAction === 'temp_ban' ||
    selectedAction === 'restrict_ai' ||
    selectedAction === 'restrict_messaging';

  const handleExecuteAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectedAccount) return;
    if (inspectedAccount.isSelfAdmin) {
      setErrorMsg('Administrator account cannot be restricted or banned.');
      return;
    }

    if (needsDuration && !durationValidation.valid) {
      setErrorMsg(durationValidation.error || 'Enter a valid hh:mm:ss duration.');
      return;
    }
    if (selectedAction === 'perm_ban') {
      if (actionReason.trim().length < 5) {
        setErrorMsg('Documented reason (minimum 5 characters) is required for permanent bans.');
        return;
      }
      if (!permConfirmChecked || permConfirmText.trim() !== 'PERMANENT BAN') {
        setErrorMsg('Please confirm the checkbox and type PERMANENT BAN to authorize a permanent ban.');
        return;
      }
    }

    setSubmittingAction(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      const targetUser: UserProfile = inspectedAccount.userDoc || {
        uid: inspectedAccount.uid,
        email: inspectedAccount.email,
        displayName: inspectedAccount.displayName,
        currency: 'INR',
        theme: 'light',
        monthlyBudgetLimit: 0,
      };

      await executeSecurityAdminAction({
        targetUser,
        existingProfile: inspectedAccount.secProfile,
        actionType: selectedAction,
        reason:
          actionReason.trim() ||
          `${ACTION_LABELS[selectedAction]} applied after FinTrack security review.`,
        durationMs: needsDuration ? durationValidation.ms : 0,
        durationLabel: needsDuration ? durationValidation.normalized : '',
        sendDirectMessage: sendDirectMsg,
        directMessageText: directMsgText.trim() || actionReason.trim(),
        nextVipStatus: nextVipTierChoice === 'starter' ? 'none' : 'vip',
        nextVipTier: nextVipTierChoice,
        nextBillingCycle: nextBillingCycleChoice,
        resetAiQuota: resetAiQuotaOnVipUpdate,
        riskScoreOverride: inspectedAccount.effectiveRiskScore,
        riskLevelOverride: inspectedAccount.effectiveRiskLevel,
      });

      setFeedbackMsg(
        `${ACTION_LABELS[selectedAction]} applied to ${inspectedAccount.email}. Audit log updated.`
      );
      setPermConfirmChecked(false);
      setPermConfirmText('');
      setActionReason('');
      setDirectMsgText('');
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Failed to apply security action.');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSaveCaseNotes = async () => {
    if (!inspectedAccount) return;
    setSavingNotes(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      await saveSecurityCaseNotes({
        targetUid: inspectedAccount.uid,
        targetEmail: inspectedAccount.email,
        internalNotes: caseInternalNotes,
        evidenceSummary: caseEvidenceSummary,
      });
      setFeedbackMsg('Private administrator case notes saved.');
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Failed to save internal case notes.');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleReviewAppealSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingAppeal) return;
    setSubmittingAppealReview(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      const targetUser = users.find((u) => u.uid === reviewingAppeal.userId) || null;
      await reviewSecurityAppeal({
        appeal: reviewingAppeal,
        targetUser,
        status: appealDecisionStatus,
        adminDecisionNote: appealDecisionNote,
        reactivateOnApprove: appealReactivateOnApprove,
        sendDirectMessage: appealSendDirectMsg,
      });
      setFeedbackMsg(
        `Appeal for ${reviewingAppeal.userEmail} marked "${appealDecisionStatus}".`
      );
      setReviewingAppeal(null);
      setAppealDecisionNote('');
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Unable to submit appeal decision.');
    } finally {
      setSubmittingAppealReview(false);
    }
  };

  const handleEventStatusChange = async (
    ev: SecurityEventRecord,
    nextStatus: 'reviewed' | 'dismissed'
  ) => {
    if (ev.id.startsWith('srv-') || ev.source === 'backend') return;
    try {
      await updateSecurityEventStatus(ev.id, nextStatus);
      setFeedbackMsg(`Event marked as ${nextStatus}.`);
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Could not update event status.');
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Suspicious Accounts</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
              {kpis.suspiciousAccounts}
            </div>
          </div>
          <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Under Investigation</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1">
              {kpis.underInvestigation}
            </div>
          </div>
          <Eye className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Active Temp Bans</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-orange-600 dark:text-orange-400 mt-1">
              {kpis.activeTempBans}
            </div>
          </div>
          <Clock className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Permanent Bans</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400 mt-1">
              {kpis.permBans}
            </div>
          </div>
          <Ban className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Pending Appeals</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-blue-600 dark:text-blue-400 mt-1">
              {kpis.pendingAppeals}
            </div>
          </div>
          <Gavel className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
        </div>
      </div>

      {/* False Positive Protection Guidance Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="text-xs text-slate-600 dark:text-slate-300">
          <span className="font-semibold text-slate-900 dark:text-white">
            Evidence-First Policy:
          </span>{' '}
          Normal VPN switches, multiple personal devices, unusual spending totals, and 1–2 isolated login typos are ignored. Permanent bans require manual admin verification and never delete user financial records.
        </div>
        <button
          type="button"
          onClick={() => void refreshBackendTelemetry()}
          disabled={loadingTelemetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingTelemetry ? 'animate-spin' : ''}`} />
          <span>{loadingTelemetry ? 'Syncing Telemetry...' : 'Sync Backend Telemetry'}</span>
        </button>
      </div>

      {feedbackMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Sub-Navigation */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 w-fit">
        {(
          [
            { id: 'accounts', label: 'Suspicious Accounts & Enforcement' },
            { id: 'events', label: `Activity Feed (${mergedEvents.length})` },
            { id: 'appeals', label: `Appeals Queue (${kpis.pendingAppeals} open)` },
            { id: 'audit', label: 'Admin Audit Log' },
          ] as { id: SecuritySubTab; label: string }[]
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              subTab === tab.id
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: Suspicious Accounts & Enforcement */}
      {subTab === 'accounts' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={accountSearch}
                onChange={(e) => setAccountSearch(e.target.value)}
                placeholder="Search by User ID, email, or name..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={accountStatusFilter}
                onChange={(e) =>
                  setAccountStatusFilter(e.target.value as typeof accountStatusFilter)
                }
                aria-label="Filter by enforcement status"
                className="px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
              >
                <option value="suspicious">Flagged / Restricted Only</option>
                <option value="all">All Registered Accounts</option>
                <option value="under_investigation">Under Investigation</option>
                <option value="temp_banned">Temporary Bans</option>
                <option value="perm_banned">Permanent Bans</option>
                <option value="restricted">AI / Messaging / Deactivated</option>
              </select>

              <select
                value={accountRiskFilter}
                onChange={(e) =>
                  setAccountRiskFilter(e.target.value as typeof accountRiskFilter)
                }
                aria-label="Filter by risk level"
                className="px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
              >
                <option value="all">All Risk Levels</option>
                <option value="critical">Critical Risk</option>
                <option value="high">High Risk</option>
                <option value="medium">Medium Risk</option>
                <option value="low">Low Risk</option>
              </select>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {filteredAccounts.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <ShieldCheck className="w-7 h-7 text-emerald-600 mx-auto" />
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  No accounts match the selected filter
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Switch filter to &quot;All Registered Accounts&quot; to inspect or enforce rules on any signed-up FinTrack user.
                </p>
                {accountStatusFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setAccountStatusFilter('all')}
                    className="mt-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    Show All Accounts
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/80 dark:bg-slate-950/50">
                      <th className="py-3 px-4">Account &amp; User ID</th>
                      <th className="py-3 px-4">Enforcement Status</th>
                      <th className="py-3 px-4">Risk &amp; Score</th>
                      <th className="py-3 px-4">Events / Warnings</th>
                      <th className="py-3 px-4">Active Restrictions</th>
                      <th className="py-3 px-4">Last Event</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {filteredAccounts.map((acc) => {
                      const remainingBanMs = acc.isTempBanned
                        ? Math.max(0, acc.banExpiresMs - nowMs)
                        : 0;
                      return (
                        <tr
                          key={acc.uid}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {acc.displayName}
                            </div>
                            <div className="text-slate-600 dark:text-slate-300">{acc.email}</div>
                            <div className="font-mono text-[11px] text-slate-400 truncate max-w-[200px]">
                              {acc.uid}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {acc.isPermBanned ? (
                              <span className="text-red-700 dark:text-red-400 font-semibold">
                                Permanent Ban
                              </span>
                            ) : acc.isTempBanned ? (
                              <div className="space-y-0.5">
                                <div className="text-orange-700 dark:text-orange-400 font-semibold">
                                  Temp Ban
                                </div>
                                <div className="font-mono tabular-nums text-[11px] text-slate-500">
                                  {formatDurationHhMmSs(remainingBanMs)} left
                                </div>
                              </div>
                            ) : acc.isUnderInvestigation ? (
                              <span className="text-amber-700 dark:text-amber-400 font-semibold">
                                Under Investigation
                              </span>
                            ) : acc.isDeactivated ? (
                              <span className="text-red-600 dark:text-red-400 font-medium">
                                Deactivated
                              </span>
                            ) : (
                              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                Active
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className={riskTextClass(acc.effectiveRiskLevel)}>
                              {riskLabel(acc.effectiveRiskLevel)}
                            </div>
                            <div className="font-mono tabular-nums text-[11px] text-slate-500">
                              Score {acc.effectiveRiskScore}/100
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {acc.totalEvents} events · {acc.secProfile?.warningCount || 0} warn
                          </td>
                          <td className="py-3 px-4 text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              {acc.resolvedTierConfig.classLabel} · {acc.resolvedTierConfig.badgeLabel}
                            </div>
                            <div className="font-mono tabular-nums text-[10px] text-slate-500">
                              {acc.resolvedTierConfig.insightsLimit > 0
                                ? `AI ${acc.aiUsage?.insightsUsed ?? 0}/${acc.resolvedTierConfig.insightsLimit}`
                                : 'No AI'}
                              {acc.resolvedTierConfig.advisorLimit > 0
                                ? ` · Chat ${acc.aiUsage?.advisorUsed ?? 0}/${acc.resolvedTierConfig.advisorLimit}`
                                : ''}
                              {acc.isAiRestricted ? ' · AI Blocked' : ''}
                              {acc.isMessagingRestricted ? ' · Msg Blocked' : ''}
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                            {formatDateTime(acc.lastEventMs)}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {acc.isSelfAdmin ? (
                              <span className="text-[11px] text-slate-400">Protected Admin</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openInspector(acc.uid)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-[11px] font-semibold hover:opacity-90 whitespace-nowrap shrink-0"
                              >
                                <ShieldAlert className="w-3.5 h-3.5" />
                                Inspect &amp; Enforce
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Suspicious Activity Feed */}
      {subTab === 'events' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={eventUserFilter}
                onChange={(e) => setEventUserFilter(e.target.value)}
                placeholder="Search by User ID, email, or evidence..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
            </div>

            <select
              value={eventRiskFilter}
              onChange={(e) => setEventRiskFilter(e.target.value as typeof eventRiskFilter)}
              aria-label="Filter events by risk level"
              className="px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
            >
              <option value="all">All Risk Levels</option>
              <option value="critical">Critical Risk</option>
              <option value="high">High Risk</option>
              <option value="medium">Medium Risk</option>
              <option value="low">Low Risk</option>
            </select>

            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value as typeof eventTypeFilter)}
              aria-label="Filter events by activity type"
              className="px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
            >
              <option value="all">All Activity Types</option>
              {(Object.keys(EVENT_LABELS) as SecurityEventType[]).map((key) => (
                <option key={key} value={key}>
                  {EVENT_LABELS[key]}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-2">
              <select
                value={eventDateFilter}
                onChange={(e) => setEventDateFilter(e.target.value as DateFilterMode)}
                aria-label="Filter events by date"
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="custom">Specific Date</option>
              </select>
              {eventDateFilter === 'custom' && (
                <input
                  type="date"
                  value={eventCustomDate}
                  onChange={(e) => setEventCustomDate(e.target.value)}
                  className="px-2 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {filteredEvents.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                No suspicious activity events match your current filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/80 dark:bg-slate-950/50">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">User ID &amp; Email</th>
                      <th className="py-3 px-4">Activity &amp; Category</th>
                      <th className="py-3 px-4">Risk</th>
                      <th className="py-3 px-4">Evidence</th>
                      <th className="py-3 px-4 text-right">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {filteredEvents.map((ev) => {
                      const evMs = toMillis(ev.createdAt, ev.createdAtIso);
                      const isServerEvent = ev.id.startsWith('srv-') || ev.source === 'backend';
                      const canInspectUser = Boolean(
                        ev.userId &&
                          ev.userId !== 'anonymous' &&
                          (ev.userEmail || '').toLowerCase() !== ADMIN_EMAIL
                      );
                      return (
                        <tr
                          key={ev.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-3 px-4 font-mono tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                            {formatDateTime(evMs)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900 dark:text-white">
                              {ev.userEmail || 'Unknown'}
                            </div>
                            <div className="font-mono text-[11px] text-slate-400 truncate max-w-[180px]">
                              {ev.userId || 'anonymous'}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {EVENT_LABELS[ev.eventType] || ev.eventType}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {CATEGORY_LABELS[ev.category] || ev.category} · {ev.source}
                            </div>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <div className={riskTextClass(ev.riskLevel)}>{riskLabel(ev.riskLevel)}</div>
                            <div className="font-mono tabular-nums text-[11px] text-slate-500">
                              +{ev.riskScore} pts
                            </div>
                          </td>
                          <td className="py-3 px-4 max-w-xs">
                            <div className="text-slate-800 dark:text-slate-200">{ev.summary}</div>
                            {ev.evidence && (
                              <div className="font-mono text-[11px] text-slate-500 truncate">
                                {ev.evidence}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {canInspectUser && (
                                <button
                                  type="button"
                                  onClick={() => openInspector(ev.userId)}
                                  className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                                >
                                  Inspect
                                </button>
                              )}
                              {!isServerEvent && ev.status === 'open' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void handleEventStatusChange(ev, 'reviewed')}
                                    className="px-2.5 py-1 rounded-md border border-emerald-200 dark:border-emerald-800 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                                  >
                                    Mark Reviewed
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleEventStatusChange(ev, 'dismissed')}
                                    className="px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                                  >
                                    Dismiss
                                  </button>
                                </>
                              )}
                              {(isServerEvent || ev.status !== 'open') && (
                                <span className="text-[11px] text-slate-400 capitalize">
                                  {ev.status}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: Appeals Queue */}
      {subTab === 'appeals' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 w-fit">
              {(['pending', 'under_review', 'approved', 'rejected', 'all'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setAppealStatusFilter(st)}
                  className={`px-3 py-1 rounded-md text-xs font-medium capitalize whitespace-nowrap shrink-0 ${
                    appealStatusFilter === st
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {st.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
            {filteredAppeals.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                No appeals found in this queue.
              </div>
            ) : (
              filteredAppeals.map((ap) => (
                <div
                  key={ap.id}
                  className="p-5 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4"
                >
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-slate-900 dark:text-white">
                        {ap.userEmail}
                      </span>
                      <span aria-hidden="true" className="text-slate-400">
                        ·
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">{ap.userId}</span>
                      <span aria-hidden="true" className="text-slate-400">
                        ·
                      </span>
                      <span className="capitalize font-semibold text-orange-700 dark:text-orange-400">
                        {ap.banType} ban
                      </span>
                      <span aria-hidden="true" className="text-slate-400">
                        ·
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-500">
                        {formatDateTime(toMillis(ap.createdAt))}
                      </span>
                    </div>

                    <div className="text-xs text-slate-700 dark:text-slate-300">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        Appeal Reason:
                      </span>{' '}
                      {ap.appealReason}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">
                      {ap.explanation}
                    </p>
                    {ap.banReason && (
                      <div className="text-[11px] text-slate-500">
                        Original restriction reason: {ap.banReason}
                      </div>
                    )}
                    {ap.adminDecisionNote && (
                      <div className="text-xs text-emerald-700 dark:text-emerald-300 pt-1">
                        Admin Note ({ap.status.replace('_', ' ')}): {ap.adminDecisionNote}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openInspector(ap.userId)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      View Evidence
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReviewingAppeal(ap);
                        setAppealDecisionStatus('approved');
                        setAppealDecisionNote(ap.adminDecisionNote || '');
                        setAppealReactivateOnApprove(true);
                        setAppealSendDirectMsg(true);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 whitespace-nowrap"
                    >
                      Review Appeal
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: Admin Audit Log */}
      {subTab === 'audit' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Search audit log by UID, email, action, or reason..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {filteredAuditLogs.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                No administrative audit entries recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/80 dark:bg-slate-950/50">
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Target User</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Duration</th>
                      <th className="py-3 px-4">Reason &amp; Details</th>
                      <th className="py-3 px-4">Admin</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {filteredAuditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                          {formatDateTime(toMillis(log.createdAt))}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900 dark:text-white">
                            {log.targetUserEmail}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">
                            {log.targetUserId}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {ACTION_LABELS[log.actionType] || log.actionType}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                          {log.durationLabel || '—'}
                        </td>
                        <td className="py-3 px-4 max-w-md">
                          <div className="text-slate-800 dark:text-slate-200">{log.reason}</div>
                          {log.details && (
                            <div className="text-[11px] text-slate-500">{log.details}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {log.adminEmail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Account Inspector & Enforcement Modal */}
      {inspectedAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Security Inspector · {inspectedAccount.displayName}
                  </h3>
                  <span className="text-xs text-slate-500">·</span>
                  <span className={`text-xs ${riskTextClass(inspectedAccount.effectiveRiskLevel)}`}>
                    {riskLabel(inspectedAccount.effectiveRiskLevel)} (
                    <span className="font-mono tabular-nums">
                      {inspectedAccount.effectiveRiskScore}/100
                    </span>
                    )
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                  {inspectedAccount.email} · UID: {inspectedAccount.uid}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectedUid(null)}
                aria-label="Close Inspector"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Enforcement Actions + Private Case Notes */}
              <div className="lg:col-span-7 space-y-6">
                {/* Live Account Status Summary */}
                <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-x-4 gap-y-1 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <span>
                    Ban:{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {inspectedAccount.isPermBanned
                        ? 'Permanent'
                        : inspectedAccount.isTempBanned
                        ? `Temporary (${formatDurationHhMmSs(
                            inspectedAccount.banExpiresMs - nowMs
                          )})`
                        : 'None'}
                    </strong>
                  </span>
                  <span>
                    AI Access:{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {inspectedAccount.isAiRestricted
                        ? `Restricted (${formatDurationHhMmSs(
                            inspectedAccount.aiRestrictedMs - nowMs
                          )})`
                        : 'Allowed'}
                    </strong>
                  </span>
                  <span>
                    Messaging:{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {inspectedAccount.isMessagingRestricted
                        ? `Restricted (${formatDurationHhMmSs(
                            inspectedAccount.msgRestrictedMs - nowMs
                          )})`
                        : 'Allowed'}
                    </strong>
                  </span>
                  <span>
                    Plan:{' '}
                    <strong className="text-slate-900 dark:text-white">
                      {inspectedAccount.resolvedTierConfig.classLabel} ·{' '}
                      {inspectedAccount.resolvedTierConfig.badgeLabel}
                    </strong>
                    {inspectedAccount.vipSub?.billingCycle
                      ? ` (${inspectedAccount.vipSub.billingCycle})`
                      : ''}
                  </span>
                  <span>
                    AI Usage:{' '}
                    <strong className="font-mono tabular-nums text-slate-900 dark:text-white">
                      {inspectedAccount.aiUsage?.insightsUsed ?? 0}/
                      {inspectedAccount.resolvedTierConfig.insightsLimit} Insights ·{' '}
                      {inspectedAccount.aiUsage?.advisorUsed ?? 0}/
                      {inspectedAccount.resolvedTierConfig.advisorLimit} Advisor
                    </strong>
                  </span>
                </div>

                {/* Action Form */}
                <form onSubmit={handleExecuteAction} className="space-y-4">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white mb-2">
                      Select Administrator Action
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {(
                        [
                          { id: 'send_warning', label: 'Send Warning', icon: AlertTriangle },
                          { id: 'restrict_ai', label: 'Restrict AI', icon: BotOff },
                          { id: 'restrict_messaging', label: 'Restrict Msg', icon: MessageSquareOff },
                          {
                            id: inspectedAccount.isUnderInvestigation
                              ? 'resolve_investigation'
                              : 'mark_under_investigation',
                            label: inspectedAccount.isUnderInvestigation
                              ? 'Resolve Case'
                              : 'Investigate',
                            icon: Eye,
                          },
                          { id: 'temp_ban', label: 'Temp Ban', icon: Clock },
                          { id: 'perm_ban', label: 'Permanent Ban', icon: Ban },
                          { id: 'reactivate_account', label: 'Reactivate', icon: UserCheck },
                          { id: 'update_vip_status', label: 'VIP Status', icon: Crown },
                          ...(inspectedAccount.isAiRestricted
                            ? [
                                {
                                  id: 'clear_ai_restriction' as const,
                                  label: 'Lift AI Block',
                                  icon: ShieldCheck,
                                },
                              ]
                            : []),
                          ...(inspectedAccount.isMessagingRestricted
                            ? [
                                {
                                  id: 'clear_messaging_restriction' as const,
                                  label: 'Lift Msg Block',
                                  icon: ShieldCheck,
                                },
                              ]
                            : []),
                        ] as {
                          id: SecurityAdminActionType;
                          label: string;
                          icon: React.ComponentType<{ className?: string }>;
                        }[]
                      ).map((opt) => {
                        const Icon = opt.icon;
                        const active = selectedAction === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setSelectedAction(opt.id);
                              if (opt.id === 'temp_ban') setDurationInput('24:00:00');
                              if (opt.id === 'restrict_ai' || opt.id === 'restrict_messaging') {
                                setDurationInput('06:00:00');
                              }
                              setErrorMsg('');
                            }}
                            className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap ${
                              active
                                ? opt.id === 'perm_ban' || opt.id === 'temp_ban'
                                  ? 'bg-red-600 border-red-600 text-white'
                                  : 'bg-slate-900 dark:bg-emerald-600 border-slate-900 dark:border-emerald-600 text-white'
                                : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Duration Selector for Temp Ban / AI Restriction / Messaging Restriction */}
                  {needsDuration && (
                    <div className="space-y-2">
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Duration (hh:mm:ss)
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {(selectedAction === 'temp_ban'
                          ? TEMP_BAN_DURATION_PRESETS
                          : RESTRICTION_DURATION_PRESETS
                        ).map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => setDurationInput(preset.hhmmss)}
                            className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold font-mono tabular-nums ${
                              durationInput === preset.hhmmss
                                ? 'bg-slate-900 dark:bg-emerald-600 text-white border-transparent'
                                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                          >
                            {preset.label} ({preset.hhmmss})
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={durationInput}
                        onChange={(e) => setDurationInput(e.target.value)}
                        placeholder="hh:mm:ss (e.g., 24:00:00 or 02:30:00)"
                        className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                      />
                      {!durationValidation.valid && (
                        <p className="text-[11px] text-red-600 dark:text-red-400">
                          {durationValidation.error}
                        </p>
                      )}
                    </div>
                  )}

                  {/* VIP Tier Selector */}
                  {selectedAction === 'update_vip_status' && (
                    <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                      <div className="grid sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                            VIP Membership Class
                          </label>
                          <select
                            value={nextVipTierChoice}
                            onChange={(e) => setNextVipTierChoice(e.target.value as VipTier)}
                            className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                          >
                            {VIP_TIER_ORDER.map((tierId) => {
                              const cfg = VIP_TIER_CONFIGS[tierId];
                              return (
                                <option key={tierId} value={tierId}>
                                  {cfg.classLabel} · {cfg.name} (₹{cfg.pricesInr.monthly}/mo)
                                </option>
                              );
                            })}
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                            Billing Cycle
                          </label>
                          <select
                            value={nextBillingCycleChoice}
                            onChange={(e) =>
                              setNextBillingCycleChoice(e.target.value as BillingCycle)
                            }
                            className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                          >
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly</option>
                            <option value="yearly">Yearly</option>
                          </select>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={resetAiQuotaOnVipUpdate}
                          onChange={(e) => setResetAiQuotaOnVipUpdate(e.target.checked)}
                        />
                        <span>
                          Reset monthly AI usage counter immediately to new plan allowance (
                          {VIP_TIER_CONFIGS[nextVipTierChoice].insightsLimit} Insights /{' '}
                          {VIP_TIER_CONFIGS[nextVipTierChoice].advisorLimit} Advisor)
                        </span>
                      </label>
                    </div>
                  )}

                  {/* Documented Reason */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Documented Reason {selectedAction === 'perm_ban' ? '*' : '(Optional)'}
                    </label>
                    <input
                      type="text"
                      maxLength={500}
                      required={selectedAction === 'perm_ban'}
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                      placeholder="Explain the security evidence or administrative reason..."
                      className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>

                  {/* Permanent Ban Explicit Safeguards */}
                  {selectedAction === 'perm_ban' && (
                    <div className="p-3.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/20 space-y-3 text-xs">
                      <div className="text-red-800 dark:text-red-300 font-semibold">
                        Permanent Ban Safeguard — User Data Preserved
                      </div>
                      <p className="text-red-700 dark:text-red-300/90 leading-relaxed">
                        This permanently blocks protected workspace features and APIs while keeping the user&apos;s Firebase account, transactions, and evidence intact for audit and appeal review.
                      </p>
                      <label className="flex items-start gap-2 text-slate-800 dark:text-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={permConfirmChecked}
                          onChange={(e) => setPermConfirmChecked(e.target.checked)}
                          className="mt-0.5"
                        />
                        <span>
                          I have manually reviewed the evidence and confirm this permanent ban.
                        </span>
                      </label>
                      <input
                        type="text"
                        value={permConfirmText}
                        onChange={(e) => setPermConfirmText(e.target.value)}
                        placeholder='Type "PERMANENT BAN" to confirm'
                        className="w-full px-3 py-2 text-xs font-mono rounded-lg bg-white dark:bg-slate-950 border border-red-300 dark:border-red-800 text-slate-900 dark:text-white"
                      />
                    </div>
                  )}

                  {/* Direct Explanation Message Option */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sendDirectMsg}
                        onChange={(e) => setSendDirectMsg(e.target.checked)}
                      />
                      <span>
                        Send direct pop-up message to user explaining this action (visible even if banned)
                      </span>
                    </label>
                    {sendDirectMsg && (
                      <textarea
                        rows={2}
                        maxLength={1500}
                        value={directMsgText}
                        onChange={(e) => setDirectMsgText(e.target.value)}
                        placeholder="Optional custom explanation message (defaults to documented reason above)..."
                        className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                      />
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={submittingAction}
                      className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 ${
                        selectedAction === 'perm_ban' || selectedAction === 'temp_ban'
                          ? 'bg-red-600 hover:bg-red-700'
                          : 'bg-slate-900 dark:bg-emerald-600 hover:opacity-90'
                      }`}
                    >
                      {submittingAction && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>
                        {submittingAction
                          ? 'Applying Action...'
                          : `Execute: ${ACTION_LABELS[selectedAction]}`}
                      </span>
                    </button>
                  </div>
                </form>

                {/* Private Internal Admin Case Notes */}
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                    <FileText className="w-4 h-4 text-slate-500" />
                    <span>Private Internal Admin Notes (Never Visible to Users)</span>
                  </div>
                  <input
                    type="text"
                    maxLength={2000}
                    value={caseEvidenceSummary}
                    onChange={(e) => setCaseEvidenceSummary(e.target.value)}
                    placeholder="Concise evidence summary..."
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                  <textarea
                    rows={3}
                    maxLength={3000}
                    value={caseInternalNotes}
                    onChange={(e) => setCaseInternalNotes(e.target.value)}
                    placeholder="Internal investigation notes, false-positive checks, review context..."
                    className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      disabled={savingNotes}
                      onClick={() => void handleSaveCaseNotes()}
                      className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      {savingNotes ? 'Saving Notes...' : 'Save Internal Notes'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: User Evidence & Audit History */}
              <div className="lg:col-span-5 space-y-4 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 pt-4 lg:pt-0 lg:pl-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                    <History className="w-4 h-4 text-slate-500" />
                    <span>Evidence &amp; Event History ({inspectedAccount.userEvents.length})</span>
                  </div>
                </div>

                {inspectedAccount.userEvents.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    No suspicious activity events recorded for this account.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[360px] overflow-y-auto pr-1">
                    {inspectedAccount.userEvents.map((ev) => (
                      <div key={ev.id} className="py-2.5 space-y-1 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {EVENT_LABELS[ev.eventType] || ev.eventType}
                          </span>
                          <span className={riskTextClass(ev.riskLevel)}>
                            {ev.riskLevel.toUpperCase()}
                          </span>
                        </div>
                        <div className="text-slate-700 dark:text-slate-300">{ev.summary}</div>
                        {ev.evidence && (
                          <div className="font-mono text-[11px] text-slate-500 break-words">
                            {ev.evidence}
                          </div>
                        )}
                        <div className="font-mono tabular-nums text-[11px] text-slate-400">
                          {formatDateTime(toMillis(ev.createdAt, ev.createdAtIso))} · {ev.source}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    Recent Admin Actions on Account
                  </div>
                  {auditLogs.filter((l) => l.targetUserId === inspectedAccount.uid).length === 0 ? (
                    <p className="text-xs text-slate-500">No prior admin actions recorded.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-48 overflow-y-auto text-xs">
                      {auditLogs
                        .filter((l) => l.targetUserId === inspectedAccount.uid)
                        .slice(0, 10)
                        .map((log) => (
                          <div key={log.id} className="py-2 space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {ACTION_LABELS[log.actionType] || log.actionType}
                              </span>
                              <span className="font-mono tabular-nums text-[11px] text-slate-400">
                                {formatDateTime(toMillis(log.createdAt))}
                              </span>
                            </div>
                            <div className="text-slate-600 dark:text-slate-400">{log.reason}</div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Appeal Review Modal */}
      {reviewingAppeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-xs">
          <form
            onSubmit={handleReviewAppealSubmit}
            className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Review Ban Appeal
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {reviewingAppeal.userEmail} · {reviewingAppeal.banType} ban
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReviewingAppeal(null)}
                aria-label="Close Appeal Review"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1">
              <div className="font-semibold text-slate-900 dark:text-white">
                {reviewingAppeal.appealReason}
              </div>
              <p className="text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                {reviewingAppeal.explanation}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Appeal Decision
              </label>
              <select
                value={appealDecisionStatus}
                onChange={(e) =>
                  setAppealDecisionStatus(e.target.value as Exclude<AppealStatus, 'pending'>)
                }
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
              >
                <option value="approved">Approve Appeal</option>
                <option value="under_review">Mark Under Review</option>
                <option value="rejected">Reject Appeal</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Administrator Decision Note *
              </label>
              <textarea
                rows={3}
                required
                maxLength={1000}
                value={appealDecisionNote}
                onChange={(e) => setAppealDecisionNote(e.target.value)}
                placeholder="Explain your appeal review decision clearly..."
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
              />
            </div>

            {appealDecisionStatus === 'approved' && (
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={appealReactivateOnApprove}
                  onChange={(e) => setAppealReactivateOnApprove(e.target.checked)}
                />
                <span>Immediately reactivate account and lift ban / restrictions on approval</span>
              </label>
            )}

            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={appealSendDirectMsg}
                onChange={(e) => setAppealSendDirectMsg(e.target.checked)}
              />
              <span>Send direct pop-up message notifying the user of this decision</span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={submittingAppealReview}
                onClick={() => setReviewingAppeal(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingAppealReview || !appealDecisionNote.trim()}
                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {submittingAppealReview ? 'Submitting...' : 'Save Appeal Decision'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
