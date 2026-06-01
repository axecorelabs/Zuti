import { IsEmail, IsString, IsOptional, IsIn, IsInt, Min, Max, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInvitationDto {
  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  declare email: string;

  @ApiProperty({ example: 'clxyz123' })
  @IsString()
  declare orgId: string;

  @ApiPropertyOptional({ enum: ['AGENT', 'ADMIN'], default: 'AGENT' })
  @IsOptional()
  @IsIn(['AGENT', 'ADMIN'])
  role?: string;
}

export class CreateJoinCodeDto {
  @ApiProperty({ example: 'clxyz123' })
  @IsString()
  declare orgId: string;

  @ApiPropertyOptional({ enum: ['AGENT', 'ADMIN'], default: 'AGENT' })
  @IsOptional()
  @IsIn(['AGENT', 'ADMIN'])
  role?: 'AGENT' | 'ADMIN';

  @ApiPropertyOptional({ minimum: 1, maximum: 168, default: 72 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  expiresInHours?: number;
}

export class RedeemJoinCodeDto {
  @ApiProperty({ example: 'J7F2C9A1' })
  @IsString()
  @Length(6, 24)
  declare joinId: string;

  @ApiProperty({ example: '839204' })
  @IsString()
  @Length(4, 32)
  declare code: string;
}
