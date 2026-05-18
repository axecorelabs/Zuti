import { Controller, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BotsService } from './bots.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('widget')
@Controller('bots/widget')
export class WidgetController {
  constructor(private readonly botsService: BotsService) {}

  @Post('/message/:widgetKey')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a message to a widget-enabled bot (public endpoint)' })
  async handleWidgetMessage(
    @Param('widgetKey') widgetKey: string,
    @Body() body: { message: string; visitorId?: string; visitorEmail?: string },
  ) {
    return this.botsService.handleWidgetMessage(widgetKey, body);
  }
}
