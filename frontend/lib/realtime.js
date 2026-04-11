'use client';

import { io } from 'socket.io-client';
import { API_URL } from './session';

let socket;

export function getRealtimeSocket() {
  if (!socket) {
    socket = io(API_URL, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }

  return socket;
}

export function disconnectRealtimeSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
