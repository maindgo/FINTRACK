import crypto from 'crypto';
import type { HandlerResult } from './aiHandlers';
import {
  commitFirestoreDocAsCaller,
  fetchFirestoreDocAsCaller,
  type FirestoreWriteValue,
} from './firebaseAuth';
import {
  getBackendSecurityTelemetry,
  getClientIpFromHeaders,
  recordBackendSecurityEvent,
  trackFailedLoginEvent,
  trackSignupPatternEvent,
  type SecurityGuardResult,
} from './securityGuard';
import {
  BACKEND_VIP_TIERS,
  buildUpiPaymentUri,
  isValidBillingCycle,
  isValidVipTier,
  MERCHANT_UPI_ID,
} from './vipConfig';

function cleanStr(v: unknown, maxLen: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
}

export function handleSecurityStatus(
  guard: Extract<SecurityGuardResult, { allowed: true }>
): HandlerResult {
  return {
    status: 200,
    body: {
      ok: true,
      security: guard.snapshot,
    },
  };
}

export function handleAuthSecurityEvent(
  rawBody: unknown,
  headers: Record<string, string | string[] | undefined>,
  fallbackIp = 'unknown'
): HandlerResult {
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as {
    eventType?: unknown;
    email?: unknown;
    userId?: unknown;
    errorCode?: unknown;
  };

  const eventType = cleanStr(body.eventType, 40);
  const email = cleanStr(body.email, 160).toLowerCase();
  const userId = cleanStr(body.userId, 128);
  const errorCode = cleanStr(body.errorCode, 80);
  const clientIp = getClientIpFromHeaders(headers, fallbackIp);

  if (eventType === 'failed_login') {
    const tracked = trackFailedLoginEvent({
      email,
      clientIp,
      userId,
    });
    return {
      status: 200,
      body: {
        ok: true,
        recorded: tracked.recorded,
        attemptsInWindow: tracked.attemptsInWindow,
      },
    };
  }

  if (eventType === 'signup_created') {
    const tracked = trackSignupPatternEvent({
      email,
      clientIp,
      userId,
    });
    return {
      status: 200,
      body: {
        ok: true,
        recorded: tracked.recorded,
        accountsInWindow: tracked.accountsInWindow,
      },
    };
  }

  if (eventType === 'unauthorized_account_access') {
    recordBackendSecurityEvent({
      userId: userId || `email:${email || clientIp}`,
      userEmail: email,
      category: 'account_security',
      eventType: 'unauthorized_account_access',
      riskLevel: 'medium',
      riskScore: 48,
      summary: `Unauthorized account access probe reported (${errorCode || 'auth_probe'})`,
      evidence: `email=${email || 'unknown'}, errorCode=${errorCode || 'none'}, IP=${clientIp}`,
    });
    return {
      status: 200,
      body: { ok: true, recorded: true },
    };
  }

  return {
    status: 400,
    body: {
      error: 'Unsupported auth security event type.',
      code: 'BAD_REQUEST',
    },
  };
}

export function handleVipEntitlementCheck(
  guard: Extract<SecurityGuardResult, { allowed: true }>
): HandlerResult {
  const { snapshot } = guard;
  return {
    status: 200,
    body: {
      ok: true,
      vipStatus: snapshot.vipStatus,
      vipTier: snapshot.vipTier,
      billingCycle: snapshot.billingCycle,
      subscriptionStatus: snapshot.subscriptionStatus,
      subscriptionEndIso: snapshot.subscriptionEndIso,
      aiUsage: snapshot.aiUsage,
      isVipActive: snapshot.vipStatus === 'vip',
      restrictionStatus: snapshot.restrictionStatus,
      isAdmin: snapshot.isAdmin,
      verifiedAt: new Date().toISOString(),
    },
  };
}

export function handleVipStatus(
  guard: Extract<SecurityGuardResult, { allowed: true }>
): HandlerResult {
  const { snapshot } = guard;
  return {
    status: 200,
    body: {
      ok: true,
      tier: snapshot.vipTier,
      plan: BACKEND_VIP_TIERS[snapshot.vipTier],
      billingCycle: snapshot.billingCycle,
      subscriptionStatus: snapshot.subscriptionStatus,
      subscriptionEndIso: snapshot.subscriptionEndIso,
      aiUsage: snapshot.aiUsage,
      catalog: BACKEND_VIP_TIERS,
      verifiedAt: new Date().toISOString(),
    },
  };
}

