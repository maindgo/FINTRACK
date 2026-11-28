import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Crown,
  Eye,
  Loader2,
  Megaphone,
  MessageSquarePlus,
  Search,
  Send,
  Shield,
  ShieldAlert,
  UserCheck,
  UserMinus,
  Users,
  UserX,
  XCircle,
} from 'lucide-react';
import { AdminPopupMessageModal } from '../components/AdminPopupMessageModal';
import { AdminSecurityCenter } from '../components/AdminSecurityCenter';
import { useFinance } from '../context/FinanceContext';
import {
  reviewVipPaymentRequest,
  sendAdminPopupMessageToUsers,
  setUserAccountStatus,
  subscribeAllUsersForAdmin,
} from '../services/firestoreService';
import {
  AccountStatus,
  AdminMessage,
  UserProfile,
  VipPaymentRequest,
  VipPaymentRequestStatus,
} from '../types/finance';
import { ADMIN_EMAIL, DEFAULT_ADMIN_MESSAGE_HEADING, VIP_UPI_ID } from '../utils/constants';
import { formatCurrency } from '../utils/formatters';
import { BILLING_CYCLE_LABELS, VIP_TIER_CONFIGS } from '../utils/vipTiers';

interface AdminPageProps {
  initialSection?: 'users' | 'security' | 'vip-approvals';
}

