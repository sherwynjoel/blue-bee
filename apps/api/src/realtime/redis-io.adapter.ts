import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter backed by Redis pub/sub (PRD §10.2/§10.4 — "Socket.IO self-hosted now;
 * managed swap-in later"). Wiring the Redis adapter makes the realtime layer horizontally
 * scalable: an `emit`/`disconnectSockets` issued on any instance fans out to subscribers on
 * every instance via Redis, reusing the same Redis as the rest of the stack. Two dedicated
 * connections (pub + sub) are required by the adapter and are passed in pre-built so the
 * caller owns their lifecycle (close on shutdown / in tests).
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext, pub: Redis, sub: Redis) {
    super(app);
    this.adapterConstructor = createAdapter(pub, sub);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    server.adapter(this.adapterConstructor);
    return server;
  }
}
