import { CurrencyCode, DashboardDateFilter, RecurringFrequency, BillFrequency } from '../types/finance';
import { CURRENCIES } from './constants';

export function getCurrencyMeta(code: CurrencyCode) {
  return CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
}

export function formatCurrency(amount: number, currency: CurrencyCode = 'INR', compact = false): string {
  const meta = getCurrencyMeta(currency);
  const safeAmount = Number.isFinite(amount) ? amount : 0;

  if (compact && Math.abs(safeAmount) >= 100000 && currency === 'INR') {
    const abs = Math.abs(safeAmount);
    const sign = safeAmount < 0 ? '-' : '';
    if (abs >= 10000000) {
      return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
    }
    return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  }

  try {
    return new Intl.NumberFormat(meta.locale, {
      style: 'currency',
      currency: meta.code,
      maximumFractionDigits: currency === 'JPY' ? 0 : 2,
      minimumFractionDigits: Number.isInteger(safeAmount) ? 0 : 2,
    }).format(safeAmount);
  } catch {
    return `${meta.symbol}${safeAmount.toLocaleString('en-IN')}`;
  }
}

export function formatCurrencyAscii(amount: number, currency: CurrencyCode = 'INR'): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const formatted = safeAmount.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

export function getTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentMonthStr(): string {
  return getTodayStr().slice(0, 7);
}

export function getCurrentTimeStr(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function getPreviousMonthStr(monthStr: string): string {
  const [year, month] = monthStr.split('-').map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getDateRangeForFilter(
  filter: DashboardDateFilter,
  customStart?: string,
  customEnd?: string
): { start: string; end: string; label: string } {
  const now = new Date();
  const today = getTodayStr();

  if (filter === 'today') {
    return { start: today, end: today, label: 'Today' };
  }

  if (filter === 'week') {
    const dayOfWeek = now.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diffToMonday);
    const start = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(
      monday.getDate()
    ).padStart(2, '0')}`;
    return { start, end: today, label: 'This Week' };
  }

  if (filter === 'month') {
    const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return { start, end: today, label: 'This Month' };
  }

  if (filter === 'year') {
    const start = `${now.getFullYear()}-01-01`;
    return { start, end: today, label: 'This Year' };
  }

  const start = customStart || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const end = customEnd || today;
  return {
    start: start <= end ? start : end,
    end: start <= end ? end : start,
    label: `${start} to ${end}`,
  };
}

export function formatReadableDate(dateStr: string): string {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatMonthLabel(monthStr: string): string {
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m) return monthStr;
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

export function addFrequencyToDate(dateStr: string, frequency: RecurringFrequency | BillFrequency): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (frequency === 'daily') dt.setDate(dt.getDate() + 1);
  else if (frequency === 'weekly') dt.setDate(dt.getDate() + 7);
  else if (frequency === 'monthly') dt.setMonth(dt.getMonth() + 1);
  else if (frequency === 'quarterly') dt.setMonth(dt.getMonth() + 3);
  else if (frequency === 'yearly') dt.setFullYear(dt.getFullYear() + 1);

  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function daysBetween(startDate: string, endDate: string): number {
  const [y1, m1, d1] = startDate.split('-').map(Number);
  const [y2, m2, d2] = endDate.split('-').map(Number);
  const t1 = new Date(y1, m1 - 1, d1).getTime();
  const t2 = new Date(y2, m2 - 1, d2).getTime();
  return Math.ceil((t2 - t1) / (1000 * 60 * 60 * 24));
}

export function compressImageFile(file: File, maxSizeBytes = 180000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        const res = typeof reader.result === 'string' ? reader.result : '';
        if (res.length > maxSizeBytes) {
          reject(new Error('Receipt file is too large. Please attach an image under 2 MB or a smaller file.'));
          return;
        }
        resolve(res);
      };
      reader.onerror = () => reject(new Error('Failed to read attachment.'));
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1000;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.72;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > maxSizeBytes && quality > 0.25) {
          quality -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        if (dataUrl.length > 240000) {
          reject(new Error('Compressed image still exceeds storage limit. Please choose a smaller receipt image.'));
          return;
        }
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Invalid image file.'));
      img.src = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}