export function AdminPage({ initialSection }: AdminPageProps) {
  const { isAdmin, adminVipPaymentRequests, pendingVipRequestCount } = useFinance();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AccountStatus>('all');
  const [confirmTarget, setConfirmTarget] = useState<{
    user: UserProfile;
    nextStatus: AccountStatus;
  } | null>(null);
  const [updatingUid, setUpdatingUid] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [activeSection, setActiveSection] = useState<'users' | 'security' | 'vip-approvals'>(
    initialSection || 'users'
  );

  // VIP Payment Request Review state
  const [vipReqFilter, setVipReqFilter] = useState<'all' | VipPaymentRequestStatus>('pending');
  const [vipReqSearch, setVipReqSearch] = useState('');
  const [vipNotesMap, setVipNotesMap] = useState<Record<string, string>>({});
  const [reviewingReqId, setReviewingReqId] = useState<string | null>(null);

  // Administrative Pop-Up Message Composer
  const [messageTarget, setMessageTarget] = useState<string>('all');
  const [messageHeading, setMessageHeading] = useState(DEFAULT_ADMIN_MESSAGE_HEADING);
  const [messageBody, setMessageBody] = useState('');
  const [sendingPopup, setSendingPopup] = useState(false);
  const [previewPopupOpen, setPreviewPopupOpen] = useState(false);

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection);
    }
  }, [initialSection]);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const unsub = subscribeAllUsersForAdmin(
      (list) => {
        setUsers(list);
        setLoading(false);
      },
      (err) => {
        setError((err as Error)?.message || 'Unable to load FinTrack user directory.');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [isAdmin]);

  const stats = useMemo(() => {
    const total = users.length;
    const deactivated = users.filter((u) => u.accountStatus === 'deactivated').length;
    const active = total - deactivated;
    return { total, active, deactivated };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      const status: AccountStatus =
        u.accountStatus === 'deactivated' ? 'deactivated' : 'active';
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!q) return true;
      return (
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.uid || '').toLowerCase().includes(q)
      );
    });
  }, [users, search, statusFilter]);

  const vipRequestStats = useMemo(() => {
    const pending = adminVipPaymentRequests.filter((r) => r.status === 'pending').length;
    const approved = adminVipPaymentRequests.filter((r) => r.status === 'approved').length;
    const rejected = adminVipPaymentRequests.filter((r) => r.status === 'rejected').length;
    const approvedAmount = adminVipPaymentRequests
      .filter((r) => r.status === 'approved')
      .reduce((sum, r) => sum + (Number(r.amountInr) || 0), 0);
    return { pending, approved, rejected, approvedAmount };
  }, [adminVipPaymentRequests]);

  const filteredVipRequests = useMemo(() => {
    const q = vipReqSearch.trim().toLowerCase();
    return adminVipPaymentRequests.filter((req) => {
      if (vipReqFilter !== 'all' && req.status !== vipReqFilter) return false;
      if (!q) return true;
      return (
        (req.displayName || '').toLowerCase().includes(q) ||
        (req.userEmail || '').toLowerCase().includes(q) ||
        (req.userId || '').toLowerCase().includes(q) ||
        (req.utrReference || '').toLowerCase().includes(q) ||
        (req.paymentReference || '').toLowerCase().includes(q)
      );
    });
  }, [adminVipPaymentRequests, vipReqFilter, vipReqSearch]);

  if (!isAdmin) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-8 text-center space-y-2">
        <ShieldAlert className="w-8 h-8 text-red-600 mx-auto" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">
          Administrator Access Required
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          This section is restricted strictly to the verified FinTrack administrator account.
        </p>
      </div>
    );
  }

  const handleConfirmStatusChange = async () => {
    if (!confirmTarget) return;
    const { user: targetUser, nextStatus } = confirmTarget;
    setUpdatingUid(targetUser.uid);
    setError('');
    setActionMsg('');
    try {
      await setUserAccountStatus(targetUser.uid, nextStatus);
      setActionMsg(
        `${targetUser.email} has been ${nextStatus === 'deactivated' ? 'deactivated' : 'reactivated'}.`
      );
      setConfirmTarget(null);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to update account status.');
    } finally {
      setUpdatingUid(null);
    }
  };

  const formatJoinedDate = (u: UserProfile) => {
    if (!u.createdAt || typeof u.createdAt.seconds !== 'number') return '—';
    return new Date(u.createdAt.seconds * 1000).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const handleSendPopupMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedBody = messageBody.trim();
    if (!trimmedBody) {
      setError('Please enter a message to display in the user pop-up.');
      return;
    }

    const nonAdminUsers = users.filter(
      (u) => (u.email || '').toLowerCase() !== ADMIN_EMAIL
    );
    const targetUids =
      messageTarget === 'all'
        ? nonAdminUsers
            .filter((u) => u.accountStatus !== 'deactivated')
            .map((u) => u.uid)
        : messageTarget === 'all_including_deactivated'
        ? nonAdminUsers.map((u) => u.uid)
        : messageTarget === 'deactivated_only'
        ? nonAdminUsers
            .filter((u) => u.accountStatus === 'deactivated')
            .map((u) => u.uid)
        : [messageTarget];

    if (targetUids.length === 0) {
      setError('No eligible user accounts found for this pop-up message.');
      return;
    }

    setSendingPopup(true);
    setError('');
    setActionMsg('');
    try {
      const count = await sendAdminPopupMessageToUsers(
        targetUids,
        messageHeading.trim() || DEFAULT_ADMIN_MESSAGE_HEADING,
        trimmedBody
      );
      const targetUserObj = users.find((u) => u.uid === messageTarget);
      setActionMsg(
        messageTarget === 'all'
          ? `Pop-up message sent to ${count} active FinTrack user account${count === 1 ? '' : 's'}.`
          : messageTarget === 'all_including_deactivated'
          ? `Pop-up message sent to ${count} FinTrack user account${count === 1 ? '' : 's'} (active & deactivated).`
          : messageTarget === 'deactivated_only'
          ? `Pop-up message sent to ${count} deactivated FinTrack account${count === 1 ? '' : 's'}.`
          : `Pop-up message sent to ${targetUserObj?.email || 'selected user'}.`
      );
      setMessageBody('');
    } catch (err) {
      setError((err as Error)?.message || 'Failed to send pop-up message.');
    } finally {
      setSendingPopup(false);
    }
  };

  const previewAdminMessages: AdminMessage[] = previewPopupOpen
    ? [
        {
          id: 'preview',
          userId: 'preview',
          heading: messageHeading.trim() || DEFAULT_ADMIN_MESSAGE_HEADING,
          message:
            messageBody.trim() ||
            'Your administrative announcement message will appear here for the user to read and acknowledge.',
          senderEmail: ADMIN_EMAIL,
          isRead: false,
        },
      ]
    : [];

  const handleReviewVipPayment = async (
    request: VipPaymentRequest,
    decision: 'approved' | 'rejected'
  ) => {
    const note = (vipNotesMap[request.id] || '').trim();
    setError('');
    setActionMsg('');
    if (decision === 'rejected' && note.length < 3) {
      setError('Please enter a brief rejection reason in the note box before rejecting.');
      return;
    }
    setReviewingReqId(request.id);
    try {
      await reviewVipPaymentRequest({ request, decision, adminNote: note });
      const tierSpec = VIP_TIER_CONFIGS[request.tier];
      setActionMsg(
        decision === 'approved'
          ? `Confirmed UPI payment (UTR: ${request.utrReference}) and activated ${tierSpec.classLabel} ${tierSpec.name} for ${request.userEmail}.`
          : `Rejected VIP payment request (UTR: ${request.utrReference}) for ${request.userEmail}. VIP remains locked.`
      );
      setVipNotesMap((prev) => {
        const next = { ...prev };
        delete next[request.id];
        return next;
      });
    } catch (err) {
      setError((err as Error)?.message || 'Unable to process VIP payment decision.');
    } finally {
      setReviewingReqId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {activeSection === 'security'
                ? 'Admin Panel · Security Center'
                : activeSection === 'vip-approvals'
                ? 'Admin Panel · VIP UPI Approvals'
                : 'Admin Panel · Signed-Up Users'}
            </h2>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {activeSection === 'security'
              ? 'Monitor suspicious activity, enforce temporary or permanent bans, review appeals, and audit admin actions.'
              : activeSection === 'vip-approvals'
              ? `Verify user UPI payments made to ${VIP_UPI_ID} and confirm or reject VIP activations.`
              : 'View all registered FinTrack accounts and deactivate or reactivate user access.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 w-fit shrink-0">
          <button
            type="button"
            onClick={() => setActiveSection('users')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              activeSection === 'users'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Users &amp; Messaging
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('vip-approvals')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              activeSection === 'vip-approvals'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <span>VIP Approvals</span>
            {pendingVipRequestCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 text-[10px] font-bold font-mono leading-none">
                {pendingVipRequestCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('security')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              activeSection === 'security'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Security Center
          </button>
        </div>
      </div>

      {pendingVipRequestCount > 0 && activeSection !== 'vip-approvals' && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-amber-900 dark:text-amber-200">
            <Crown className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              <strong>{pendingVipRequestCount}</strong> pending VIP UPI payment verification request
              {pendingVipRequestCount === 1 ? '' : 's'} sent to{' '}
              <span className="font-mono font-semibold">{VIP_UPI_ID}</span> awaiting your confirmation or rejection.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveSection('vip-approvals')}
            className="px-3.5 py-1.5 rounded-lg bg-amber-500 text-slate-950 text-xs font-semibold hover:bg-amber-400 whitespace-nowrap self-start sm:self-auto"
          >
            Review VIP Payments ({pendingVipRequestCount})
          </button>
        </div>
      )}

      {activeSection === 'security' ? (
        <AdminSecurityCenter users={users} />
      ) : activeSection === 'vip-approvals' ? (
        <div className="space-y-5">
          {/* VIP Approvals Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Pending Verification</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1">
                  {vipRequestStats.pending}
                </div>
              </div>
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Confirmed Requests</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                  {vipRequestStats.approved}
                </div>
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Rejected Requests</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400 mt-1">
                  {vipRequestStats.rejected}
                </div>
              </div>
              <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Confirmed UPI Total</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                  ₹{vipRequestStats.approvedAmount}
                </div>
              </div>
              <Crown className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>

          {actionMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{actionMsg}</span>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Filter & Search Bar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={vipReqSearch}
                onChange={(e) => setVipReqSearch(e.target.value)}
                placeholder="Search by email, UTR, or payment reference..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
              />
            </div>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 w-fit">
              {(
                [
                  { id: 'pending', label: `Pending (${vipRequestStats.pending})` },
                  { id: 'approved', label: 'Confirmed' },
                  { id: 'rejected', label: 'Rejected' },
                  { id: 'all', label: 'All' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setVipReqFilter(tab.id)}
                  className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
                    vipReqFilter === tab.id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Requests List */}
          {filteredVipRequests.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center space-y-2">
              <Crown className="w-7 h-7 text-slate-400 mx-auto" />
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No {vipReqFilter === 'all' ? '' : vipReqFilter} VIP payment requests
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                When users pay to <span className="font-mono">{VIP_UPI_ID}</span> and submit their UTR reference, requests appear here for your confirmation or rejection.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredVipRequests.map((req) => {
                const tierSpec = VIP_TIER_CONFIGS[req.tier];
                const cycleSpec = BILLING_CYCLE_LABELS[req.billingCycle];
                const isPending = req.status === 'pending';
                const isBusy = reviewingReqId === req.id;
                const submittedDate = req.createdAt?.seconds
                  ? new Date(req.createdAt.seconds * 1000).toLocaleString('en-IN')
                  : 'Just now';

                return (
                  <div
                    key={req.id}
                    className={`bg-white dark:bg-slate-900 rounded-xl p-5 border space-y-4 ${
                      isPending
                        ? 'border-amber-300 dark:border-amber-800'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900 dark:text-white">
                            {req.displayName}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            ({req.userEmail})
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${tierSpec.badgeContainerClass}`}
                          >
                            <Crown className="w-3 h-3" />
                            {tierSpec.classLabel} · {tierSpec.name}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                          <span>
                            Cycle: <strong>{cycleSpec.label}</strong>
                          </span>
                          <span>
                            Payable:{' '}
                            <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                              ₹{req.amountInr}
                            </strong>
                          </span>
                          <span>
                            UPI ID: <strong className="font-mono">{req.upiId}</strong>
                          </span>
                          <span>
                            Submitted: <span className="font-mono">{submittedDate}</span>
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs pt-0.5">
                          <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-slate-900 dark:text-white">
                            UTR / UPI Ref: <strong>{req.utrReference}</strong>
                          </span>
                          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            Req Ref: {req.paymentReference} · UID: {req.userId}
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0">
                        {req.status === 'pending' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                            <Clock className="w-3.5 h-3.5" />
                            Pending Verification
                          </span>
                        ) : req.status === 'approved' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Confirmed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                            <XCircle className="w-3.5 h-3.5" />
                            Rejected
                          </span>
                        )}
                      </div>
                    </div>

                    {isPending ? (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                        <input
                          type="text"
                          maxLength={500}
                          disabled={isBusy}
                          value={vipNotesMap[req.id] || ''}
                          onChange={(e) =>
                            setVipNotesMap((prev) => ({ ...prev, [req.id]: e.target.value }))
                          }
                          placeholder="Optional confirmation note, or required reason if rejecting..."
                          className="flex-1 px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
                        />
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleReviewVipPayment(req, 'rejected')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Reject</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleReviewVipPayment(req, 'approved')}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            )}
                            <span>{isBusy ? 'Processing...' : 'Confirm & Activate VIP'}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2">
                        <span>
                          Reviewed by <span className="font-mono">{req.reviewedBy || ADMIN_EMAIL}</span>
                          {req.reviewedAt?.seconds
                            ? ` on ${new Date(req.reviewedAt.seconds * 1000).toLocaleString('en-IN')}`
                            : ''}
                        </span>
                        {req.adminNote && (
                          <span className="text-slate-700 dark:text-slate-300">
                            Note: {req.adminNote}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Total Signed-Up Users</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1">
              {stats.total}
            </div>
          </div>
          <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Active Accounts</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
              {stats.active}
            </div>
          </div>
          <UserCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Deactivated Accounts</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400 mt-1">
              {stats.deactivated}
            </div>
          </div>
          <UserX className="w-5 h-5 text-red-600 dark:text-red-400" />
        </div>
      </div>

      {actionMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Send Administrative Pop-Up Message Card */}
      <form
        id="admin-popup-composer"
        onSubmit={handleSendPopupMessage}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
              <Megaphone className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Send Administrative Pop-Up Message
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Displays a pop-up alert inside the selected user&apos;s FinTrack account (including deactivated accounts) until acknowledged.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPreviewPopupOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 self-start sm:self-auto shrink-0"
          >
            <Eye className="w-3.5 h-3.5" />
            Preview Pop-Up
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Recipient User Account
            </label>
            <select
              value={messageTarget}
              onChange={(e) => setMessageTarget(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
            >
              <option value="all">
                All Active FinTrack Users ({users.filter((u) => u.accountStatus !== 'deactivated' && (u.email || '').toLowerCase() !== ADMIN_EMAIL).length})
              </option>
              <option value="all_including_deactivated">
                All Users — Active &amp; Deactivated ({users.filter((u) => (u.email || '').toLowerCase() !== ADMIN_EMAIL).length})
              </option>
              <option value="deactivated_only">
                All Deactivated Accounts ({users.filter((u) => u.accountStatus === 'deactivated' && (u.email || '').toLowerCase() !== ADMIN_EMAIL).length})
              </option>
              {users.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName || 'User'} — {u.email}
                  {u.accountStatus === 'deactivated' ? ' (Deactivated)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Pop-Up Title / Administrative Heading
            </label>
            <input
              type="text"
              maxLength={120}
              required
              value={messageHeading}
              onChange={(e) => setMessageHeading(e.target.value)}
              placeholder={DEFAULT_ADMIN_MESSAGE_HEADING}
              className="w-full px-3 py-2 text-xs font-semibold rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label className="font-medium text-slate-700 dark:text-slate-300">
              Administrator Message *
            </label>
            <span className="font-mono text-[11px] text-slate-400">
              {messageBody.length}/1500
            </span>
          </div>
          <textarea
            rows={3}
            maxLength={1500}
            required
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            placeholder="Write the message you want shown to the user..."
            className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
          />
        </div>

        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={sendingPopup || !messageBody.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{sendingPopup ? 'Sending Pop-Up...' : 'Send Pop-Up Message'}</span>
          </button>
        </div>
      </form>

      {/* Search & Filter */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or UID..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30"
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 w-fit">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'active', label: 'Active' },
              { id: 'deactivated', label: 'Deactivated' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1 rounded-md text-xs font-medium ${
                statusFilter === tab.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* User Directory Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            Loading registered users...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
            No matching signed-up users found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/80 dark:bg-slate-950/50">
                  <th className="py-3 px-5">User</th>
                  <th className="py-3 px-4">Email &amp; UID</th>
                  <th className="py-3 px-4">Currency &amp; Opening</th>
                  <th className="py-3 px-4">Signed Up</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {filteredUsers.map((u) => {
                  const isSelfAdmin = (u.email || '').toLowerCase() === ADMIN_EMAIL;
                  const isDeactivated = u.accountStatus === 'deactivated';
                  const openBank = u.openingBankBalance || 0;
                  const openCash = u.openingCashBalance || 0;
                  return (
                    <tr
                      key={u.uid}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[11px] font-bold text-slate-700 dark:text-slate-200 shrink-0">
                            {(u.displayName || u.email || 'U').slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <span className="truncate max-w-[180px]">
                                {u.displayName || 'FinTrack User'}
                              </span>
                              {isSelfAdmin && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold">
                                  ADMIN
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {u.email}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 truncate max-w-[200px]">
                          {u.uid}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <div>{u.currency || 'INR'}</div>
                        {(openBank > 0 || openCash > 0) && (
                          <div className="text-slate-400">
                            Bank {formatCurrency(openBank, u.currency || 'INR')} · Cash{' '}
                            {formatCurrency(openCash, u.currency || 'INR')}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatJoinedDate(u)}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {isDeactivated ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                            Deactivated
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setMessageTarget(u.uid);
                              document.getElementById('admin-popup-composer')?.scrollIntoView({ behavior: 'smooth' });
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-semibold hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <MessageSquarePlus className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                            Message
                          </button>

                          {isSelfAdmin ? (
                            <span className="text-[11px] text-slate-400 px-1">Protected</span>
                          ) : isDeactivated ? (
                            <button
                              type="button"
                              disabled={updatingUid === u.uid}
                              onClick={() =>
                                setConfirmTarget({ user: u, nextStatus: 'active' })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <UserCheck className="w-3.5 h-3.5" />
                              Reactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={updatingUid === u.uid}
                              onClick={() =>
                                setConfirmTarget({ user: u, nextStatus: 'deactivated' })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-[11px] font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                              Deactivate
                            </button>
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

      {/* Confirmation Modal */}
      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                  confirmTarget.nextStatus === 'deactivated'
                    ? 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {confirmTarget.nextStatus === 'deactivated' ? (
                  <UserX className="w-5 h-5" />
                ) : (
                  <UserCheck className="w-5 h-5" />
                )}
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {confirmTarget.nextStatus === 'deactivated'
                    ? 'Deactivate User Account?'
                    : 'Reactivate User Account?'}
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {confirmTarget.nextStatus === 'deactivated' ? (
                    <>
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {confirmTarget.user.email}
                      </span>{' '}
                      will immediately lose access to their FinTrack workspace and will be blocked from creating or modifying records until reactivated.
                    </>
                  ) : (
                    <>
                      Restore full workspace access for{' '}
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {confirmTarget.user.email}
                      </span>
                      ?
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={Boolean(updatingUid)}
                onClick={() => setConfirmTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(updatingUid)}
                onClick={handleConfirmStatusChange}
                className={`px-4 py-2 rounded-lg text-white text-xs font-semibold disabled:opacity-50 ${
                  confirmTarget.nextStatus === 'deactivated'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {updatingUid
                  ? 'Updating...'
                  : confirmTarget.nextStatus === 'deactivated'
                  ? 'Confirm Deactivate'
                  : 'Confirm Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
      <AdminPopupMessageModal
        messages={previewAdminMessages}
        previewMode
        onAcknowledge={async () => setPreviewPopupOpen(false)}
        onClosePreview={() => setPreviewPopupOpen(false)}
      />
        </>
      )}
    </div>
  );
}
