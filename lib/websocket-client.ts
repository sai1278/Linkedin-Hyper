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
  private target = '';
  private url = '';
  private path = '/socket.io';
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000;
  private _isConnected = false;
  private joinedRooms: Set<string> = new Set();

  get isConnected(): boolean {
    return this._isConnected;
  }

  private parseSocketTarget(rawUrl: string): { origin: string; path: string } {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'ws:') parsed.protocol = 'http:';
      if (parsed.protocol === 'wss:') parsed.protocol = 'https:';
      const requestedPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '/socket.io';
      const pathname = requestedPath === '/ws' || requestedPath === '/ws/'
        ? '/socket.io'
        : requestedPath;
      if (requestedPath !== pathname) {
        console.info(`[WebSocket] Remapped socket path ${requestedPath} -> ${pathname}`);
      }
      return {
        origin: parsed.origin,
        path: pathname,
      };
    } catch {
      return {
        origin: rawUrl,
        path: '/socket.io',
      };
    }
  }

  private rejoinRooms(): void {
    if (!this.socket || !this.socket.connected) {
      return;
    }

    this.joinedRooms.forEach((room) => {
      this.socket?.emit('join:account', room);
      console.debug(`[WebSocket] Rejoined room ${room}`);
    });
  }

  connect(url: string): void {
    if (!url || typeof window === 'undefined') return;

    const { origin, path } = this.parseSocketTarget(url);

    if (this.socket) {
      if (this.url === origin && this.path === path) {
        if (!this.socket.connected) {
          this.socket.connect();
        }
        return;
      }

      this.socket.disconnect();
      this.socket = null;
    }

    this.target = url;
    this.url = origin;
    this.path = path;

    try {
      console.debug(`[WebSocket] Connecting origin=${origin} path=${path}`);
      this.socket = io(origin, {
        path,
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: this.maxReconnectDelay,
        reconnectionAttempts: Infinity,
      });

      this.socket.on('connect', () => {
        console.debug('[WebSocket] Connected');
        this._isConnected = true;
        this.reconnectAttempts = 0;
        this.rejoinRooms();
        this.notifyStatusListeners('connected');
      });

      this.socket.on('disconnect', (reason) => {
        console.warn('[WebSocket] Disconnected:', reason);
        this._isConnected = false;
        this.notifyStatusListeners('disconnected');
      });

      this.socket.on('connect_error', (error) => {
        console.warn('[WebSocket] Connection warning:', error.message, `origin=${origin}`, `path=${path}`);
        this.reconnectAttempts++;
        this.notifyStatusListeners('reconnecting');
      });

      this.socket.on('reconnect', (attemptNumber) => {
        console.info(`[WebSocket] Reconnected after ${attemptNumber} attempts`);
        this._isConnected = true;
        this.reconnectAttempts = 0;
        this.rejoinRooms();
        this.notifyStatusListeners('connected');
      });

      this.socket.on('reconnect_attempt', (attemptNumber) => {
        console.info(`[WebSocket] Reconnection attempt ${attemptNumber}`);
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

    if (this.target) {
      this.connect(this.target);
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
    if (!accountId) return;
    this.joinedRooms.add(accountId);
    this.emit('join:account', accountId);
  }

  leaveAccountRoom(accountId: string): void {
    if (!accountId) return;
    this.joinedRooms.delete(accountId);
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
