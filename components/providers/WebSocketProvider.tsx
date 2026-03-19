// FILE: components/providers/WebSocketProvider.tsx
'use client';

import { useEffect } from 'react';
import { wsClient } from '@/lib/websocket-client';
import toast from 'react-hot-toast';

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_WS_URL;
    
    // Only connect if WS URL is configured
    if (!url) {
      console.log('[WebSocket] No WS URL configured, using polling fallback');
      return;
    }

    // Connect to WebSocket
    wsClient.connect(url);

    // Set up global event handlers
    const unsubscribeAccountStatus = wsClient.on('account:status', (data) => {
      console.log('[WebSocket] Account status changed:', data);
      // Trigger global refresh if needed
    });

    const unsubscribeNewMessage = wsClient.on('inbox:new_message', (data) => {
      console.log('[WebSocket] New message received:', data);
      toast.success(`New message from ${data.senderName || 'LinkedIn'}`);
    });

    const unsubscribeInboxUpdate = wsClient.on('inbox:updated', (data) => {
      console.log('[WebSocket] Inbox updated:', data);
    });

    const unsubscribeRateLimit = wsClient.on('rate_limit:updated', (data) => {
      console.log('[WebSocket] Rate limit updated:', data);
    });

    // Cleanup on unmount
    return () => {
      unsubscribeAccountStatus();
      unsubscribeNewMessage();
      unsubscribeInboxUpdate();
      unsubscribeRateLimit();
      wsClient.disconnect();
    };
  }, []);

  return <>{children}</>;
}
