import { Controller, Get, Post, Param, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RegistrationsService } from './registrations.service';
import { PublicRegisterDto, PublicCartDto, JoinWaitlistDto } from './dto/registrations.dto';

/**
 * Public, unauthenticated event pages. Powers the shareable /e/<slug> landing page: view a published
 * event (branding, details, ticket tiers + live availability) and register/purchase a ticket. The
 * purchase reuses the exact entry + Paystack + ticket/receipt pipeline the bot uses; payment return
 * and ticket viewing continue to run through the existing `public/tickets/*` routes.
 */
@ApiExcludeController()
@Public()
@Controller('public/events')
export class EventPublicController {
  constructor(private readonly svc: RegistrationsService) {}

  // Cross-org search/browse — powers the Tixtron landing page. Listed BEFORE ':slug' so it
  // doesn't get swallowed by the slug route.
  @Get()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  listEvents(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('city') city?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.listPublicEvents({
      search,
      category,
      city,
      dateFrom,
      dateTo,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get(':slug')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  getEvent(@Param('slug') slug: string) {
    return this.svc.getPublicEventBySlug(slug);
  }

  @Post(':slug/register')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  register(@Param('slug') slug: string, @Body() dto: PublicRegisterDto) {
    return this.svc.registerPublic(slug, dto);
  }

  // Cart: multiple tickets (tiers/attendees) in one purchase, paid once.
  @Post(':slug/register-cart')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  registerCart(@Param('slug') slug: string, @Body() dto: PublicCartDto) {
    return this.svc.registerPublicCart(slug, dto);
  }

  // Join the waitlist when an event/tier is sold out.
  @Post(':slug/waitlist')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  joinWaitlist(@Param('slug') slug: string, @Body() dto: JoinWaitlistDto) {
    return this.svc.joinPublicWaitlist(slug, dto);
  }
}
