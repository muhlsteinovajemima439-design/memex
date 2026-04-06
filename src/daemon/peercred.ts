import { createRequire } from 'node:module';
import type { Socket } from 'node:net';

const require = createRequire(import.meta.url);

interface PeerCred {
  uid: number;
  gid: number;
  pid: number;
}

// Load the native N-API addon compiled by node-gyp
const addon: { getPeerCred(fd: number): PeerCred } = require('../../build/Release/peercred.node');

/**
 * Extract the kernel-verified credentials (uid, gid, pid) of the peer
 * process connected to a Unix domain socket.
 *
 * Uses SO_PEERCRED — the kernel fills this in at connect() time,
 * so it cannot be spoofed by the client.
 */
export function getPeerCred(socket: Socket): PeerCred {
  const handle = (socket as any)._handle;
  if (!handle || typeof handle.fd !== 'number' || handle.fd < 0) {
    throw new Error('Cannot get file descriptor from socket');
  }
  return addon.getPeerCred(handle.fd);
}
