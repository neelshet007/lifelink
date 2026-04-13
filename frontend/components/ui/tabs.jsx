import * as React from 'react';
import { cn } from '../../lib/utils';

const TabsContext = React.createContext(null);

export function Tabs({ value, onValueChange, className, children }) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn('w-full', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }) {
  return (
    <div className={cn('inline-flex items-center justify-center rounded-[1rem] p-1', className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({ value, className, children }) {
  const context = React.useContext(TabsContext);
  const isActive = context.value === value;

  return (
    <button
      type="button"
      onClick={() => context.onValueChange(value)}
      data-state={isActive ? 'active' : 'inactive'}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap px-3 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        isActive ? 'bg-nha-blue text-white shadow-sm' : 'text-slate-400 hover:text-white',
        className
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className, children }) {
  const context = React.useContext(TabsContext);
  if (context.value !== value) return null;

  return (
    <div className={cn('mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', className)}>
      {children}
    </div>
  );
}
