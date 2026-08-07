import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TixtronOpsGuard } from '../../common/guards/tixtron-ops.guard';
import { TixtronOpsService } from './tixtron-ops.service';
import { SetEventFeaturedDto } from './dto/tixtron-ops.dto';

@ApiTags('tixtron-ops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TixtronOpsGuard)
@Controller('admin/tixtron')
export class TixtronOpsController {
  constructor(private readonly service: TixtronOpsService) {}

  @Get('context')
  @ApiOperation({ summary: 'The internal Tixtron HQ org id — every other Tixtron Ops panel operates against this org' })
  getContext() {
    return this.service.getContext();
  }

  @Get('organizers')
  @ApiOperation({ summary: 'Every organizer using the ticketing product, with activity signal' })
  listOrganizers() {
    return this.service.listOrganizers();
  }

  @Get('events')
  @ApiOperation({ summary: 'Events across every organizer, for featured-events curation' })
  listEvents(@Query('q') q?: string) {
    return this.service.listEventsForCuration(q);
  }

  @Patch('events/:productId/featured')
  @ApiOperation({ summary: 'Feature/unfeature an event on the public discovery page + platform digest' })
  setEventFeatured(@Param('productId') productId: string, @Body() dto: SetEventFeaturedDto) {
    return this.service.setEventFeatured(productId, dto.isFeatured, dto.featuredOrder);
  }

  @Get('subscribers')
  @ApiOperation({ summary: "Tixtron's own email list, collected via the ticket-page opt-in" })
  listEmailSubscribers() {
    return this.service.listEmailSubscribers();
  }
}
