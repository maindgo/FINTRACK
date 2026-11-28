import crypto from 'crypto';
import {
  commitFirestoreDocAsCaller,
  fetchFirestoreDocAsCaller,
  verifyFirebaseIdToken,
  type FirestoreWriteValue,
  type VerifiedFirebaseToken,
} from './firebaseAuth';
import {
  BACKEND_VIP_TIERS,
  computeQuotaPeriodWindow,
  isValidBillingCycle,
  isValidVipTier,
  tierMeetsMinimum,
  type BillingCycle,
  type SubscriptionStatus,
  type VipTier,
} from './vipConfig';

export const ADMIN_EMAIL = 'maind.go2000@gmail.com';

export type BackendRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type BackendEventCategory =
  | 'account_security'
  | 'vip_payment_security'
  | 'api_backend_security'
  | 'data_security'
  | 'messaging_security';

export interface BackendSecurityEvent {
  id: string;
  userId: string;
  userEmail: string;
  category: BackendEventCategory;
  eventType: string;
  riskLevel: BackendRiskLevel;
  riskScore: number;
  summary: string;
  evidence: string;
  source: 'backend';
  status: 'open';
  createdAtIso: string;
}

export interface BackendAiUsageSnapshot {
  tier: VipTier;
  periodKey: string;
  periodStartIso: string;
  periodEndIso: string;
  insightsUsed: number;
  insightsLimit: number;
  insightsRemaining: number;
  advisorUsed: number;
  advisorLimit: number;
  advisorRemaining: number;
  forecastUsed: number;
  lastResetIso: string;
  persistedExists: boolean;
  needsPeriodReset: boolean;
}

export interface CallerSecuritySnapshot {
  uid: string;
  email: string;
  emailVerified: boolean;
  isAdmin: boolean;
  accountStatus: 'active' | 'deactivated';
  restrictionStatus: 'active' | 'under_investigation' | 'temp_banned' | 'perm_banned';
  banType: 'none' | 'temporary' | 'permanent';
  banReason: string;
  banDurationLabel: string;
  banExpiresAtIso: string | null;
  aiRestrictedUntilIso: string | null;
  messagingRestrictedUntilIso: string | null;
  vipStatus: 'none' | 'vip';
  vipTier: VipTier;
  billingCycle: BillingCycle;
  subscriptionStatus: SubscriptionStatus;
  subscriptionEndIso: string | null;
  aiUsage: BackendAiUsageSnapshot;
  warningCount: number;
  riskLevel: BackendRiskLevel;
}

export interface SecurityGuardOptions {
  requireAdmin?: boolean;
  requireVerifiedEmail?: boolean;
  checkAiAccess?: boolean;
  checkMessagingAccess?: boolean;
  checkVipAccess?: boolean;
  claimedVip?: boolean;
  claimedTier?: VipTier;
  requiredVipTier?: VipTier;
  aiQuotaType?: 'insights' | 'advisor' | 'forecast';
  endpointLabel?: string;
}

export type SecurityGuardResult =
  | {
      allowed: true;
      token: VerifiedFirebaseToken;
      idToken: string;
      snapshot: CallerSecuritySnapshot;
    }
  | {
      allowed: false;
      status: number;
      body: Record<string, unknown>;
    };

const MAX_TELEMETRY_EVENTS = 500;
const telemetryEvents: BackendSecurityEvent[] = [];

const failedLoginWindow = new Map<string, number[]>();
const signupIpWindow = new Map<string, { emails: Set<string>; timestamps: number[] }>();
const rateLimitHitWindow = new Map<string, number[]>();
const botBurstWindow = new Map<string, number[]>();
const aiUsageFloorStore = new Map<
  string,
  { insightsUsed: number; advisorUsed: number; forecastUsed: number; updatedAtMs: number }
>();

export function setServerAiUsageFloor(
  uid: string,
  periodKey: string,
  values: { insightsUsed: number; advisorUsed: number; forecastUsed: number }
): void {
  aiUsageFloorStore.set(`${uid}:${periodKey}`, {
    ...values,
    updatedAtMs: Date.now(),
  });
}

