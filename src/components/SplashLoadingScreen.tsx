import React, { useEffect, useState } from 'react';
import { BrandLogo } from './BrandLogo';

interface SplashLoadingScreenProps {
  statusLabel?: string;
}

export function SplashLoadingScreen({
  statusLabel = 'Preparing your dashboard...',
}: SplashLoadingScreenProps) {
  const [progress, setProgress] = useState(18);

  useEffect(() => {
    const t1 = setTimeout(() => setProgress(52), 180);
    const t2 = setTimeout(() => setProgress(84), 650);
    const t3 = setTimeout(() => setProgress(96), 1150);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 px-6 py-10 text-slate-900 dark:text-slate-100">
      <div className="w-full max-w-sm flex flex-col items-center text-center space-y-6">
        <BrandLogo size="xl" className="shadow-md" />

        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            FinTrack
          </h1>
          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tracking-wide">
            Growth Yourself with FinTrack
          </p>
        </div>

        {/* Loading Progress Bar */}
        <div className="w-full max-w-[240px] space-y-2.5 pt-2">
          <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-600 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{statusLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
