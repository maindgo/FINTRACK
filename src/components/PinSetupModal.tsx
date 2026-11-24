import React, { useEffect, useState } from 'react';
import { Fingerprint, KeyRound, Lock, ShieldCheck, X } from 'lucide-react';
import {
  disableBiometricLock,
  disablePinLock,
  enablePinLock,
  enrollBiometricLock,
  isBiometricHardwareAvailable,
  loadSecurityConfig,
  SecurityLockConfig,
} from '../services/securityService';

interface PinSetupModalProps {
  open: boolean;
  ownerLabel?: string;
  onClose: () => void;
  onUpdated?: (next: SecurityLockConfig) => void;
}

export function PinSetupModal({
  open,
  ownerLabel = 'FinTrack Owner',
  onClose,
  onUpdated,
}: PinSetupModalProps) {
  const [config, setConfig] = useState<SecurityLockConfig>(() => loadSecurityConfig());
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinLength, setPinLength] = useState<4 | 6>(4);
  const [savingPin, setSavingPin] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [hwStatus, setHwStatus] = useState<{ supported: boolean; platformAvailable: boolean; reason?: string }>({
    supported: true,
    platformAvailable: false,
  });
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const latest = loadSecurityConfig();
    setConfig(latest);
    setPinLength(latest.pinLength === 6 ? 6 : 4);
    setPin('');
    setConfirmPin('');
    setFeedback(null);
    void isBiometricHardwareAvailable().then(setHwStatus);
  }, [open]);

  if (!open) return null;

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!/^\d{4,6}$/.test(pin) || pin.length !== pinLength) {
      setFeedback({ ok: false, text: `Please enter a ${pinLength}-digit numeric PIN.` });
      return;
    }
    if (pin !== confirmPin) {
      setFeedback({ ok: false, text: 'PIN and Confirm PIN do not match.' });
      return;
    }
    setSavingPin(true);
    try {
      const next = await enablePinLock(pin);
      setConfig(next);
      setPin('');
      setConfirmPin('');
      onUpdated?.(next);
      setFeedback({
        ok: true,
        text: 'PIN lock saved! FinTrack will now ask for your PIN before login and on launch.',
      });
    } catch (err: unknown) {
      setFeedback({ ok: false, text: (err as Error)?.message || 'Failed to save PIN.' });
    } finally {
      setSavingPin(false);
    }
  };

  const handleDisablePin = () => {
    const next = disablePinLock();
    setConfig(next);
    onUpdated?.(next);
    setFeedback({ ok: true, text: 'PIN lock removed.' });
  };

  const handleToggleBiometric = async () => {
    setFeedback(null);
    if (config.biometricEnabled) {
      const next = disableBiometricLock();
      setConfig(next);
      onUpdated?.(next);
      setFeedback({ ok: true, text: 'Biometric authentication disabled.' });
      return;
    }

    setBioBusy(true);
    try {
      const res = await enrollBiometricLock(ownerLabel);
      if (res.ok && res.config) {
        setConfig(res.config);
        onUpdated?.(res.config);
      }
      setFeedback({ ok: res.ok, text: res.message });
    } finally {
      setBioBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              App Security · PIN &amp; Biometric Lock
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close security modal"
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[85vh] overflow-y-auto">
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Protect FinTrack with a PIN code and/or device biometrics (Fingerprint / Face ID). When enabled,
            the lock screen appears before logging in and whenever you reopen the app.
          </p>

          {feedback && (
            <div
              className={`p-3 rounded-lg text-xs border ${
                feedback.ok
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {/* PIN Configuration */}
          <form onSubmit={handleSavePin} className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-slate-700 dark:text-slate-300" />
                <span className="text-xs font-semibold text-slate-900 dark:text-white">
                  {config.pinEnabled ? `Change ${config.pinLength}-Digit PIN` : 'Set Up PIN Lock'}
                </span>
              </div>
              <div className="flex items-center gap-1 p-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                {([4, 6] as const).map((len) => (
                  <button
                    key={len}
                    type="button"
                    onClick={() => {
                      setPinLength(len);
                      setPin('');
                      setConfirmPin('');
                    }}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded ${
                      pinLength === len
                        ? 'bg-slate-900 dark:bg-emerald-600 text-white'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {len}-digit
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Enter PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={pinLength}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, pinLength))}
                  placeholder={pinLength === 4 ? '••••' : '••••••'}
                  className="w-full px-3 py-2 text-sm font-mono tracking-widest rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Confirm PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={pinLength}
                  value={confirmPin}
                  onChange={(e) =>
                    setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, pinLength))
                  }
                  placeholder={pinLength === 4 ? '••••' : '••••••'}
                  className="w-full px-3 py-2 text-sm font-mono tracking-widest rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="submit"
                disabled={savingPin}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50"
              >
                <Lock className="w-3.5 h-3.5" />
                {savingPin ? 'Saving...' : config.pinEnabled ? 'Update PIN' : 'Enable PIN Lock'}
              </button>
              {config.pinEnabled && (
                <button
                  type="button"
                  onClick={handleDisablePin}
                  className="px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  Remove PIN
                </button>
              )}
            </div>
          </form>

          {/* Biometric Authentication */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white">
                    Biometric Lock (Fingerprint / Face ID)
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {config.biometricEnabled
                      ? 'Active on this device'
                      : hwStatus.platformAvailable
                      ? 'Ready on your device'
                      : hwStatus.reason || 'Requires device biometric hardware'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                disabled={bioBusy}
                onClick={handleToggleBiometric}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                  config.biometricEnabled
                    ? 'border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                } disabled:opacity-50`}
              >
                {bioBusy
                  ? 'Verifying...'
                  : config.biometricEnabled
                  ? 'Disable'
                  : 'Enable Biometrics'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
