// FILE: components/providers/WebSocketProvider.tsx
'use client';

import { useEffect, useRef } from 'react';
import { wsClient } from '@/lib/websocket-client';
import { useAuth } from '@/components/providers/AuthProvider';
import toast from 'react-hot-toast';

type StatusChangedPayload = {
  status?: 'connected' | 'disconnected' | 'reconnecting';
};

type InboxNewMessagePayload = {
  senderName?: string;
  message?: {
    senderName?: string;
    text?: string;
  };
};

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const notificationPermissionRequested = useRef(false);

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      return;
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      return;
    }

    if (notificationPermissionRequested.current) {
      return;
    }

    notificationPermissionRequested.current = true;

    if (window.Notification.permission === 'default') {
      void window.Notification.requestPermission().catch(() => undefined);
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    // Avoid opening sockets for unauthenticated pages (login/register).
    if (isLoading || !isAuthenticated) {
      wsClient.disconnect();
      return;
    }

    const url =
      process.env.NEXT_PUBLIC_WS_URL ||
      (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001');
    console.debug(`[WebSocketProvider] connect requested url=${url}`);
    wsClient.connect(url);

    const unsubscribeStatus = wsClient.on('status:changed', (data: StatusChangedPayload) => {
      console.debug(`[WebSocketProvider] status changed -> ${String(data.status || 'unknown')}`);
      if (data.status === 'connected') {
        toast.success('Connected to real-time updates', { duration: 2000 });
      } else if (data.status === 'disconnected') {
        toast.error('Disconnected from real-time updates', { duration: 2000 });
      }
    });

    const unsubscribeNewMessage = wsClient.on('inbox:new_message', (data: InboxNewMessagePayload) => {
      console.debug('[WebSocketProvider] inbox:new_message received', data);
      const senderName = data.message?.senderName || data.senderName || 'Someone';
      if (senderName === '__self__' || senderName.includes('account')) {
        return;
      }

      toast.success(`New message from ${senderName}`, {
        icon: 'MSG',
        duration: 4000,
      });

      if (typeof window === 'undefined' || !('Notification' in window)) {
        return;
      }

      if (window.Notification.permission !== 'granted') {
        return;
      }

      const notification = new window.Notification(`LinkedIn message from ${senderName}`, {
        body: data.message?.text || 'Open Inbox to view the latest message.',
        tag: `linkedin-hyper-message-${senderName}`,
      });

      notification.onclick = () => {
        window.focus();
        window.location.href = '/inbox';
      };
    });

    return () => {
      unsubscribeStatus();
      unsubscribeNewMessage();
      wsClient.disconnect();
    };
  }, [isAuthenticated, isLoading]);

  return <>{children}</>;
}
