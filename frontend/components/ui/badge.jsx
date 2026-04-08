import { cn } from '../../lib/utils';

const variants = {
  blue: 'bg-[#0b4ea2]/18 text-[#8bc0ff] border border-[#0b4ea2]/35',
  saffron: 'bg-[#ff8f1f]/18 text-[#ffc685] border border-[#ff8f1f]/35',
  success: 'bg-emerald-500/18 text-emerald-300 border border-emerald-500/35',
  subtle: 'bg-white/6 text-slate-300 border border-white/10',
};

export function Badge({ className, variant = 'subtle', ...props }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold tracking-[0.02em]',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
