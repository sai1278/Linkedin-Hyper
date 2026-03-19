// FILE: components/ui/dialog.tsx
'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </DialogPrimitive.Root>
  );
}

export function DialogTrigger({ children }: { children: React.ReactNode }) {
  return <DialogPrimitive.Trigger asChild>{children}</DialogPrimitive.Trigger>;
}

export function DialogContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay asChild>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50"
          style={{ background: 'rgba(0, 0, 0, 0.8)', backdropFilter: 'blur(4px)' }}
        />
      </DialogPrimitive.Overlay>
      <DialogPrimitive.Content asChild>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', duration: 0.3 }}
          className={`fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-xl border p-6 shadow-lg ${className}`}
          style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        >
          {children}
          <DialogPrimitive.Close asChild>
            <button
              className="absolute right-4 top-4 rounded-lg p-1.5 transition-all hover:bg-opacity-10"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={20} />
            </button>
          </DialogPrimitive.Close>
        </motion.div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ children }: { children: React.ReactNode }) {
  return (
    <DialogPrimitive.Title className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
      {children}
    </DialogPrimitive.Title>
  );
}

export function DialogDescription({ children }: { children: React.ReactNode }) {
  return (
    <DialogPrimitive.Description className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
      {children}
    </DialogPrimitive.Description>
  );
}
