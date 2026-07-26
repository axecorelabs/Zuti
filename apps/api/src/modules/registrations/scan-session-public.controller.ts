import { Controller, Get, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RegistrationsService } from './registrations.service';
import { ScanCheckInDto } from './dto/registrations.dto';

/**
 * Public, token-authenticated check-in for a scan session. The token in the URL IS the credential —
 * no login. Deliberately narrow: it can only validate itself and admit tickets for its ONE event
 * (event-locked), returns minimal PII (name + tier + status, never email), and exposes no roster.
 * Expiry/revocation are enforced on every call by resolveScanSession. Rate-limited against abuse.
 */
@ApiExcludeController()
@Public()
@Controller('public/scan')
export class ScanSessionPublicController {
  constructor(private readonly svc: RegistrationsService) {}

  // Validate the link + return the minimal event context the scan page renders.
  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  resolve(@Param('token') token: string) {
    return this.svc.resolveScanSession(token);
  }

  // Admit a scanned/typed ticket code. Re-validates the session every time.
  @Post(':token/checkin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  checkIn(@Param('token') token: string, @Body() dto: ScanCheckInDto) {
    return this.svc.scanSessionCheckIn(token, dto.code);
  }
}
