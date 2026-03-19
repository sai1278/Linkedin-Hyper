// FILE: components/ui/tabs.tsx
'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';

export function Tabs({ children, defaultValue, value, onValueChange }: {
  children: React.ReactNode;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <TabsPrimitive.Root defaultValue={defaultValue} value={value} onValueChange={onValueChange}>
      {children}
    </TabsPrimitive.Root>
  );
}

export function TabsList({ children }: { children: React.ReactNode }) {
  return (
    <TabsPrimitive.List
      className="flex gap-1 p-1 rounded-lg"
      style={{ background: 'var(--bg-elevated)' }}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className="flex-1 px-3 py-2 rounded-md text-sm font-medium transition-all data-[state=active]:shadow-sm"
      style={{
        color: 'var(--text-muted)',
      }}
      data-active-style={{
        background: 'var(--accent)',
        color: 'white',
      }}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <TabsPrimitive.Content value={value} className="mt-4">
      {children}
    </TabsPrimitive.Content>
  );
}