export async function handleVipSubscribe(
  rawBody: unknown,
  guard: Extract<SecurityGuardResult, { allowed: true }>
): Promise<HandlerResult> {
  const body = (rawBody && typeof rawBody === 'object' ? rawBody : {}) as {
    tier?: unknown;
    billingCycle?: unknown;
    submittedPriceInr?: unknown;
    paymentMethodLabel?: unknown;
    paymentReference?: unknown;
    utrReference?: unknown;
    displayName?: unknown;
  };

  if (!isValidVipTier(body.tier)) {
    return {
      status: 400,
      body: { error: 'Invalid VIP tier selected.', code: 'INVALID_TIER' },
    };
  }

  if (!isValidBillingCycle(body.billingCycle)) {
    return {
      status: 400,
      body: { error: 'Invalid billing cycle selected.', code: 'INVALID_BILLING_CYCLE' },
    };
  }

  const tier = body.tier;
  const billingCycle = body.billingCycle;
  const tierSpec = BACKEND_VIP_TIERS[tier];
  const authoritativePriceInr = tierSpec.pricesInr[billingCycle];

  if (body.submittedPriceInr !== undefined && body.submittedPriceInr !== null) {
    const submitted = Number(body.submittedPriceInr);
    if (!Number.isFinite(submitted) || submitted !== authoritativePriceInr) {
      recordBackendSecurityEvent({
        userId: guard.snapshot.uid,
        userEmail: guard.snapshot.email,
        category: 'vip_payment_security',
        eventType: 'payment_verification_inconsistency',
        riskLevel: 'high',
        riskScore: 78,
        summary: `Price mismatch on VIP UPI request (${tier}/${billingCycle}): submitted ₹${submitted}, expected ₹${authoritativePriceInr}`,
        evidence: `uid=${guard.snapshot.uid}, paymentMethod=${cleanStr(body.paymentMethodLabel, 40) || 'UPI'}`,
      });
      return {
        status: 400,
        body: {
          error: `Subscription price verification failed for ${tierSpec.name} (${billingCycle}). Expected ₹${authoritativePriceInr}.`,
          code: 'PRICE_MISMATCH',
        },
      };
    }
  }

  const rawUtr = cleanStr(body.utrReference, 64);
  if (rawUtr.length < 4) {
    return {
      status: 400,
      body: {
        error: 'Please enter a valid UPI Transaction ID / UTR Reference (minimum 4 characters) after completing payment.',
        code: 'MISSING_UTR_REFERENCE',
      },
    };
  }

  const candidateRef = cleanStr(body.paymentReference, 64);
  const paymentReference = /^FTPAY-[a-zA-Z0-9_-]{4,48}$/.test(candidateRef)
    ? candidateRef
    : `FTPAY-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

  const paymentMethodLabel =
    cleanStr(body.paymentMethodLabel, 60) || `UPI (${MERCHANT_UPI_ID})`;

  const userProfileDoc = await fetchFirestoreDocAsCaller(
    `users/${guard.snapshot.uid}`,
    guard.idToken
  );
  const resolvedDisplayName =
    (userProfileDoc.exists && cleanStr(userProfileDoc.data.displayName, 100)) ||
    cleanStr(body.displayName, 100) ||
    cleanStr(guard.snapshot.email.split('@')[0], 100) ||
    'FinTrack User';

  const nowIso = new Date().toISOString();
  const requestId = `vipreq-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const requestFields: Record<string, FirestoreWriteValue> = {
    userId: { type: 'string', value: guard.snapshot.uid },
    userEmail: { type: 'string', value: guard.snapshot.email || 'user@fintrack.app' },
    displayName: { type: 'string', value: resolvedDisplayName },
    tier: { type: 'string', value: tier },
    billingCycle: { type: 'string', value: billingCycle },
    amountInr: { type: 'number', value: authoritativePriceInr },
    upiId: { type: 'string', value: MERCHANT_UPI_ID },
    paymentReference: { type: 'string', value: paymentReference },
    utrReference: { type: 'string', value: rawUtr },
    paymentMethodLabel: { type: 'string', value: paymentMethodLabel },
    status: { type: 'string', value: 'pending' },
    adminNote: { type: 'string', value: '' },
    reviewedBy: { type: 'string', value: '' },
    reviewedAt: { type: 'null' },
    createdAt: { type: 'timestamp', value: nowIso },
    updatedAt: { type: 'timestamp', value: nowIso },
  };

  const commitRes = await commitFirestoreDocAsCaller({
    documentPath: `vipPaymentRequests/${requestId}`,
    idToken: guard.idToken,
    fields: requestFields,
    serverTimestampFields: ['createdAt', 'updatedAt'],
  });

  if (!commitRes.ok) {
    return {
      status: commitRes.status >= 400 && commitRes.status < 600 ? commitRes.status : 500,
      body: {
        error: commitRes.errorMessage || 'Could not submit VIP payment verification request.',
        code: 'PAYMENT_REQUEST_WRITE_FAILED',
      },
    };
  }

  const upiDeepLink = buildUpiPaymentUri({
    amountInr: authoritativePriceInr,
    tierName: tierSpec.name,
    billingCycle,
    paymentReference,
  });

  return {
    status: 200,
    body: {
      ok: true,
      pendingApproval: true,
      status: 'pending',
      requestId,
      tier,
      billingCycle,
      amountInr: authoritativePriceInr,
      upiId: MERCHANT_UPI_ID,
      upiDeepLink,
      paymentReference,
      utrReference: rawUtr,
      submittedAtIso: nowIso,
    },
  };
}

