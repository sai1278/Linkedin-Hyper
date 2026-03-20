// FILE: components/providers/WebSocketProvider.tsx
'use client';

import { useEffect, useState } from 'react';
import { wsClient } from '@/lib/websocket-client';
import toast from 'react-hot-toast';

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('disconnected');

  useEffect(() => {
    // Use worker API URL (default: localhost:3001)
    const url = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';
    
    console.log('[WebSocket] Connecting to:', url);

    // Connect to WebSocket
    wsClient.connect(url);

    // Set up connection status listener
    const unsubscribeStatus = wsClient.on('status:changed', (data) => {
      setConnectionStatus(data.status);
      
      if (data.status === 'connected') {
        toast.success('Connected to real-time updates', { duration: 2000 });
      } else if (data.status === 'disconnected') {
        toast.error('Disconnected from real-time updates', { duration: 2000 });
      }
    });

    // Set up global event handlers
    const unsubscribeAccountStatus = wsClient.on('account:status', (data) => {
      console.log('[WebSocket] Account status changed:', data);
      // Trigger global refresh if needed
    });

    const unsubscribeNewMessage = wsClient.on('inbox:new_message', (data) => {
      console.log('[WebSocket] New message received:', data);
      
      const senderName = data.message?.senderName || data.senderName || 'Someone';
      if (senderName !== '__self__' && !senderName.includes('account')) {
        toast.success(`New message from ${senderName}`, {
          icon: '💬',
          duration: 4000,
        });
      }
    });

    const unsubscribeInboxUpdate = wsClient.on('inbox:updated', (data) => {
      console.log('[WebSocket] Inbox updated:', data);
      // Pages will handle their own inbox updates
    });

    const unsubscribeRateLimit = wsClient.on('rate_limit:updated', (data) => {
      console.log('[WebSocket] Rate limit updated:', data);
    });

    const unsubscribeConnected = wsClient.on('connected', (data) => {
      console.log('[WebSocket] Connection confirmed:', data);
      setConnectionStatus('connected');
    });

    // Cleanup on unmount
    return () => {
      unsubscribeStatus();
      unsubscribeAccountStatus();
      unsubscribeNewMessage();
      unsubscribeInboxUpdate();
      unsubscribeRateLimit();
      unsubscribeConnected();
      wsClient.disconnect();
    };
  }, []);

  return <>{children}</>;
}
