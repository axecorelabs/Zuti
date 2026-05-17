import { IsEmail, IsString, IsOptional, IsIn } from 'class-validator';
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
