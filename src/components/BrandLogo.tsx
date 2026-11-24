import React from 'react';

export const APP_LOGO_SRC = '/fintrack-icon-512.png';

interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  xs: 'w-8 h-8 rounded-lg p-0.5',
  sm: 'w-9 h-9 rounded-lg p-1',
  md: 'w-11 h-11 rounded-xl p-1',
  lg: 'w-14 h-14 rounded-2xl p-1.5',
  xl: 'w-28 h-28 sm:w-32 sm:h-32 rounded-3xl p-2.5',
};

export function BrandLogo({ size = 'sm', className = '' }: BrandLogoProps) {
  return (
    <div
      className={`bg-white border border-slate-200/80 dark:border-slate-700/60 flex items-center justify-center overflow-hidden shrink-0 shadow-xs ${SIZE_CLASSES[size]} ${className}`}
    >
      <img
        src={APP_LOGO_SRC}
        alt="FinTrack Logo"
        className="w-full h-full object-contain select-none"
      />
    </div>
  );
}
