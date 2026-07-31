import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { buildTenantScopedMap, checkTenantSafety } from './tenant-guard';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private keepAlive?: NodeJS.Timeout;
  private consecutiveKeepAliveFailures = 0;
  private recovering = false;

  async onModuleInit() {
    this.installTenantGuard();
    await this.$connect();
    // Force one real round-trip so the FIRST user request doesn't eat the cold-connect cost
    // (~5s against the remote Supabase pooler).
    try { await this.$queryRawUnsafe('SELECT 1'); } catch { /* best effort */ }
    // Heartbeat: keep the pooled connection warm. Supabase's transaction pooler tears down idle
    // server connections, which would re-introduce the multi-second cold connect on the next query.
    // A machine sleep/wake or network blip can also leave Prisma's own internal pool holding sockets
    // that look alive but never respond — each such socket occupies one of the (small, fixed)
    // connection_limit slots forever, and once enough of them go stale every request in the app
    // times out waiting for a pool slot, with no way to recover short of a process restart. Treat
    // repeated heartbeat failures as exactly that: force a full disconnect/reconnect so Prisma opens
    // fresh sockets instead of the app quietly wedging itself until someone notices.
    this.keepAlive = setInterval(() => {
      void this.runKeepAlive();
    }, 4 * 60_000);
    this.keepAlive.unref?.(); // don't hold the process open on shutdown
  }

  private async runKeepAlive() {
    try {
      await this.$queryRawUnsafe('SELECT 1');
      this.consecutiveKeepAliveFailures = 0;
    } catch (e) {
      this.consecutiveKeepAliveFailures++;
      this.logger.warn(`DB keep-alive failed (${this.consecutiveKeepAliveFailures} in a row): ${String(e)}`);
      // One failure can be a transient blip; two in a row (8+ minutes of a dead pool) is the stale-
      // socket pattern — reconnect rather than let it accumulate toward full pool exhaustion.
      if (this.consecutiveKeepAliveFailures >= 2 && !this.recovering) {
        await this.forceReconnect();
      }
    }
  }

  private async forceReconnect() {
    this.recovering = true;
    this.logger.warn('DB connection pool looks stale — forcing a full disconnect/reconnect');
    try {
      await this.$disconnect();
      await this.$connect();
      await this.$queryRawUnsafe('SELECT 1');
      this.consecutiveKeepAliveFailures = 0;
      this.logger.log('DB connection pool recovered');
    } catch (e) {
      this.logger.error(`DB reconnect attempt failed, will retry on next heartbeat: ${String(e)}`);
    } finally {
      this.recovering = false;
    }
  }

  async onModuleDestroy() {
    if (this.keepAlive) clearInterval(this.keepAlive);
    await this.$disconnect();
  }

  /**
   * Detection guard for cross-tenant bulk queries (defense-in-depth; see tenant-guard.ts). Off in
   * production by default (no overhead/noise); logs warnings in dev/test. TENANT_GUARD=strict makes
   * it throw (for CI / isolation testing); TENANT_GUARD=off disables it anywhere.
   */
  private installTenantGuard() {
    const mode = process.env.TENANT_GUARD ?? (process.env.NODE_ENV === 'production' ? 'off' : 'warn');
    if (mode === 'off') return;
    const tenantMap = buildTenantScopedMap();
    this.$use(async (params, next) => {
      const check = checkTenantSafety(params.model, params.action, params.args, tenantMap);
      if (!check.safe) {
        const msg = `[tenant-guard] ${check.model}.${check.action} has no '${check.field}' filter — possible cross-tenant query`;
        if (mode === 'strict') throw new Error(msg);
        this.logger.warn(msg);
      }
      return next(params);
    });
    this.logger.log(`Tenant guard active (${mode}) on ${tenantMap.size} tenant-scoped models`);
  }
}
