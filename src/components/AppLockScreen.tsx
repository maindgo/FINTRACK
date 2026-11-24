import React, { useCallback, useEffect, useState } from 'react';
import { Delete, Fingerprint, Lock, RotateCcw, ShieldCheck, Wallet } from 'lucide-react';
import {
  SecurityLockConfig,
  verifyBiometricLock,
  verifyPinInput,
} from '../services/securityService';

interface AppLockScreenProps {
  config: SecurityLockConfig;
  isSignedInOrGuest: boolean;
  onUnlock: () => void;
  onResetLockAndSignOut: () => Promise<void>;
}

export function AppLockScreen({
  config,
  isSignedInOrGuest,
  onUnlock,
  onResetLockAndSignOut,
}: AppLockScreenProps) {
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(() => {
    const diff = config.lockedUntilTs - Date.now();
    return diff > 0 ? Math.ceil(diff / 1000) : 0;
  });
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Cooldown timer countdown
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const timer = setInterval(() => {
      setCooldownLeft((prev) => {
        if (prev <= 1) {
          setErrorMsg('');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownLeft]);

  const submitPin = useCallback(
    async (candidatePin: string) => {
      if (!config.pinEnabled || verifying || cooldownLeft > 0) return;
      setVerifying(true);
      setErrorMsg('');
      try {
        const res = await verifyPinInput(candidatePin);
        if (res.ok) {
          setPin('');
          onUnlock();
        } else {
          setPin('');
          if (res.cooldownSeconds > 0) {
            setCooldownLeft(res.cooldownSeconds);
          }
          setErrorMsg(res.message || 'Incorrect PIN.');
        }
      } finally {
        setVerifying(false);
      }
    },
    [config.pinEnabled, verifying, cooldownLeft, onUnlock]
  );

  const handleDigit = useCallback(
    (digit: string) => {
      if (!config.pinEnabled || verifying || cooldownLeft > 0) return;
      setErrorMsg('');
      setPin((prev) => {
        if (prev.length >= config.pinLength) return prev;
        const next = prev + digit;
        if (next.length === config.pinLength) {
          void submitPin(next);
        }
        return next;
      });
    },
    [config.pinEnabled, config.pinLength, verifying, cooldownLeft, submitPin]
  );

  const handleBackspace = useCallback(() => {
    if (verifying || cooldownLeft > 0) return;
    setErrorMsg('');
    setPin((prev) => prev.slice(0, -1));
  }, [verifying, cooldownLeft]);

  const handleBiometricUnlock = useCallback(async () => {
    if (!config.biometricEnabled || biometricBusy) return;
    setBiometricBusy(true);
    setErrorMsg('');
    try {
      const res = await verifyBiometricLock();
      if (res.ok) {
        onUnlock();
      } else {
        setErrorMsg(res.message || 'Biometric unlock failed.');
      }
    } finally {
      setBiometricBusy(false);
    }
  }, [config.biometricEnabled, biometricBusy, onUnlock]);

  // Physical keyboard support for PIN entry
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (confirmReset) return;
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Enter' && pin.length >= 4) {
        e.preventDefault();
        void submitPin(pin);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmReset, handleDigit, handleBackspace, pin, submitPin]);

  const handleResetConfirm = async () => {
    setResetting(true);
    try {
      await onResetLockAndSignOut();
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-6 sm:p-7 space-y-6">
        {/* Brand & Lock Header */}
        <div className="text-center space-y-2.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto relative">
            <Wallet className="w-6 h-6" />
            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-slate-900 dark:bg-slate-800 border-2 border-white dark:border-slate-900 flex items-center justify-center">
              <Lock className="w-2.5 h-2.5 text-emerald-400" />
            </span>
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              FinTrack Security Lock
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isSignedInOrGuest
                ? 'Verify your identity to access your financial ledger.'
                : 'Verify your PIN or biometrics before signing in.'}
            </p>
          </div>
        </div>

        {/* Error / Cooldown Message */}
        {(errorMsg || cooldownLeft > 0) && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-center text-red-700 dark:text-red-300">
            {cooldownLeft > 0 ? `Too many wrong attempts. Try again in ${cooldownLeft}s.` : errorMsg}
          </div>
        )}

        {/* Biometric Unlock Button */}
        {config.biometricEnabled && (
          <button
            type="button"
            disabled={biometricBusy}
            onClick={handleBiometricUnlock}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
          >
            <Fingerprint className="w-5 h-5 shrink-0" />
            <span>
              {biometricBusy ? 'Verifying Biometrics...' : 'Unlock with Fingerprint / Face ID'}
            </span>
          </button>
        )}

        {/* PIN Entry Section */}
        {config.pinEnabled && (
          <div className="space-y-5">
            {config.biometricEnabled && (
              <div className="relative flex items-center">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                <span className="px-3 text-[11px] text-slate-400">or enter {config.pinLength}-digit PIN</span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
              </div>
            )}

            {/* PIN Dots */}
            <div className="flex items-center justify-center gap-3.5 py-1" aria-label="PIN progress">
              {Array.from({ length: config.pinLength }).map((_, i) => {
                const filled = i < pin.length;
                return (
                  <span
                    key={i}
                    className={`w-3.5 h-3.5 rounded-full transition-all border ${
                      filled
                        ? 'bg-emerald-600 border-emerald-600 scale-110'
                        : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700'
                    }`}
                  />
                );
              })}
            </div>

            {/* Numeric Keypad */}
            <div className="grid grid-cols-3 gap-2.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  disabled={verifying || cooldownLeft > 0}
                  onClick={() => handleDigit(digit)}
                  className="h-12 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-base font-mono font-semibold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-40"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                disabled={verifying || cooldownLeft > 0 || pin.length === 0}
                onClick={() => setPin('')}
                className="h-12 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={verifying || cooldownLeft > 0}
                onClick={() => handleDigit('0')}
                className="h-12 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-base font-mono font-semibold text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-40"
              >
                0
              </button>
              <button
                type="button"
                disabled={verifying || cooldownLeft > 0 || pin.length === 0}
                onClick={handleBackspace}
                aria-label="Backspace"
                className="h-12 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
              >
                <Delete className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Safe Forgot PIN / Reset Section */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          {!confirmReset ? (
            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Device-protected lock
              </span>
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="font-medium text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 hover:underline"
              >
                Forgot PIN / Reset?
              </button>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 space-y-2.5">
              <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                For your security, resetting the App Lock will also sign out any active cloud or guest session on this browser.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={resetting}
                  onClick={handleResetConfirm}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700 disabled:opacity-50"
                >
                  <RotateCcw className="w-3 h-3" />
                  {resetting ? 'Resetting...' : 'Reset Lock & Sign Out'}
                </button>
                <button
                  type="button"
                  disabled={resetting}
                  onClick={() => setConfirmReset(false)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-medium text-slate-700 dark:text-slate-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
