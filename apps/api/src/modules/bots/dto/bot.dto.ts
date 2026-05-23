import { IsString, IsNotEmpty, MaxLength, IsOptional, IsBoolean, IsObject, IsArray, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBotDto {
  @ApiProperty({ example: 'Support Bot' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare name: string;

  @ApiPropertyOptional({
    description: 'Primary channel for this bot',
    enum: ['TELEGRAM', 'WEB_WIDGET', 'EMAIL'],
    example: 'WEB_WIDGET',
  })
  @IsOptional()
  @IsString()
  @IsIn(['TELEGRAM', 'WEB_WIDGET', 'EMAIL'])
  primaryChannel?: 'TELEGRAM' | 'WEB_WIDGET' | 'EMAIL';

  @ApiPropertyOptional({ example: '123456:ABC-DEF...' })
  @IsOptional()
  @IsString()
  telegramToken?: string;

  @ApiPropertyOptional({
    description: 'Optional skills to enable on the bot',
    enum: ['SALES', 'BOOKING', 'SUPPORT', 'TECHNICAL', 'FORWARDING'],
    isArray: true,
    example: ['BOOKING', 'SUPPORT'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(['SALES', 'BOOKING', 'SUPPORT', 'TECHNICAL', 'FORWARDING'], { each: true })
  skills?: Array<'SALES' | 'BOOKING' | 'SUPPORT' | 'TECHNICAL' | 'FORWARDING'>;

  @ApiPropertyOptional({
    description: 'Template used to preconfigure the bot capabilities and action forwarding behavior',
    enum: ['GENERAL', 'SALES', 'SUPPORT', 'BOOKING', 'TECHNICAL'],
    example: 'GENERAL',
  })
  @IsOptional()
  @IsString()
  @IsIn(['GENERAL', 'SALES', 'SUPPORT', 'BOOKING', 'TECHNICAL'])
  template?: 'GENERAL' | 'SALES' | 'SUPPORT' | 'BOOKING' | 'TECHNICAL';

  @ApiPropertyOptional({
    description: 'Explicitly enable or disable action forwarding for this bot',
  })
  @IsOptional()
  @IsBoolean()
  actionForwardingEnabled?: boolean;
}

export class UpdateBotDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  aiConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Enable website widget channel for this bot' })
  @IsOptional()
  @IsBoolean()
  webWidgetEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Allowed website domains for embed usage (without protocol)',
    example: ['example.com', 'app.example.com'],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  webWidgetAllowedDomains?: string[];

  @ApiPropertyOptional({
    description: 'Roles the AI may auto-assign escalated conversations to',
    example: ['AGENT'],
    enum: ['AGENT', 'ADMIN', 'OWNER'],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsIn(['AGENT', 'ADMIN', 'OWNER'], { each: true })
  routeToRoles?: string[];

  @ApiPropertyOptional({
    description: 'Optional skills to enable on the bot',
    enum: ['SALES', 'BOOKING', 'SUPPORT', 'TECHNICAL', 'FORWARDING'],
    isArray: true,
    example: ['SALES', 'TECHNICAL'],
  })
  @IsOptional()
  @IsArray()
  @IsIn(['SALES', 'BOOKING', 'SUPPORT', 'TECHNICAL', 'FORWARDING'], { each: true })
  skills?: Array<'SALES' | 'BOOKING' | 'SUPPORT' | 'TECHNICAL' | 'FORWARDING'>;

  @ApiPropertyOptional({
    description: 'Template used to preconfigure the bot capabilities and action forwarding behavior',
    enum: ['GENERAL', 'SALES', 'SUPPORT', 'BOOKING', 'TECHNICAL'],
    example: 'GENERAL',
  })
  @IsOptional()
  @IsString()
  @IsIn(['GENERAL', 'SALES', 'SUPPORT', 'BOOKING', 'TECHNICAL'])
  template?: 'GENERAL' | 'SALES' | 'SUPPORT' | 'BOOKING' | 'TECHNICAL';

  @ApiPropertyOptional({
    description: 'Explicitly enable or disable action forwarding for this bot',
  })
  @IsOptional()
  @IsBoolean()
  actionForwardingEnabled?: boolean;
}
