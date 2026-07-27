import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { buildTenantScopedMap, checkTenantSafety } from './tenant-guard';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private keepAlive?: NodeJS.Timeout;

  async onModuleInit() {
    this.installTenantGuard();
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
