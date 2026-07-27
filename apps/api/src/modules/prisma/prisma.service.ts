import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private keepAlive?: NodeJS.Timeout;

  async onModuleInit() {
    await this.$connect();
    // Force one real round-trip so the FIRST user request doesn't eat the cold-connect cost
    // (~5s against the remote Supabase pooler).
    try { await this.$queryRawUnsafe('SELECT 1'); } catch { /* best effort */ }
    // Heartbeat: keep the pooled connection warm. Supabase's transaction pooler tears down idle
    // server connections, which would re-introduce the multi-second cold connect on the next query.
    this.keepAlive = setInterval(() => {
      this.$queryRawUnsafe('SELECT 1').catch((e) => this.logger.debug(`DB keep-alive failed: ${String(e)}`));
    }, 4 * 60_000);
    this.keepAlive.unref?.(); // don't hold the process open on shutdown
  }

  async onModuleDestroy() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    await this.$disconnect();
  }
}
