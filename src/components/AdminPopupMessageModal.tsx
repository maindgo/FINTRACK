import React, { useState } from 'react';
import { CheckCircle2, Megaphone, ShieldAlert } from 'lucide-react';
import { AdminMessage } from '../types/finance';
import { DEFAULT_ADMIN_MESSAGE_HEADING, SUPPORT_EMAIL } from '../utils/constants';

interface AdminPopupMessageModalProps {
  messages: AdminMessage[];
  onAcknowledge: (messageId: string) => Promise<void>;
  previewMode?: boolean;
  onClosePreview?: () => void;
}

export function AdminPopupMessageModal({
  messages,
  onAcknowledge,
  previewMode = false,
  onClosePreview,
}: AdminPopupMessageModalProps) {
  const [acknowledging, setAcknowledging] = useState(false);
  const [error, setError] = useState('');

  if (messages.length === 0) return null;

  const current = messages[0];
  const heading = (current.heading || DEFAULT_ADMIN_MESSAGE_HEADING).trim();
  const sentDate =
    current.createdAt && typeof current.createdAt.seconds === 'number'
      ? new Date(current.createdAt.seconds * 1000).toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'Just now';

  const handleAcknowledge = async () => {
    if (previewMode) {
      onClosePreview?.();
      return;
    }
    setAcknowledging(true);
    setError('');
    try {
      await onAcknowledge(current.id);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to mark message as read.');
    } finally {
      setAcknowledging(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-popup-heading"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs"
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700/80 rounded-2xl shadow-2xl overflow-hidden">
        {/* Top Administrator Header */}
        <div className="px-6 py-4 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center shrink-0">
              <Megaphone className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-amber-800 dark:text-amber-300">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>ADMINISTRATIVE NOTICE</span>
              </div>
              <h2
                id="admin-popup-heading"
                className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate"
              >
                {heading}
              </h2>
            </div>
          </div>

          {messages.length > 1 && (
            <span className="text-[11px] font-mono tabular-nums font-semibold text-amber-800 dark:text-amber-300 whitespace-nowrap shrink-0">
              1 / {messages.length}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-line">
            {current.message}
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              <span>FinTrack Administrator</span>
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <span className="font-mono">{sentDate}</span>
              <span className="mx-1.5" aria-hidden="true">
                ·
              </span>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                {SUPPORT_EMAIL}
              </a>
            </div>

            <button
              type="button"
              disabled={acknowledging}
              onClick={handleAcknowledge}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {previewMode
                  ? 'Close Preview'
                  : acknowledging
                  ? 'Confirming...'
                  : messages.length > 1
                  ? 'Acknowledge & Next'
                  : 'Acknowledge & Dismiss'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
