import {
  SecurityEventCategory,
  SecurityEventRecord,
  SecurityEventType,
  SecurityRiskLevel,
} from '../types/finance';

export interface DurationPreset {
  id: string;
  label: string;
  hhmmss: string;
  ms: number;
}

export const TEMP_BAN_DURATION_PRESETS: DurationPreset[] = [
  { id: '24h', label: '24 Hours', hhmmss: '24:00:00', ms: 24 * 3600 * 1000 },
  { id: '3d', label: '3 Days', hhmmss: '72:00:00', ms: 3 * 24 * 3600 * 1000 },
  { id: '7d', label: '7 Days', hhmmss: '168:00:00', ms: 7 * 24 * 3600 * 1000 },
  { id: '30d', label: '30 Days', hhmmss: '720:00:00', ms: 30 * 24 * 3600 * 1000 },
];

export const RESTRICTION_DURATION_PRESETS: DurationPreset[] = [
  { id: '1h', label: '1 Hour', hhmmss: '01:00:00', ms: 1 * 3600 * 1000 },
  { id: '6h', label: '6 Hours', hhmmss: '06:00:00', ms: 6 * 3600 * 1000 },
  { id: '24h', label: '24 Hours', hhmmss: '24:00:00', ms: 24 * 3600 * 1000 },
  { id: '3d', label: '3 Days', hhmmss: '72:00:00', ms: 3 * 24 * 3600 * 1000 },
];

/**
 * Parses duration strings formatted strictly as hh:mm:ss (hours can exceed 24, e.g. 72:00:00 or 168:00:00).
 * Maximum supported duration is 3650 days (~87,600 hours).
 */
