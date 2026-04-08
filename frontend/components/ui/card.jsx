import { cn } from '../../lib/utils';

export function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        'rounded-[1.75rem] border border-white/10 bg-[linear-gradient(160deg,rgba(13,20,33,0.96),rgba(18,31,53,0.9))] shadow-[0_24px_80px_rgba(3,8,20,0.35)] backdrop-blur-xl',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('flex flex-col gap-2 p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }) {
  return <h3 className={cn('text-lg font-semibold text-white', className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return <p className={cn('text-sm text-slate-300/78', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div className={cn('px-6 pb-6', className)} {...props} />;
}
