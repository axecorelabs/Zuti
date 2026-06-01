import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  private parseAllowedEmails(rawValue: string): string[] {
    const normalized = rawValue.trim();
    if (!normalized) return [];

    // Accept JSON arrays, comma-separated values, or whitespace/newline-separated values.
    if (normalized.startsWith('[') && normalized.endsWith(']')) {
      try {
        const parsed = JSON.parse(normalized);
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => String(item).trim().replace(/^['"]+|['"]+$/g, '').toLowerCase())
            .filter(Boolean);
        }
      } catch {
        // Fall through to delimiter-based parsing.
      }
    }

    return normalized
      .split(/[\s,;]+/)
      .map((item) => item.trim().replace(/^['"]+|['"]+$/g, '').toLowerCase())
      .filter(Boolean);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const email = String(request.user?.email ?? '').trim().toLowerCase();

    const allowedEmails = this.parseAllowedEmails(
      this.configService.get<string>('ZUTI_SUPER_ADMIN_EMAILS') ?? '',
    );

    if (!email || !allowedEmails.includes(email)) {
      throw new ForbiddenException('Super admin access required');
    }

    request.isSuperAdmin = true;
    return true;
  }
}