export async function handleVipCancel(
  guard: Extract<SecurityGuardResult, { allowed: true }>
): Promise<HandlerResult> {
  const existingSub = await fetchFirestoreDocAsCaller(
    `vipSubscriptions/${guard.snapshot.uid}`,
    guard.idToken
  );

  if (!existingSub.exists) {
    return {
      status: 404,
      body: {
        error: 'No active VIP subscription record found to cancel.',
        code: 'SUBSCRIPTION_NOT_FOUND',
      },
    };
  }

  const tier = isValidVipTier(existingSub.data.tier) ? existingSub.data.tier : 'starter';
  const billingCycle = isValidBillingCycle(existingSub.data.billingCycle)
    ? existingSub.data.billingCycle
    : 'monthly';
  const priceInr = Number(existingSub.data.priceInr) || BACKEND_VIP_TIERS[tier].pricesInr[billingCycle];
  const paymentReference = String(existingSub.data.paymentReference || 'FTVIP-LEGACY');
  const periodKey = String(existingSub.data.periodKey || 'sub-cancelled');
  const periodStartAt = String(existingSub.data.periodStartAt || new Date().toISOString());
  const periodEndAt = String(existingSub.data.periodEndAt || new Date().toISOString());
  const createdAt = String(existingSub.data.createdAt || periodStartAt);

  const commitRes = await commitFirestoreDocAsCaller({
    documentPath: `vipSubscriptions/${guard.snapshot.uid}`,
    idToken: guard.idToken,
    fields: {
      userId: { type: 'string', value: guard.snapshot.uid },
      tier: { type: 'string', value: tier },
      billingCycle: { type: 'string', value: billingCycle },
      status: { type: 'string', value: 'cancelled' },
      priceInr: { type: 'number', value: priceInr },
      paymentReference: { type: 'string', value: paymentReference },
      periodKey: { type: 'string', value: periodKey },
      periodStartAt: { type: 'timestamp', value: periodStartAt },
      periodEndAt: { type: 'timestamp', value: periodEndAt },
      autoRenew: { type: 'boolean', value: false },
      updatedBy: { type: 'string', value: guard.snapshot.email || guard.snapshot.uid },
      createdAt: { type: 'timestamp', value: createdAt },
      updatedAt: { type: 'timestamp', value: new Date().toISOString() },
    },
    serverTimestampFields: ['updatedAt'],
  });

  if (!commitRes.ok) {
    return {
      status: commitRes.status >= 400 && commitRes.status < 600 ? commitRes.status : 500,
      body: {
        error: commitRes.errorMessage || 'Could not update subscription cancellation.',
        code: 'CANCEL_FAILED',
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      status: 'cancelled',
      autoRenew: false,
      tier,
      periodEndIso: periodEndAt,
    },
  };
}

export function handleAdminSecurityTelemetry(
  guard: Extract<SecurityGuardResult, { allowed: true }>
): HandlerResult {
  return {
    status: 200,
    body: {
      ok: true,
      adminEmail: guard.token.email,
      events: getBackendSecurityTelemetry(),
      fetchedAt: new Date().toISOString(),
    },
  };
}
