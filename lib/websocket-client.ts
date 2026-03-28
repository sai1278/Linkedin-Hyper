// FILE: lib/websocket-client.ts
'use client';

import { io, Socket } from 'socket.io-client';

type EventCallback = (data: any) => void;

export class WebSocketClient {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private url: string = '';
  private reconnectAttempts: number = 0;
  private maxReconnectDelay: number = 30000; // 30 seconds
  private _isConnected: boolean = false;

  get isConnected(): boolean {
    return this._isConnected;
  }

  private normalizeSocketOrigin(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      // Socket.IO expects HTTP(S) origin; WS(S) can cause client-side edge-case failures.
      if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
      if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
      return parsed.origin;
    } catch {
      return rawUrl;
    }
  }

  connect(url: string): void {
    if (!url || typeof window === 'undefined') return;
    
    const origin = this.normalizeSocketOrigin(url);
    this.url = origin;

    try {
      this.socket = io(origin, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: this.maxReconnectDelay,
        reconnectionAttempts: Infinity,
      });

      this.socket.on('connect', () => {
        console.log('[WebSocket] Connected');
        this._isConnected = true;
        this.reconnectAttempts = 0;
        this.notifyStatusListeners('connected');
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[WebSocket] Disconnected:', reason);
        this._isConnected = false;
        this.notifyStatusListeners('disconnected');
      });

      this.socket.on('connect_error', (error) => {
        // In dev mode this can happen during worker restarts or transport fallback.
        // Use warn instead of error to avoid noisy Next.js error overlays.
        console.warn('[WebSocket] Connection warning:', error.message);
        this.reconnectAttempts++;
        this.notifyStatusListeners('reconnecting');
      });

      this.socket.on('reconnect', (attemptNumber) => {
        console.log(`[WebSocket] Reconnected after ${attemptNumber} attempts`);
        this._isConnected = true;
        this.reconnectAttempts = 0;
        this.notifyStatusListeners('connected');
      });

      this.socket.on('reconnect_attempt', (attemptNumber) => {
        console.log(`[WebSocket] Reconnection attempt ${attemptNumber}`);
        this.notifyStatusListeners('reconnecting');
      });

      // Listen for all custom events
      this.socket.onAny((event, data) => {
        if (this.listeners.has(event)) {
          this.listeners.get(event)?.forEach((callback) => {
            callback(data);
          });
        }
      });

    } catch (err) {
      console.error('[WebSocket] Connection failed:', err);
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this._isConnected = false;
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
    if (this.socket && this.socket.connected) {
      this.socket.emit(event, data);
    }
  }

  joinAccountRoom(accountId: string): void {
    this.emit('join:account', accountId);
  }

  leaveAccountRoom(accountId: string): void {
    this.emit('leave:account', accountId);
  }

  private notifyStatusListeners(status: 'connected' | 'disconnected' | 'reconnecting'): void {
    if (this.listeners.has('status:changed')) {
      this.listeners.get('status:changed')?.forEach((callback) => {
        callback({ status });
      });
    }
  }
}

export const wsClient = new WebSocketClient();
