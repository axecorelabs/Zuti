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
    enum: ['TELEGRAM', 'WEB_WIDGET', 'EMAIL', 'WHATSAPP'],
    example: 'WEB_WIDGET',
  })
  @IsOptional()
  @IsString()
  @IsIn(['TELEGRAM', 'WEB_WIDGET', 'EMAIL', 'WHATSAPP'])
  primaryChannel?: 'TELEGRAM' | 'WEB_WIDGET' | 'EMAIL' | 'WHATSAPP';

  @ApiPropertyOptional({ example: '123456:ABC-DEF...' })
  @IsOptional()
  @IsString()
  telegramToken?: string;

  @ApiPropertyOptional({
    description: 'Allowed website domains for embed usage (without protocol)',
    example: ['example.com', 'app.example.com'],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  webWidgetAllowedDomains?: string[];

  @ApiPropertyOptional({ description: 'WhatsApp Cloud API phone number ID' })
  @IsOptional()
  @IsString()
  whatsappChannelIdentifier?: string;

  @ApiPropertyOptional({
    description: 'WhatsApp provider backing this bot',
    enum: ['META', 'TWILIO'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['META', 'TWILIO'])
  whatsappProvider?: 'META' | 'TWILIO';

  @ApiPropertyOptional({ description: 'WhatsApp Business Account ID' })
  @IsOptional()
  @IsString()
  whatsappBusinessAccountId?: string;

  @ApiPropertyOptional({
    description: 'WhatsApp integration mode used for connection',
    enum: ['META_EMBEDDED_SIGNUP', 'META_MANUAL', 'TWILIO'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['META_EMBEDDED_SIGNUP', 'META_MANUAL', 'TWILIO'])
  whatsappIntegrationMode?: 'META_EMBEDDED_SIGNUP' | 'META_MANUAL' | 'TWILIO';

  @ApiPropertyOptional({ description: 'Customer-visible WhatsApp sender number in E.164 format' })
  @IsOptional()
  @IsString()
  whatsappPhoneNumber?: string;

  @ApiPropertyOptional({ description: 'Customer-visible WhatsApp display name' })
  @IsOptional()
  @IsString()
  whatsappDisplayName?: string;

  @ApiPropertyOptional({ description: 'Provider-specific WhatsApp configuration payload' })
  @IsOptional()
  @IsObject()
  whatsappConfig?: Record<string, unknown>;

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

  @ApiPropertyOptional({ description: 'Enable WhatsApp channel for this bot' })
  @IsOptional()
  @IsBoolean()
  whatsappEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'WhatsApp provider backing this bot',
    enum: ['META', 'TWILIO'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['META', 'TWILIO'])
  whatsappProvider?: 'META' | 'TWILIO';

  @ApiPropertyOptional({
    description: 'WhatsApp integration mode used for connection',
    enum: ['META_EMBEDDED_SIGNUP', 'META_MANUAL', 'TWILIO'],
  })
  @IsOptional()
  @IsString()
  @IsIn(['META_EMBEDDED_SIGNUP', 'META_MANUAL', 'TWILIO'])
  whatsappIntegrationMode?: 'META_EMBEDDED_SIGNUP' | 'META_MANUAL' | 'TWILIO';

  @ApiPropertyOptional({ description: 'Provider-specific unique WhatsApp channel identifier' })
  @IsOptional()
  @IsString()
  whatsappChannelIdentifier?: string;

  @ApiPropertyOptional({ description: 'Customer-visible WhatsApp sender number in E.164 format' })
  @IsOptional()
  @IsString()
  whatsappPhoneNumber?: string;

  @ApiPropertyOptional({ description: 'Customer-visible WhatsApp display name' })
  @IsOptional()
  @IsString()
  whatsappDisplayName?: string;

  @ApiPropertyOptional({ description: 'Provider-specific WhatsApp configuration payload' })
  @IsOptional()
  @IsObject()
  whatsappConfig?: Record<string, unknown>;

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

export class CompleteMetaEmbeddedSignupDto {
  @ApiProperty({ description: 'OAuth code returned by Meta after embedded signup' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ description: 'OAuth state returned by Meta after embedded signup' })
  @IsString()
  @IsNotEmpty()
  state!: string;

  @ApiPropertyOptional({ description: 'Optional selected WhatsApp business account ID when finalizing immediately' })
  @IsOptional()
  @IsString()
  selectedBusinessAccountId?: string;

  @ApiPropertyOptional({ description: 'Optional selected WhatsApp phone number ID when finalizing immediately' })
  @IsOptional()
  @IsString()
  selectedPhoneNumberId?: string;
}

export class CompleteMetaEmbeddedSelectionDto {
  @ApiProperty({ description: 'Pending embedded signup selection session identifier' })
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @ApiProperty({ description: 'Selected WhatsApp phone number ID from available options' })
  @IsString()
  @IsNotEmpty()
  selectedPhoneNumberId!: string;

  @ApiPropertyOptional({ description: 'Optional selected business account ID for additional validation' })
  @IsOptional()
  @IsString()
  selectedBusinessAccountId?: string;
}
