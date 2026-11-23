import React from 'react';
import { Download, FileText, X } from 'lucide-react';
import { TransactionRecord } from '../types/finance';

interface ReceiptPreviewModalProps {
  record: TransactionRecord | null;
  onClose: () => void;
}

export function ReceiptPreviewModal({ record, onClose }: ReceiptPreviewModalProps) {
  if (!record || !record.receiptDataUrl) return null;

  const isImage = record.receiptDataUrl.startsWith('data:image/');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {record.receiptName || 'Attached Receipt'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {record.title} · {record.date}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={record.receiptDataUrl}
              download={record.receiptName || 'receipt'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close receipt preview"
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-950 flex items-center justify-center max-h-[75vh] overflow-auto">
          {isImage ? (
            <img
              src={record.receiptDataUrl}
              alt={record.receiptName || 'Receipt'}
              className="max-w-full max-h-[65vh] rounded-lg border border-slate-200 dark:border-slate-800 object-contain"
            />
          ) : (
            <div className="text-center space-y-3 py-10">
              <FileText className="w-12 h-12 text-slate-400 mx-auto" />
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Document attached ({record.receiptName}). Use Download above to open the file.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