function sanitizeField(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

export function extractBearerToken(
  headers: Record<string, string | string[] | undefined>
): string {
  const raw = headers.authorization ?? headers.Authorization;
  const headerVal = Array.isArray(raw) ? raw[0] : raw;
  if (typeof headerVal !== 'string') return '';
  const match = headerVal.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

export function getClientIpFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  fallbackIp = 'unknown'
): string {
  const forwarded = headers['x-forwarded-for'] ?? headers['x-real-ip'];
  const ip = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
    ? forwarded.split(',')[0].trim()
    : fallbackIp || 'unknown';
  return sanitizeField(ip, 64) || 'unknown';
}

export function recordBackendSecurityEvent(input: {
  userId?: string;
  userEmail?: string;
  category: BackendEventCategory;
  eventType: string;
  riskLevel: BackendRiskLevel;
  riskScore: number;
  summary: string;
  evidence: string;
}): BackendSecurityEvent {
  const event: BackendSecurityEvent = {
    id: `srv-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    userId: sanitizeField(input.userId || 'anonymous', 128) || 'anonymous',
    userEmail: sanitizeField(input.userEmail || '', 160),
    category: input.category,
    eventType: sanitizeField(input.eventType, 64),
    riskLevel: input.riskLevel,
    riskScore: Math.max(0, Math.min(100, Math.round(input.riskScore))),
    summary: sanitizeField(input.summary, 280),
    evidence: sanitizeField(input.evidence, 900),
    source: 'backend',
    status: 'open',
    createdAtIso: new Date().toISOString(),
  };

  telemetryEvents.unshift(event);
  if (telemetryEvents.length > MAX_TELEMETRY_EVENTS) {
    telemetryEvents.length = MAX_TELEMETRY_EVENTS;
  }
  return event;
}

export function getBackendSecurityTelemetry(): BackendSecurityEvent[] {
  return [...telemetryEvents];
}

export function trackRateLimitViolation(params: {
  clientKey: string;
  userId?: string;
  userEmail?: string;
  endpoint: string;
  retryAfterSeconds: number;
  headers?: Record<string, string | string[] | undefined>;
}): void {
  const now = Date.now();
  const key = `${params.clientKey}:${params.endpoint}`;
  const hits = (rateLimitHitWindow.get(key) || []).filter((ts) => now - ts < 120_000);
  hits.push(now);
  rateLimitHitWindow.set(key, hits);

  const userAgent = sanitizeField(
    Array.isArray(params.headers?.['user-agent'])
      ? params.headers?.['user-agent'][0]
      : params.headers?.['user-agent'],
    180
  );
  const looksAutomated =
    hits.length >= 4 || /curl|python-requests|bot|scrapy|postman|httpclient/i.test(userAgent);

  if (hits.length >= 3) {
    recordBackendSecurityEvent({
      userId: params.userId || params.clientKey,
      userEmail: params.userEmail || '',
      category: 'api_backend_security',
      eventType: looksAutomated ? 'suspicious_bot_activity' : 'rate_limit_bypass_attempt',
      riskLevel: hits.length >= 6 ? 'high' : 'medium',
      riskScore: Math.min(85, 45 + hits.length * 6),
      summary: looksAutomated
        ? `Repeated automated bursts after 429 throttle on ${params.endpoint}`
        : `Repeated requests attempting to bypass rate limit on ${params.endpoint}`,
      evidence: `Hits after throttle (2m): ${hits.length}, retryAfter=${params.retryAfterSeconds}s, clientKey=${params.clientKey}`,
    });
  } else if (hits.length === 1) {
    recordBackendSecurityEvent({
      userId: params.userId || params.clientKey,
      userEmail: params.userEmail || '',
      category: 'api_backend_security',
      eventType: 'excessive_ai_requests',
      riskLevel: 'low',
      riskScore: 25,
      summary: `AI rate limit reached on ${params.endpoint}`,
      evidence: `Client exceeded 15 requests / 5m window (retryAfter=${params.retryAfterSeconds}s).`,
    });
  }
}

export function trackEndpointRequestBurst(
  clientIp: string,
  endpoint: string,
  headers: Record<string, string | string[] | undefined>
): boolean {
  const now = Date.now();
  const key = `${clientIp}:${endpoint}`;
  const timestamps = (botBurstWindow.get(key) || []).filter((ts) => now - ts < 60_000);
  timestamps.push(now);
  botBurstWindow.set(key, timestamps);

  if (timestamps.length === 30) {
    const ua = sanitizeField(
      Array.isArray(headers['user-agent']) ? headers['user-agent'][0] : headers['user-agent'],
      160
    );
    recordBackendSecurityEvent({
      userId: `ip:${clientIp}`,
      category: 'api_backend_security',
      eventType: 'suspicious_bot_activity',
      riskLevel: 'high',
      riskScore: 68,
      summary: `High-velocity burst (${timestamps.length} req/min) detected on ${endpoint}`,
      evidence: `Source IP=${clientIp}, User-Agent=${ua || 'missing'}`,
    });
    return true;
  }
  return false;
}

export function trackFailedLoginEvent(params: {
  email: string;
  clientIp: string;
  userId?: string;
}): { recorded: boolean; attemptsInWindow: number } {
  const now = Date.now();
  const cleanEmail = sanitizeField(params.email, 160).toLowerCase();
  const key = `${params.clientIp}:${cleanEmail || 'unknown'}`;
  const windowMs = 15 * 60 * 1000;
  const attempts = (failedLoginWindow.get(key) || []).filter((ts) => now - ts < windowMs);
  attempts.push(now);
  failedLoginWindow.set(key, attempts);

  // False-positive guard: 1-2 isolated failed login attempts are never flagged.
  if (attempts.length < 3) {
    return { recorded: false, attemptsInWindow: attempts.length };
  }

  const riskLevel: BackendRiskLevel = attempts.length >= 6 ? 'high' : 'medium';
  const riskScore = attempts.length >= 6 ? 65 : 42;
  recordBackendSecurityEvent({
    userId: params.userId || `email:${cleanEmail || params.clientIp}`,
    userEmail: cleanEmail,
    category: 'account_security',
    eventType: 'repeated_failed_login',
    riskLevel,
    riskScore,
    summary: `Repeated failed login attempts (${attempts.length} in 15m) for ${cleanEmail || 'account'}`,
    evidence: `Attempts=${attempts.length}/15m, sourceIp=${params.clientIp}`,
  });

  return { recorded: true, attemptsInWindow: attempts.length };
}

export function trackSignupPatternEvent(params: {
  email: string;
  clientIp: string;
  userId?: string;
}): { recorded: boolean; accountsInWindow: number } {
  const now = Date.now();
  const cleanEmail = sanitizeField(params.email, 160).toLowerCase();
  const windowMs = 30 * 60 * 1000;
  const existing = signupIpWindow.get(params.clientIp) || {
    emails: new Set<string>(),
    timestamps: [],
  };

  existing.timestamps = existing.timestamps.filter((ts) => now - ts < windowMs);
  existing.timestamps.push(now);
  if (cleanEmail) existing.emails.add(cleanEmail);
  signupIpWindow.set(params.clientIp, existing);

  // False-positive guard: single or pair account creation is normal
  if (existing.timestamps.length < 3) {
    return { recorded: false, accountsInWindow: existing.timestamps.length };
  }

  recordBackendSecurityEvent({
    userId: params.userId || `ip:${params.clientIp}`,
    userEmail: cleanEmail,
    category: 'account_security',
    eventType: 'suspicious_account_creation',
    riskLevel: existing.timestamps.length >= 5 ? 'high' : 'medium',
    riskScore: Math.min(82, 40 + existing.timestamps.length * 8),
    summary: `Rapid multiple account registrations (${existing.timestamps.length} in 30m) from ${params.clientIp}`,
    evidence: `Accounts observed: ${existing.emails.size}, timestamps=${existing.timestamps.length}`,
  });

  return { recorded: true, accountsInWindow: existing.timestamps.length };
}

function parseIsoMs(val: unknown): number | null {
  if (typeof val !== 'string' || !val) return null;
  const ms = Date.parse(val);
  return Number.isFinite(ms) ? ms : null;
}

export async function verifyCallerSecurityAccess(
  headers: Record<string, string | string[] | undefined>,
  fallbackIp = 'unknown',
  options: SecurityGuardOptions = {}
): Promise<SecurityGuardResult> {
  const clientIp = getClientIpFromHeaders(headers, fallbackIp);
  const endpointLabel = options.endpointLabel || '/api';
  trackEndpointRequestBurst(clientIp, endpointLabel, headers);

  const tokenStr = extractBearerToken(headers);
  if (!tokenStr) {
    recordBackendSecurityEvent({
      userId: `ip:${clientIp}`,
      category: options.requireAdmin ? 'data_security' : 'api_backend_security',
      eventType: options.requireAdmin ? 'unauthorized_admin_access' : 'unauthorized_api_request',
      riskLevel: options.requireAdmin ? 'high' : 'medium',
      riskScore: options.requireAdmin ? 70 : 38,
      summary: `Unauthenticated request blocked on ${endpointLabel}`,
      evidence: `Missing Bearer token from IP=${clientIp}`,
    });
    return {
      allowed: false,
      status: 401,
      body: {
        error: 'Authentication is required to access this FinTrack service.',
        code: 'UNAUTHORIZED',
      },
    };
  }

  const verified = await verifyFirebaseIdToken(tokenStr);
  if (!verified) {
    recordBackendSecurityEvent({
      userId: `ip:${clientIp}`,
      category: options.requireAdmin ? 'data_security' : 'api_backend_security',
      eventType: options.requireAdmin ? 'unauthorized_admin_access' : 'unauthorized_api_request',
      riskLevel: 'high',
      riskScore: 65,
      summary: `Invalid or expired auth token rejected on ${endpointLabel}`,
      evidence: `Token signature/claim verification failed from IP=${clientIp}`,
    });
    return {
      allowed: false,
      status: 401,
      body: {
        error: 'Your session is invalid or expired. Please sign in again.',
        code: 'INVALID_AUTH_TOKEN',
      },
    };
  }

  const isAdmin =
    verified.emailVerified && verified.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  if (options.requireAdmin && !isAdmin) {
    recordBackendSecurityEvent({
      userId: verified.uid,
      userEmail: verified.email,
      category: 'data_security',
      eventType: 'unauthorized_admin_access',
      riskLevel: 'critical',
      riskScore: 88,
      summary: `Non-admin user attempted to access admin endpoint ${endpointLabel}`,
      evidence: `uid=${verified.uid}, email=${verified.email || 'unknown'}, verified=${verified.emailVerified}, IP=${clientIp}`,
    });
    return {
      allowed: false,
      status: 403,
      body: {
        error: 'Administrator permissions are required.',
        code: 'ADMIN_REQUIRED',
      },
    };
  }

  if (options.requireVerifiedEmail && !verified.emailVerified && !isAdmin) {
    return {
      allowed: false,
      status: 403,
      body: {
        error: 'Please verify your email address before using protected FinTrack services.',
        code: 'EMAIL_NOT_VERIFIED',
      },
    };
  }

  const [userDoc, secDoc, subDoc, usageDoc] = await Promise.all([
    fetchFirestoreDocAsCaller(`users/${verified.uid}`, tokenStr),
    fetchFirestoreDocAsCaller(`securityProfiles/${verified.uid}`, tokenStr),
    fetchFirestoreDocAsCaller(`vipSubscriptions/${verified.uid}`, tokenStr),
    fetchFirestoreDocAsCaller(`aiUsage/${verified.uid}`, tokenStr),
  ]);

  if (
    userDoc.errorStatus === 403 ||
    secDoc.errorStatus === 403 ||
    subDoc.errorStatus === 403 ||
    usageDoc.errorStatus === 403
  ) {
    recordBackendSecurityEvent({
      userId: verified.uid,
      userEmail: verified.email,
      category: 'api_backend_security',
      eventType: 'unauthorized_firebase_access',
      riskLevel: 'high',
      riskScore: 72,
      summary: `Caller token denied by Firestore security rules during ${endpointLabel} guard check`,
      evidence: `usersStatus=${userDoc.errorStatus ?? 200}, secStatus=${secDoc.errorStatus ?? 200}, subStatus=${subDoc.errorStatus ?? 200}, usageStatus=${usageDoc.errorStatus ?? 200}`,
    });
    return {
      allowed: false,
      status: 403,
      body: {
        error: 'Account permissions could not be verified.',
        code: 'FIRESTORE_ACCESS_DENIED',
      },
    };
  }

  if (
    (userDoc.errorStatus && userDoc.errorStatus >= 500) ||
    (secDoc.errorStatus && secDoc.errorStatus >= 500) ||
    (subDoc.errorStatus && subDoc.errorStatus >= 500) ||
    (usageDoc.errorStatus && usageDoc.errorStatus >= 500)
  ) {
    return {
      allowed: false,
      status: 503,
      body: {
        error: 'Security verification service is temporarily unavailable. Please retry shortly.',
        code: 'SECURITY_VERIFICATION_UNAVAILABLE',
      },
    };
  }

  const accountStatus: 'active' | 'deactivated' =
    userDoc.exists && userDoc.data.accountStatus === 'deactivated' ? 'deactivated' : 'active';

  const nowMs = Date.now();
  const rawBanType = secDoc.exists ? String(secDoc.data.banType || 'none') : 'none';
  const rawRestriction = secDoc.exists
    ? String(secDoc.data.restrictionStatus || 'active')
    : 'active';
  const banExpiresAtIso =
    secDoc.exists && typeof secDoc.data.banExpiresAt === 'string' ? secDoc.data.banExpiresAt : null;
  const banExpiresMs = parseIsoMs(banExpiresAtIso);
  const banReason = secDoc.exists ? String(secDoc.data.banReason || '') : '';
  const banDurationLabel = secDoc.exists ? String(secDoc.data.banDurationLabel || '') : '';
  const aiRestrictedUntilIso =
    secDoc.exists && typeof secDoc.data.aiRestrictedUntil === 'string'
      ? secDoc.data.aiRestrictedUntil
      : null;
  const aiRestrictedMs = parseIsoMs(aiRestrictedUntilIso);
  const messagingRestrictedUntilIso =
    secDoc.exists && typeof secDoc.data.messagingRestrictedUntil === 'string'
      ? secDoc.data.messagingRestrictedUntil
      : null;
  const rawLegacyVip: 'none' | 'vip' =
    secDoc.exists && secDoc.data.vipStatus === 'vip' ? 'vip' : 'none';

  // Resolve authoritative VIP tier from vipSubscriptions + legacy securityProfiles + Admin override
  const subTier = subDoc.exists && isValidVipTier(subDoc.data.tier) ? subDoc.data.tier : null;
  const subCycle: BillingCycle =
    subDoc.exists && isValidBillingCycle(subDoc.data.billingCycle)
      ? subDoc.data.billingCycle
      : 'monthly';
  const subStatusRaw = subDoc.exists ? String(subDoc.data.status || 'active') : 'active';
  const subPeriodStartIso =
    subDoc.exists && typeof subDoc.data.periodStartAt === 'string' ? subDoc.data.periodStartAt : null;
  const subPeriodEndIso =
    subDoc.exists && typeof subDoc.data.periodEndAt === 'string' ? subDoc.data.periodEndAt : null;
  const subStartMs = parseIsoMs(subPeriodStartIso);
  const subEndMs = parseIsoMs(subPeriodEndIso);
  const isSubActiveWindow =
    subDoc.exists &&
    subStatusRaw === 'active' &&
    (subEndMs === null || subEndMs > nowMs);

  let effectiveVipTier: VipTier = 'starter';
  let effectiveSubStatus: SubscriptionStatus = 'active';

  if (isAdmin) {
    effectiveVipTier = 'diamond';
    effectiveSubStatus = 'active';
  } else if (subDoc.exists && subTier) {
    if (isSubActiveWindow) {
      effectiveVipTier = subTier;
      effectiveSubStatus = 'active';
    } else {
      effectiveVipTier = rawLegacyVip === 'vip' ? 'gold' : 'starter';
      effectiveSubStatus = subStatusRaw === 'cancelled' ? 'cancelled' : 'expired';
    }
  } else if (rawLegacyVip === 'vip') {
    // Preserve backward compatibility for users previously granted binary VIP status
    effectiveVipTier = 'gold';
    effectiveSubStatus = 'active';
  }

  const vipStatus: 'none' | 'vip' =
    effectiveVipTier !== 'starter' || rawLegacyVip === 'vip' || isAdmin ? 'vip' : 'none';

  const subStoredPeriodKey =
    subDoc.exists && typeof subDoc.data.periodKey === 'string' ? subDoc.data.periodKey : null;
  const tierSpec = BACKEND_VIP_TIERS[effectiveVipTier];
  const quotaWindow = computeQuotaPeriodWindow(
    isSubActiveWindow ? subStartMs : null,
    nowMs,
    isSubActiveWindow ? subStoredPeriodKey : null
  );
  const docPeriodKey =
    usageDoc.exists && typeof usageDoc.data.periodKey === 'string'
      ? usageDoc.data.periodKey
      : '';
  const docPeriodEndMs = parseIsoMs(
    usageDoc.exists && typeof usageDoc.data.periodEndAt === 'string'
      ? usageDoc.data.periodEndAt
      : null
  );
  const needsPeriodReset =
    !usageDoc.exists ||
    docPeriodKey !== quotaWindow.periodKey ||
    (docPeriodEndMs !== null && nowMs >= docPeriodEndMs);

  const floorEntry = aiUsageFloorStore.get(`${verified.uid}:${quotaWindow.periodKey}`);
  const rawInsightsUsed =
    !needsPeriodReset && usageDoc.exists && typeof usageDoc.data.insightsUsed === 'number'
      ? Math.max(0, Math.round(usageDoc.data.insightsUsed))
      : 0;
  const rawAdvisorUsed =
    !needsPeriodReset && usageDoc.exists && typeof usageDoc.data.advisorUsed === 'number'
      ? Math.max(0, Math.round(usageDoc.data.advisorUsed))
      : 0;
  const rawForecastUsed =
    !needsPeriodReset && usageDoc.exists && typeof usageDoc.data.forecastUsed === 'number'
      ? Math.max(0, Math.round(usageDoc.data.forecastUsed))
      : 0;

  const insightsUsed = Math.max(rawInsightsUsed, floorEntry?.insightsUsed || 0);
  const advisorUsed = Math.max(rawAdvisorUsed, floorEntry?.advisorUsed || 0);
  const forecastUsed = Math.max(rawForecastUsed, floorEntry?.forecastUsed || 0);
  const lastResetIso =
    !needsPeriodReset && usageDoc.exists && typeof usageDoc.data.lastResetAt === 'string'
      ? usageDoc.data.lastResetAt
      : new Date(nowMs).toISOString();

  const aiUsage: BackendAiUsageSnapshot = {
    tier: effectiveVipTier,
    periodKey: quotaWindow.periodKey,
    periodStartIso: quotaWindow.periodStartIso,
    periodEndIso: quotaWindow.periodEndIso,
    insightsUsed,
    insightsLimit: tierSpec.insightsLimit,
    insightsRemaining: Math.max(0, tierSpec.insightsLimit - insightsUsed),
    advisorUsed,
    advisorLimit: tierSpec.advisorLimit,
    advisorRemaining: Math.max(0, tierSpec.advisorLimit - advisorUsed),
    forecastUsed,
    lastResetIso,
    persistedExists: usageDoc.exists,
    needsPeriodReset,
  };

  const warningCount =
    secDoc.exists && typeof secDoc.data.warningCount === 'number' ? secDoc.data.warningCount : 0;
  const riskLevelRaw = secDoc.exists ? String(secDoc.data.riskLevel || 'low') : 'low';
  const riskLevel: BackendRiskLevel =
    riskLevelRaw === 'critical' || riskLevelRaw === 'high' || riskLevelRaw === 'medium'
      ? riskLevelRaw
      : 'low';

  const isPermanentBan = rawBanType === 'permanent' || rawRestriction === 'perm_banned';
  const isTemporaryBanActive =
    (rawBanType === 'temporary' || rawRestriction === 'temp_banned') &&
    banExpiresMs !== null &&
    banExpiresMs > nowMs;

  if (!isAdmin && accountStatus === 'deactivated') {
    recordBackendSecurityEvent({
      userId: verified.uid,
      userEmail: verified.email,
      category: 'account_security',
      eventType: 'deactivation_bypass_attempt',
      riskLevel: 'high',
      riskScore: 66,
      summary: `Deactivated account attempted protected backend call (${endpointLabel})`,
      evidence: `uid=${verified.uid}, IP=${clientIp}`,
    });
    return {
      allowed: false,
      status: 403,
      body: {
        error: 'Your FinTrack account is deactivated. Protected features and APIs are blocked.',
        code: 'ACCOUNT_DEACTIVATED',
      },
    };
  }

  if (!isAdmin && (isPermanentBan || isTemporaryBanActive)) {
    recordBackendSecurityEvent({
      userId: verified.uid,
      userEmail: verified.email,
      category: 'account_security',
      eventType: 'deactivation_bypass_attempt',
      riskLevel: isPermanentBan ? 'critical' : 'high',
      riskScore: isPermanentBan ? 82 : 68,
      summary: `Banned account (${isPermanentBan ? 'permanent' : 'temporary'}) attempted backend call (${endpointLabel})`,
      evidence: `uid=${verified.uid}, banType=${isPermanentBan ? 'permanent' : 'temporary'}, IP=${clientIp}`,
    });
    return {
      allowed: false,
      status: 403,
      body: {
        error: isPermanentBan
          ? 'Your FinTrack account is permanently banned from accessing protected services.'
          : 'Your FinTrack account is temporarily banned from accessing protected services.',
        code: 'ACCOUNT_BANNED',
        banType: isPermanentBan ? 'permanent' : 'temporary',
        banExpiresAt: banExpiresAtIso,
        banReason: banReason || 'Account restriction enforced by FinTrack Security Center.',
      },
    };
  }

  if (!isAdmin && options.checkAiAccess && aiRestrictedMs !== null && aiRestrictedMs > nowMs) {
    recordBackendSecurityEvent({
      userId: verified.uid,
      userEmail: verified.email,
      category: 'api_backend_security',
      eventType: 'unauthorized_api_request',
      riskLevel: 'medium',
      riskScore: 48,
      summary: `AI-restricted user attempted AI endpoint ${endpointLabel}`,
      evidence: `uid=${verified.uid}, restrictedUntil=${aiRestrictedUntilIso}, IP=${clientIp}`,
    });
    return {
      allowed: false,
      status: 403,
      body: {
        error: 'AI access is temporarily restricted on your account.',
        code: 'AI_RESTRICTED',
        restrictedUntil: aiRestrictedUntilIso,
      },
    };
  }

  if (options.checkMessagingAccess) {
    const msgRestrictedMs = parseIsoMs(messagingRestrictedUntilIso);
    if (!isAdmin && msgRestrictedMs !== null && msgRestrictedMs > nowMs) {
      return {
        allowed: false,
        status: 403,
        body: {
          error: 'Messaging is temporarily restricted on your account.',
          code: 'MESSAGING_RESTRICTED',
          restrictedUntil: messagingRestrictedUntilIso,
        },
      };
    }
  }

  if (options.checkVipAccess && options.claimedVip && vipStatus !== 'vip' && !isAdmin) {
    recordBackendSecurityEvent({
      userId: verified.uid,
      userEmail: verified.email,
      category: 'vip_payment_security',
      eventType: 'unauthorized_vip_access',
      riskLevel: 'high',
      riskScore: 76,
      summary: 'Unauthorized VIP entitlement claim rejected on backend verification',
      evidence: `uid=${verified.uid}, claimedVip=true, actualVipStatus=${vipStatus}, IP=${clientIp}`,
    });
    return {
      allowed: false,
      status: 403,
      body: {
        error: 'VIP membership entitlement could not be verified on the backend.',
        code: 'VIP_ENTITLEMENT_REQUIRED',
        vipStatus,
        vipTier: effectiveVipTier,
      },
    };
  }

  if (
    options.claimedTier &&
    !isAdmin &&
    !tierMeetsMinimum(effectiveVipTier, options.claimedTier)
  ) {
    recordBackendSecurityEvent({
      userId: verified.uid,
      userEmail: verified.email,
      category: 'vip_payment_security',
      eventType: 'subscription_bypass_attempt',
      riskLevel: 'high',
      riskScore: 72,
      summary: `Client claimed ${options.claimedTier} tier while backend tier is ${effectiveVipTier}`,
      evidence: `uid=${verified.uid}, endpoint=${endpointLabel}, IP=${clientIp}`,
    });
    return {
      allowed: false,
      status: 403,
      body: {
        error: `Subscription tier verification failed. Active plan is ${tierSpec.name}.`,
        code: 'TIER_UPGRADE_REQUIRED',
        currentTier: effectiveVipTier,
        requiredTier: options.claimedTier,
      },
    };
  }

  if (
    options.requiredVipTier &&
    !isAdmin &&
    !tierMeetsMinimum(effectiveVipTier, options.requiredVipTier)
  ) {
    const reqSpec = BACKEND_VIP_TIERS[options.requiredVipTier];
    return {
      allowed: false,
      status: 403,
      body: {
        error: `This feature requires ${reqSpec.classLabel} (${reqSpec.name}) or higher. Your active plan is ${tierSpec.classLabel} (${tierSpec.name}).`,
        code: 'TIER_UPGRADE_REQUIRED',
        currentTier: effectiveVipTier,
        requiredTier: options.requiredVipTier,
        usage: aiUsage,
      },
    };
  }

  if (options.aiQuotaType && !isAdmin) {
    if (options.aiQuotaType === 'insights' || options.aiQuotaType === 'forecast') {
      if (aiUsage.insightsLimit <= 0 || aiUsage.insightsUsed >= aiUsage.insightsLimit) {
        return {
          allowed: false,
          status: 429,
          body: {
            error: `Monthly AI Insights allowance (${aiUsage.insightsLimit}/month on ${tierSpec.name}) reached for this billing period. Resets on ${new Date(
              aiUsage.periodEndIso
            ).toLocaleDateString('en-IN')}.`,
            code: 'AI_QUOTA_EXCEEDED',
            quotaType: options.aiQuotaType,
            currentTier: effectiveVipTier,
            usage: aiUsage,
          },
        };
      }
    } else if (options.aiQuotaType === 'advisor') {
      if (aiUsage.advisorLimit <= 0 || aiUsage.advisorUsed >= aiUsage.advisorLimit) {
        return {
          allowed: false,
          status: 429,
          body: {
            error: `Monthly AI Advisor message allowance (${aiUsage.advisorLimit}/month on ${tierSpec.name}) reached for this billing period. Resets on ${new Date(
              aiUsage.periodEndIso
            ).toLocaleDateString('en-IN')}.`,
            code: 'AI_QUOTA_EXCEEDED',
            quotaType: 'advisor',
            currentTier: effectiveVipTier,
            usage: aiUsage,
          },
        };
      }
    }
  }

  const effectiveRestrictionStatus: CallerSecuritySnapshot['restrictionStatus'] = isPermanentBan
    ? 'perm_banned'
    : isTemporaryBanActive
    ? 'temp_banned'
    : rawRestriction === 'under_investigation'
    ? 'under_investigation'
    : 'active';

  const effectiveBanType: CallerSecuritySnapshot['banType'] = isPermanentBan
    ? 'permanent'
    : isTemporaryBanActive
    ? 'temporary'
    : 'none';

  return {
    allowed: true,
    token: verified,
    idToken: tokenStr,
    snapshot: {
      uid: verified.uid,
      email: verified.email,
      emailVerified: verified.emailVerified,
      isAdmin,
      accountStatus,
      restrictionStatus: effectiveRestrictionStatus,
      banType: effectiveBanType,
      banReason,
      banDurationLabel,
      banExpiresAtIso: isTemporaryBanActive ? banExpiresAtIso : null,
      aiRestrictedUntilIso:
        aiRestrictedMs !== null && aiRestrictedMs > nowMs ? aiRestrictedUntilIso : null,
      messagingRestrictedUntilIso:
        parseIsoMs(messagingRestrictedUntilIso) !== null &&
        (parseIsoMs(messagingRestrictedUntilIso) as number) > nowMs
          ? messagingRestrictedUntilIso
          : null,
      vipStatus,
      vipTier: effectiveVipTier,
      billingCycle: subCycle,
      subscriptionStatus: effectiveSubStatus,
      subscriptionEndIso: isSubActiveWindow ? subPeriodEndIso : null,
      aiUsage,
      warningCount,
      riskLevel,
    },
  };
}

export async function consumeAiUsageQuota(
  guard: Extract<SecurityGuardResult, { allowed: true }>,
  quotaType: 'insights' | 'advisor' | 'forecast'
): Promise<BackendAiUsageSnapshot> {
  const { snapshot, idToken } = guard;
  const current = snapshot.aiUsage;

  const nextInsightsUsed =
    quotaType === 'insights' || quotaType === 'forecast'
      ? current.insightsUsed + 1
      : current.insightsUsed;
  const nextAdvisorUsed =
    quotaType === 'advisor' ? current.advisorUsed + 1 : current.advisorUsed;
  const nextForecastUsed =
    quotaType === 'forecast' ? current.forecastUsed + 1 : current.forecastUsed;

  setServerAiUsageFloor(snapshot.uid, current.periodKey, {
    insightsUsed: nextInsightsUsed,
    advisorUsed: nextAdvisorUsed,
    forecastUsed: nextForecastUsed,
  });

  const fields: Record<string, FirestoreWriteValue> = {
    userId: { type: 'string', value: snapshot.uid },
    tier: { type: 'string', value: current.tier },
    periodKey: { type: 'string', value: current.periodKey },
    periodStartAt: { type: 'timestamp', value: current.periodStartIso },
    periodEndAt: { type: 'timestamp', value: current.periodEndIso },
    insightsUsed: { type: 'number', value: nextInsightsUsed },
    insightsLimit: { type: 'number', value: current.insightsLimit },
    advisorUsed: { type: 'number', value: nextAdvisorUsed },
    advisorLimit: { type: 'number', value: current.advisorLimit },
    forecastUsed: { type: 'number', value: nextForecastUsed },
    lastResetAt: { type: 'timestamp', value: current.lastResetIso },
    updatedAt: { type: 'timestamp', value: new Date().toISOString() },
  };

  const serverTimestampFields = current.needsPeriodReset
    ? ['lastResetAt', 'updatedAt']
    : ['updatedAt'];

  await commitFirestoreDocAsCaller({
    documentPath: `aiUsage/${snapshot.uid}`,
    idToken,
    fields,
    serverTimestampFields,
  });

  return {
    ...current,
    insightsUsed: nextInsightsUsed,
    insightsRemaining: Math.max(0, current.insightsLimit - nextInsightsUsed),
    advisorUsed: nextAdvisorUsed,
    advisorRemaining: Math.max(0, current.advisorLimit - nextAdvisorUsed),
    forecastUsed: nextForecastUsed,
    persistedExists: true,
    needsPeriodReset: false,
  };
}

