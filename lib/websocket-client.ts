'use client';

import { io, Socket } from 'socket.io-client';

type SocketEventPayload = unknown;
type ListenerCallback = (data: SocketEventPayload) => void;
const SOCKET_DEBUG = process.env.NODE_ENV === 'development';

function debugSocket(...args: unknown[]): void {
  if (SOCKET_DEBUG) {
    console.debug(...args);
  }
}

export class WebSocketClient {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<ListenerCallback>> = new Map();
  private url = '';
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;
  private _isConnected = false;

  get isConnected(): boolean {
    return this._isConnected;
  }

  private normalizeSocketOrigin(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
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

    if (this.socket) {
      if (this.url === origin) {
        if (!this.socket.connected) {
          this.socket.connect();
        }
        return;
      }

      this.socket.disconnect();
      this.socket = null;
    }

    this.url = origin;

    try {
      this.socket = io(origin, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: this.maxReconnectDelay,
        reconnectionAttempts: Infinity,
      });

      this.socket.on('connect', () => {
        debugSocket('[WebSocket] Connected');
        this._isConnected = true;
        this.reconnectAttempts = 0;
        this.notifyStatusListeners('connected');
      });

      this.socket.on('disconnect', (reason) => {
        debugSocket('[WebSocket] Disconnected:', reason);
        this._isConnected = false;
        this.notifyStatusListeners('disconnected');
      });

      this.socket.on('connect_error', (error) => {
        console.warn('[WebSocket] Connection warning:', error.message);
        this.reconnectAttempts++;
        this.notifyStatusListeners('reconnecting');
      });

      this.socket.on('reconnect', (attemptNumber) => {
        debugSocket(`[WebSocket] Reconnected after ${attemptNumber} attempts`);
        this._isConnected = true;
        this.reconnectAttempts = 0;
        this.notifyStatusListeners('connected');
      });

      this.socket.on('reconnect_attempt', (attemptNumber) => {
        debugSocket(`[WebSocket] Reconnection attempt ${attemptNumber}`);
        this.notifyStatusListeners('reconnecting');
      });

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

  reconnect(): void {
    if (this.socket) {
      this.notifyStatusListeners('reconnecting');
      this.socket.connect();
      return;
    }

    if (this.url) {
      this.connect(this.url);
    }
  }

  on<T = unknown>(event: string, callback: (data: T) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const wrapped = callback as ListenerCallback;
    this.listeners.get(event)?.add(wrapped);

    return () => {
      const callbacks = this.listeners.get(event);
      if (callbacks) {
        callbacks.delete(wrapped);
        if (callbacks.size === 0) {
          this.listeners.delete(event);
        }
      }
    };
  }

  emit(event: string, data: SocketEventPayload): void {
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
