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
}
