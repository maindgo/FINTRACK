import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
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
} from 'lucide-react';
import { AdminPopupMessageModal } from '../components/AdminPopupMessageModal';
import { useFinance } from '../context/FinanceContext';
import {
  sendAdminPopupMessageToUsers,
  setUserAccountStatus,
  subscribeAllUsersForAdmin,
} from '../services/firestoreService';
import { AccountStatus, AdminMessage, UserProfile } from '../types/finance';
import { ADMIN_EMAIL, DEFAULT_ADMIN_MESSAGE_HEADING } from '../utils/constants';
import { formatCurrency } from '../utils/formatters';

export function AdminPage() {
  const { isAdmin } = useFinance();
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

  // Administrative Pop-Up Message Composer
  const [messageTarget, setMessageTarget] = useState<string>('all');
  const [messageHeading, setMessageHeading] = useState(DEFAULT_ADMIN_MESSAGE_HEADING);
  const [messageBody, setMessageBody] = useState('');
  const [sendingPopup, setSendingPopup] = useState(false);
  const [previewPopupOpen, setPreviewPopupOpen] = useState(false);

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

    const targetUids =
      messageTarget === 'all'
        ? users
            .filter(
              (u) =>
                u.accountStatus !== 'deactivated' &&
                (u.email || '').toLowerCase() !== ADMIN_EMAIL
            )
            .map((u) => u.uid)
        : [messageTarget];

    if (targetUids.length === 0) {
      setError('No eligible active user accounts found for this pop-up message.');
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Admin Panel · Signed-Up Users
            </h2>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            View all registered FinTrack accounts and deactivate or reactivate user access.
          </p>
        </div>
      </div>

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
                Displays a pop-up alert inside the selected user&apos;s FinTrack account (or all active accounts) until acknowledged.
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
    </div>
  );
}
