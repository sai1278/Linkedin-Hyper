// FILE: lib/websocket-client.ts
'use client';

type EventCallback = (data: any) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private url: string = '';
  private isIntentionallyClosed: boolean = false;

  connect(url: string): void {
    if (!url || typeof window === 'undefined') return;
    
    this.url = url;
    this.isIntentionallyClosed = false;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const eventType = data.type || data.event;
          
          if (eventType && this.listeners.has(eventType)) {
            this.listeners.get(eventType)?.forEach((callback) => {
              callback(data.payload || data);
            });
          }
        } catch (err) {
          console.error('[WebSocket] Failed to parse message:', err);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
      };

      this.ws.onclose = () => {
        console.log('[WebSocket] Disconnected');
        
        // Auto-reconnect unless intentionally closed
        if (!this.isIntentionallyClosed) {
          this.reconnectTimeout = setTimeout(() => {
            console.log('[WebSocket] Attempting to reconnect...');
            this.connect(this.url);
          }, 5000);
        }
      };
    } catch (err) {
      console.error('[WebSocket] Connection failed:', err);
    }
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    
    this.listeners.get(event)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(event);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.listeners.delete(event);
        }
      }
    };
  }

  emit(event: string, data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: event, payload: data }));
    }
  }
}

export const wsClient = new WebSocketClient();