export function parseDurationHhMmSs(input: string): {
  valid: boolean;
  ms: number;
  normalized: string;
  error?: string;
} {
  const cleaned = input.trim();
  const match = cleaned.match(/^(\d{1,5}):([0-5]\d):([0-5]\d)$/);
  if (!match) {
    return {
      valid: false,
      ms: 0,
      normalized: '',
      error: 'Enter duration in hh:mm:ss format (e.g., 24:00:00 or 02:30:00).',
    };
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  if (totalSeconds <= 0) {
    return {
      valid: false,
      ms: 0,
      normalized: '',
      error: 'Duration must be greater than 00:00:00.',
    };
  }
  const maxSeconds = 3650 * 24 * 3600;
  if (totalSeconds > maxSeconds) {
    return {
      valid: false,
      ms: 0,
      normalized: '',
      error: 'Temporary duration cannot exceed 3650 days.',
    };
  }
  const hhStr = String(hours).padStart(2, '0');
  const mmStr = String(minutes).padStart(2, '0');
  const ssStr = String(seconds).padStart(2, '0');
  return {
    valid: true,
    ms: totalSeconds * 1000,
    normalized: `${hhStr}:${mmStr}:${ssStr}`,
  };
}

export function formatDurationHhMmSs(totalMs: number): string {
  const safeMs = Math.max(0, totalMs);
  const totalSec = Math.ceil(safeMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    seconds
  ).padStart(2, '0')}`;
}

export const EVENT_BASE_WEIGHTS: Record<SecurityEventType, number> = {
  repeated_failed_login: 24,
  suspicious_account_creation: 30,
  unauthorized_account_access: 32,
  deactivation_bypass_attempt: 45,
  unauthorized_vip_access: 38,
  subscription_bypass_attempt: 42,
  payment_verification_inconsistency: 34,
  membership_manipulation_attempt: 46,
  excessive_ai_requests: 18,
  rate_limit_bypass_attempt: 35,
  unauthorized_api_request: 28,
  unauthorized_firebase_access: 36,
  suspicious_bot_activity: 40,
  cross_user_record_access: 50,
  unauthorized_tx_modification: 42,
  suspicious_bulk_mutation: 32,
  unauthorized_admin_access: 55,
  spam_messages: 22,
  malicious_links: 42,
  abusive_or_threatening_message: 38,
};

export const EVENT_LABELS: Record<SecurityEventType, string> = {
  repeated_failed_login: 'Repeated Failed Logins',
  suspicious_account_creation: 'Suspicious Account Creation',
  unauthorized_account_access: 'Unauthorized Account Access',
  deactivation_bypass_attempt: 'Deactivation / Ban Bypass Attempt',
  unauthorized_vip_access: 'Unauthorized VIP Access',
  subscription_bypass_attempt: 'Subscription Verification Bypass',
  payment_verification_inconsistency: 'Payment Verification Inconsistency',
  membership_manipulation_attempt: 'Membership Status Manipulation',
  excessive_ai_requests: 'Excessive AI API Requests',
  rate_limit_bypass_attempt: 'Rate-Limit Bypass Attempt',
  unauthorized_api_request: 'Unauthorized API Request',
  unauthorized_firebase_access: 'Unauthorized Firebase Access',
  suspicious_bot_activity: 'Suspicious Automated Bot Activity',
  cross_user_record_access: 'Cross-User Data Access Attempt',
  unauthorized_tx_modification: 'Unauthorized Transaction Modification',
  suspicious_bulk_mutation: 'Suspicious Bulk Deletion / Mutation',
  unauthorized_admin_access: 'Unauthorized Admin Access Attempt',
  spam_messages: 'Repeated Spam Messages',
  malicious_links: 'Malicious / Suspicious Links',
  abusive_or_threatening_message: 'Abusive or Threatening Content',
};

export const CATEGORY_LABELS: Record<SecurityEventCategory, string> = {
  account_security: 'Account Security',
  vip_payment_security: 'VIP & Payment Security',
  api_backend_security: 'API & Backend Security',
  data_security: 'Data Security',
  messaging_security: 'Messaging Security',
};

/**
 * False-positive safe evidence-based risk scoring.
 * Never classifies normal VPN switches, multiple personal devices, unusual spending amounts,
 * or 1-2 isolated failed logins as malicious. Never issues permanent bans automatically.
 */
export function computeEvidenceRiskScore(
  events: Pick<SecurityEventRecord, 'eventType' | 'riskScore' | 'status'>[]
): {
  riskScore: number;
  riskLevel: SecurityRiskLevel;
  recommendInvestigation: boolean;
} {
  const activeEvents = events.filter((ev) => ev.status !== 'dismissed');
  if (activeEvents.length === 0) {
    return { riskScore: 0, riskLevel: 'low', recommendInvestigation: false };
  }

  let total = 0;
  const distinctTypes = new Set<string>();
  for (const ev of activeEvents.slice(0, 25)) {
    const base = ev.riskScore > 0 ? ev.riskScore : EVENT_BASE_WEIGHTS[ev.eventType] || 20;
    const isRepeat = distinctTypes.has(ev.eventType);
    distinctTypes.add(ev.eventType);
    total += isRepeat ? Math.round(base * 0.45) : base;
  }

  const riskScore = Math.min(100, Math.round(total));
  const riskLevel: SecurityRiskLevel =
    riskScore >= 85
      ? 'critical'
      : riskScore >= 60
      ? 'high'
      : riskScore >= 30
      ? 'medium'
      : 'low';

  return {
    riskScore,
    riskLevel,
    recommendInvestigation: riskScore >= 55 || distinctTypes.size >= 2,
  };
}

export interface MessageSecurityCheckResult {
  flagged: boolean;
  violationType: 'spam_messages' | 'malicious_links' | 'abusive_or_threatening_message' | null;
  riskLevel: SecurityRiskLevel;
  reason: string;
}

const recentMessageLog = new Map<string, { text: string; ts: number }[]>();

export function analyzeMessageSecurity(
  text: string,
  senderKey = 'anon'
): MessageSecurityCheckResult {
  const cleaned = text.trim();
  const lower = cleaned.toLowerCase();

  // 1. Check malicious or obfuscated links
  if (
    /javascript:|data:text\/html|vbscript:|file:\/\/|http:\/\/\d{1,3}(?:\.\d{1,3}){3}|bit\.ly\/|tinyurl\.com\/|grabify|iplogger|phish|credential[-_]?verify|free[-_]?crypto/i.test(
      lower
    )
  ) {
    return {
      flagged: true,
      violationType: 'malicious_links',
      riskLevel: 'high',
      reason: 'Suspicious or potentially malicious URL pattern detected in message.',
    };
  }

  // 2. Check abusive or threatening language
  if (
    /\b(kill\s+you|i\s+will\s+hack|ddos\s+you|bomb\s+threat|die\s+now|extort|ransomware|leak\s+your\s+data)\b/i.test(
      lower
    )
  ) {
    return {
      flagged: true,
      violationType: 'abusive_or_threatening_message',
      riskLevel: 'high',
      reason: 'Abusive or threatening phrasing detected.',
    };
  }

  // 3. Check repeated spam messages from same sender within 3 minutes
  const now = Date.now();
  const prev = (recentMessageLog.get(senderKey) || []).filter((m) => now - m.ts < 180_000);
  const duplicateCount = prev.filter((m) => m.text === lower).length;
  const repeatedChars = /(.)\1{14,}/.test(cleaned);
  prev.push({ text: lower, ts: now });
  recentMessageLog.set(senderKey, prev);

  if (duplicateCount >= 2 || prev.length >= 6 || repeatedChars) {
    return {
      flagged: true,
      violationType: 'spam_messages',
      riskLevel: 'medium',
      reason: 'Repeated spam submissions detected in a short window.',
    };
  }

  return {
    flagged: false,
    violationType: null,
    riskLevel: 'low',
    reason: '',
  };
}

// Client-side bulk deletion anomaly window (requires >= 6 deletions within 60s to avoid false positives)
const bulkMutationTimestamps = new Map<string, number[]>();

export function checkBulkMutationAnomaly(
  uid: string,
  actionLabel: string
): { suspicious: boolean; countInWindow: number; evidence: string } {
  const now = Date.now();
  const list = (bulkMutationTimestamps.get(uid) || []).filter((ts) => now - ts < 60_000);
  list.push(now);
  bulkMutationTimestamps.set(uid, list);

  if (list.length >= 6) {
    return {
      suspicious: true,
      countInWindow: list.length,
      evidence: `${list.length} rapid ${actionLabel} operations within 60 seconds`,
    };
  }
  return {
    suspicious: false,
    countInWindow: list.length,
    evidence: '',
  };
}

// Track failed logins locally in-session as well so UI can show helpful lock/security hints cleanly
const localFailedLogins = new Map<string, number[]>();

export function trackLocalFailedLoginCount(email: string): number {
  const now = Date.now();
  const key = email.trim().toLowerCase() || 'unknown';
  const attempts = (localFailedLogins.get(key) || []).filter((ts) => now - ts < 15 * 60 * 1000);
  attempts.push(now);
  localFailedLogins.set(key, attempts);
  return attempts.length;
}

export function clearLocalFailedLoginCount(email: string): void {
  localFailedLogins.delete(email.trim().toLowerCase() || 'unknown');
}
