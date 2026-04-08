'use client';

import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const variants = {
  primary: 'bg-[#0b4ea2] text-white hover:bg-[#0a438c] shadow-[0_16px_40px_rgba(11,78,162,0.28)]',
  secondary: 'bg-white/8 text-white hover:bg-white/14 border border-white/10',
  saffron: 'bg-[#ff8f1f] text-[#1e2430] hover:bg-[#f59f39] shadow-[0_16px_40px_rgba(255,143,31,0.26)]',
  success: 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-[0_16px_40px_rgba(16,185,129,0.25)]',
  ghost: 'bg-transparent text-slate-300 hover:bg-white/6 hover:text-white',
};

const sizes = {
  md: 'h-11 px-5 rounded-2xl text-sm font-semibold',
  lg: 'h-13 px-6 rounded-[1.25rem] text-sm font-semibold',
  icon: 'h-11 w-11 rounded-2xl',
};

export const Button = forwardRef(function Button(
  { className, variant = 'primary', size = 'md', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
});
