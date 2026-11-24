import {
  BrowserNotificationPermission,
  FinTrackNotification,
  NotificationPrefs,
} from '../types/finance';

const PREFS_KEY_PREFIX = 'fintrack-notif-prefs-v1';
const SENT_KEY_PREFIX = 'fintrack-notif-sent-v1';

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  pushToDeviceBar: true,
  showTopAlertBanner: true,
  categories: {
    bills: true,
    budgets: true,
    debts: true,
    insights: true,
    savings: true,
    recurring: true,
  },
  readSignatures: [],
  dismissedSignatures: [],
};

function prefsKey(uid: string): string {
  return `${PREFS_KEY_PREFIX}:${uid}`;
}

function sentKey(uid: string): string {
  return `${SENT_KEY_PREFIX}:${uid}`;
}

export function loadNotificationPrefs(uid: string): NotificationPrefs {
  if (typeof window === 'undefined') return DEFAULT_NOTIFICATION_PREFS;
  try {
    const raw = window.localStorage.getItem(prefsKey(uid));
    if (!raw) return DEFAULT_NOTIFICATION_PREFS;
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      enabled: parsed.enabled ?? DEFAULT_NOTIFICATION_PREFS.enabled,
      pushToDeviceBar: parsed.pushToDeviceBar ?? DEFAULT_NOTIFICATION_PREFS.pushToDeviceBar,
      showTopAlertBanner: parsed.showTopAlertBanner ?? DEFAULT_NOTIFICATION_PREFS.showTopAlertBanner,
      categories: {
        ...DEFAULT_NOTIFICATION_PREFS.categories,
        ...(parsed.categories || {}),
      },
      readSignatures: Array.isArray(parsed.readSignatures) ? parsed.readSignatures.slice(-200) : [],
      dismissedSignatures: Array.isArray(parsed.dismissedSignatures)
        ? parsed.dismissedSignatures.slice(-200)
        : [],
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

export function saveNotificationPrefs(uid: string, prefs: NotificationPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      prefsKey(uid),
      JSON.stringify({
        ...prefs,
        readSignatures: prefs.readSignatures.slice(-200),
        dismissedSignatures: prefs.dismissedSignatures.slice(-200),
      })
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (!isNotificationSupported()) return 'unsupported';
  return window.Notification.permission;
}

export function isRunningInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export async function registerNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .getRegistration('/')
      .then((existing) => existing || navigator.serviceWorker.ready)
      .catch(() => null);
  }
  return swRegistrationPromise;
}

export async function requestMobileNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (!isNotificationSupported()) return 'unsupported';
  await registerNotificationServiceWorker();
  try {
    const result = await window.Notification.requestPermission();
    return result;
  } catch {
    return window.Notification.permission || 'denied';
  }
}

async function getReadyRegistrationWithTimeout(ms = 1500): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (existing) return existing;
    const registered = await registerNotificationServiceWorker();
    if (registered) return registered;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  } catch {
    return null;
  }
}

export async function showSystemBarNotification(
  title: string,
  body: string,
  tag: string,
  section = 'dashboard'
): Promise<boolean> {
  if (!isNotificationSupported() || window.Notification.permission !== 'granted') {
    return false;
  }

  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body,
    tag,
    icon: '/fintrack-icon-192.png',
    badge: '/fintrack-icon-192.png',
    renotify: false,
    data: { section },
  };

  try {
    // Prefer ServiceWorkerRegistration.showNotification (required on Android mobile Chrome)
    const reg = await getReadyRegistrationWithTimeout();
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, options);
      return true;
    }
  } catch {
    // Fall through to standard Notification constructor
  }

  try {
    const n = new window.Notification(title, options);
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

function loadSentMap(uid: string): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(sentKey(uid));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveSentMap(uid: string, map: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    const entries = Object.entries(map).slice(-150);
    window.localStorage.setItem(sentKey(uid), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Ignore storage quota errors
  }
}

export async function dispatchNewNotificationsToDeviceBar(
  uid: string,
  notifications: FinTrackNotification[],
  todayStr: string
): Promise<number> {
  if (!isNotificationSupported() || window.Notification.permission !== 'granted') {
    return 0;
  }

  const sentMap = loadSentMap(uid);
  let sentCount = 0;

  // Send up to 3 highest-priority unseen notifications per batch to avoid mobile tray flooding
  const candidates = notifications
    .filter((n) => sentMap[n.signature] !== todayStr)
    .slice(0, 3);

  for (const item of candidates) {
    const ok = await showSystemBarNotification(
      `FinTrack · ${item.title}`,
      item.body,
      item.id,
      item.actionSection
    );
    if (ok) {
      sentMap[item.signature] = todayStr;
      sentCount++;
    }
  }

  if (sentCount > 0) {
    saveSentMap(uid, sentMap);
  }
  return sentCount;
}

export async function sendTestSystemNotification(): Promise<{ ok: boolean; message: string }> {
  if (!isNotificationSupported()) {
    return {
      ok: false,
      message: 'This browser does not support device notification bar alerts.',
    };
  }
  const perm = window.Notification.permission;
  if (perm !== 'granted') {
    return {
      ok: false,
      message:
        perm === 'denied'
          ? 'Notifications are blocked in your browser site settings. Please allow notifications for this site.'
          : 'Please allow notification permission first.',
    };
  }

  const delivered = await showSystemBarNotification(
    'FinTrack Alerts Active',
    'You will receive bill reminders, budget warnings, loan due alerts, and spending insights here.',
    'fintrack-test-notification',
    'settings'
  );

  return delivered
    ? { ok: true, message: 'Test notification sent to your notification bar.' }
    : {
        ok: false,
        message: 'Browser blocked displaying the system notification in this context (try opening the app in its own mobile browser tab).',
      };
}
