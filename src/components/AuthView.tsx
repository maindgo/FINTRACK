import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  User as UserIcon,
  Wallet,
} from 'lucide-react';
import { auth, FIREBASE_PROJECT_ID, googleProvider } from '../firebase';
import { useFinance } from '../context/FinanceContext';
import { PinSetupModal } from './PinSetupModal';
import {
  isAppSecurityConfigured,
  loadSecurityConfig,
  SecurityLockConfig,
} from '../services/securityService';

type AuthMode = 'login' | 'register' | 'forgot';
type SignupAccountType = 'personal' | 'business' | 'other';

export const PENDING_DISPLAY_NAME_KEY = 'fintrack-pending-displayname';

interface AuthViewProps {
  onBackToMaintenance?: () => void;
}

export function AuthView({ onBackToMaintenance }: AuthViewProps = {}) {
  const { firebaseUser, refreshAuthUser, enterGuestMode } = useFinance();
  const [mode, setMode] = useState<AuthMode>('login');
  const [accountType, setAccountType] = useState<SignupAccountType>('personal');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [needsEmailProviderSetup, setNeedsEmailProviderSetup] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [securityConfig, setSecurityConfig] = useState<SecurityLockConfig>(() =>
    loadSecurityConfig()
  );

  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setErrorMsg('Sign-in popup was closed before completion.');
      } else {
        setErrorMsg((err as Error)?.message || 'Failed to sign in with Google.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setNeedsEmailProviderSetup(false);
    setLoading(true);

    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else if (mode === 'register') {
        const cleanName = fullName.trim();
        const cleanBusiness = businessName.trim();
        if (!cleanName && !cleanBusiness) {
          setErrorMsg('Please enter your name, business name, or workspace label.');
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setErrorMsg('Password must be at least 6 characters.');
          setLoading(false);
          return;
        }
        const combinedDisplayName = (
          cleanName && cleanBusiness
            ? `${cleanBusiness} (${cleanName})`
            : cleanBusiness || cleanName
        ).slice(0, 100);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(PENDING_DISPLAY_NAME_KEY, combinedDisplayName);
        }
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: combinedDisplayName });
        await sendEmailVerification(cred.user);
        setInfoMsg('Account created! A verification email has been sent to your inbox.');
      } else if (mode === 'forgot') {
        await sendPasswordResetEmail(auth, email.trim());
        setInfoMsg('Password reset link sent. Please check your inbox and spam folder.');
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setNeedsEmailProviderSetup(true);
        setErrorMsg(
          'Email/Password sign-in is not yet enabled in Firebase Console for this project. Use Google Sign-In below or enable Email/Password in Firebase Auth.'
        );
      } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setErrorMsg('Invalid email or password. Please verify your credentials.');
      } else if (code === 'auth/email-already-in-use') {
        setErrorMsg('An account with this email already exists. Try signing in instead.');
      } else if (code === 'auth/too-many-requests') {
        setErrorMsg('Too many attempts. Please wait a moment and try again.');
      } else {
        setErrorMsg((err as Error)?.message || 'Authentication failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setErrorMsg('');
    try {
      await sendEmailVerification(firebaseUser);
      setInfoMsg('Verification email resent. Check your inbox, then click "I Verified My Email".');
    } catch (err: unknown) {
      setErrorMsg((err as Error)?.message || 'Could not resend verification email.');
    } finally {
      setLoading(false);
    }
  };

  // Verification gate for unverified Email/Password users
  if (firebaseUser && !firebaseUser.emailVerified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 space-y-6">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              Verify your email address
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              To protect your private financial ledger, FinTrack requires email verification before accessing cloud storage. We sent a link to{' '}
              <span className="font-medium text-slate-900 dark:text-slate-200">{firebaseUser.email}</span>.
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
              {errorMsg}
            </div>
          )}
          {infoMsg && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
              {infoMsg}
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={async () => {
                setLoading(true);
                await refreshAuthUser();
                setLoading(false);
              }}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              I Verified My Email
            </button>
            <button
              onClick={handleResendVerification}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              Resend Verification Email
            </button>
            <button
              onClick={() => signOut(auth)}
              className="w-full text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 py-2"
            >
              Sign out and use another account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50 dark:bg-slate-950">
      {/* Left Architectural Panel */}
      <div className="hidden lg:flex relative bg-slate-950 text-white overflow-hidden flex-col justify-between p-12">
        {!imageError ? (
          <img
            src="/src/assets/images/fintrack_auth_editorial_1795443363201.jpg"
            alt="FinTrack architectural wealth ledger aesthetic"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-55"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/55 to-slate-950/35" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white">
            <Wallet className="w-5 h-5" />
          </div>
          <span className="text-xl font-bold tracking-tight">FinTrack</span>
        </div>

        <div className="relative z-10 max-w-lg space-y-6">
          <h1 className="text-4xl font-bold tracking-tight leading-tight text-balance">
            Every rupee, budget, and financial goal in one private ledger.
          </h1>
          <p className="text-slate-300 text-base leading-relaxed">
            Record income and expenses with receipt backups, track real-time Profit &amp; Loss, manage loans, EMIs, and recurring bills, and inspect clear monthly analytics.
          </p>
          <div className="grid grid-cols-3 gap-6 pt-4 border-t border-white/15">
            <div>
              <div className="text-lg font-bold font-mono tabular-nums text-emerald-400">100%</div>
              <div className="text-xs text-slate-400 mt-0.5">Private User Isolation</div>
            </div>
            <div>
              <div className="text-lg font-bold font-mono tabular-nums text-white">INR · USD</div>
              <div className="text-xs text-slate-400 mt-0.5">Multi-Currency Ready</div>
            </div>
            <div>
              <div className="text-lg font-bold font-mono tabular-nums text-blue-400">CSV · PDF</div>
              <div className="text-xs text-slate-400 mt-0.5">Instant Statement Export</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Authentication Form */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-7">
          <div className="lg:hidden flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-slate-900 dark:bg-emerald-600 flex items-center justify-center text-white">
              <Wallet className="w-5 h-5" />
            </div>
            <span className="text-lg font-bold text-slate-900 dark:text-white">
              FinTrack – Smart Money Manager
            </span>
          </div>

          {onBackToMaintenance && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between gap-3">
              <span className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                Scheduled Maintenance is active. Sign in with the admin account to manage it.
              </span>
              <button
                type="button"
                onClick={onBackToMaintenance}
                className="px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 whitespace-nowrap shrink-0"
              >
                Back
              </button>
            </div>
          )}

          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {mode === 'login'
                ? 'Sign in to FinTrack'
                : mode === 'register'
                ? 'Create your private account'
                : 'Reset your password'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {mode === 'login'
                ? 'Access your personal accounting dashboard and live reports.'
                : mode === 'register'
                ? 'Your financial records are encrypted in transit and isolated to your account.'
                : 'Enter your email address to receive a password reset link.'}
            </p>
          </div>

          {/* Google Sign-In Primary Button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            Continue with Google
          </button>

          {/* Guest Mode Entry */}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={enterGuestMode}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors disabled:opacity-50"
            >
              <UserIcon className="w-4 h-4 shrink-0" />
              Continue as Guest
            </button>
            <p className="text-[11px] text-center text-slate-500 dark:text-slate-400">
              Try FinTrack immediately. Guest data is saved locally in your browser.
            </p>
          </div>

          <div className="relative flex items-center">
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
            <span className="px-3 text-xs text-slate-500 dark:text-slate-400">or with email</span>
            <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
          </div>

          {/* Auth Mode Switcher */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg('');
                setInfoMsg('');
              }}
              className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMsg('');
                setInfoMsg('');
              }}
              className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'register'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('forgot');
                setErrorMsg('');
                setInfoMsg('');
              }}
              className={`py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                mode === 'forgot'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Reset Password
            </button>
          </div>

          {errorMsg && (
            <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300 space-y-2">
              <p>{errorMsg}</p>
              {needsEmailProviderSetup && (
                <p className="text-slate-600 dark:text-slate-400">
                  Admin setup: Open Firebase Console → Project <span className="font-mono">{FIREBASE_PROJECT_ID}</span> → Authentication → Sign-in method → Enable Email/Password.
                </p>
              )}
            </div>
          )}

          {infoMsg && (
            <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
              {infoMsg}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Account Type
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'personal', label: 'Personal' },
                        { id: 'business', label: 'Business' },
                        { id: 'other', label: 'Freelance / Other' },
                      ] as { id: SignupAccountType; label: string }[]
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setAccountType(opt.id)}
                        className={`py-1.5 px-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                          accountType === opt.id
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-800 dark:text-emerald-300'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    {accountType === 'business'
                      ? 'Your Name (Optional if Business Name entered)'
                      : 'Your Name'}
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      maxLength={60}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Aarav Sharma"
                      className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    {accountType === 'business'
                      ? 'Business / Shop / Organization Name'
                      : 'Business Name / Team / Custom Label (Optional)'}
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      maxLength={60}
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="e.g. Sharma Traders, Apex Studio, Family Ledger"
                      className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600"
                />
              </div>
            </div>

            {mode !== 'forgot' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full pl-9 pr-10 py-2.5 text-sm rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600/30 focus:border-emerald-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 dark:bg-emerald-600 text-white text-sm font-semibold hover:opacity-95 transition-opacity disabled:opacity-50"
            >
              {loading
                ? 'Processing...'
                : mode === 'login'
                ? 'Sign In'
                : mode === 'register'
                ? 'Create Account'
                : 'Send Reset Link'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Pre-Login PIN & Biometric Security Setup */}
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <Fingerprint className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                  {isAppSecurityConfigured(securityConfig)
                    ? 'Pre-Login Lock Active'
                    : 'PIN & Biometric Lock'}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {securityConfig.pinEnabled && securityConfig.biometricEnabled
                    ? `${securityConfig.pinLength}-digit PIN & Biometrics enabled`
                    : securityConfig.pinEnabled
                    ? `${securityConfig.pinLength}-digit PIN enabled`
                    : securityConfig.biometricEnabled
                    ? 'Biometric lock enabled'
                    : 'Require PIN or Fingerprint before login'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSecurityModalOpen(true)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {isAppSecurityConfigured(securityConfig) ? 'Manage' : 'Set Up'}
            </button>
          </div>

          <p className="text-xs text-center text-slate-500 dark:text-slate-400">
            Protected by Firebase Authentication &amp; user-isolated Cloud Firestore rules.
          </p>
        </div>
      </div>

      <PinSetupModal
        open={securityModalOpen}
        ownerLabel={fullName.trim() || businessName.trim() || email.trim() || 'FinTrack Owner'}
        onClose={() => setSecurityModalOpen(false)}
        onUpdated={(next) => setSecurityConfig(next)}
      />
    </div>
  );
}
