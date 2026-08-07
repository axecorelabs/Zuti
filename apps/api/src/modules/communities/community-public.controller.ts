import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CommunitiesService } from './communities.service';
import { CommunityEmailSignupDto } from './dto/community-public.dto';

/** Public, unauthenticated entry points for the platform-wide Tixtron community — the landing-page
 * "join our community" / "get email updates" CTAs, for visitors who haven't necessarily bought a
 * ticket yet. Both actions are still explicit, affirmative opt-ins (a bot deep-link someone taps,
 * or a form someone submits) — never implied by just visiting the page. */
@ApiExcludeController()
@Public()
@Controller('public/community')
export class CommunityPublicController {
  constructor(private readonly communities: CommunitiesService) {}

  @Get('join-link')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  getJoinLink() {
    return this.communities.getPlatformJoinLink();
  }

  @Post('email-signup')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async emailSignup(@Body() dto: CommunityEmailSignupDto) {
    await this.communities.optInEmail(dto.email, dto.name ?? null);
    return { ok: true };
  }
}
