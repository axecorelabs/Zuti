import { IsString, IsNotEmpty, MaxLength, IsOptional, IsBoolean, IsObject, IsArray, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBotDto {
  @ApiProperty({ example: 'Support Bot' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare name: string;

  @ApiProperty({ example: '123456:ABC-DEF...' })
  @IsString()
  @IsNotEmpty()
  declare telegramToken: string;
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
