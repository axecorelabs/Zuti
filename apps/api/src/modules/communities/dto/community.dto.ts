import { IsString, IsNotEmpty, MaxLength, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommunityDto {
  @ApiProperty({ example: 'bot_123', description: 'A COMMAND bot already connected to this org' })
  @IsString()
  @IsNotEmpty()
  declare botId: string;

  @ApiProperty({ example: '-1001234567890', description: 'The Telegram channel/supergroup id — the bot must already be an admin there' })
  @IsString()
  @IsNotEmpty()
  declare telegramChatId: string;

  @ApiPropertyOptional({ example: 'tidesandtribes' })
  @IsOptional()
  @IsString()
  telegramChatUsername?: string;

  @ApiProperty({ example: 'Tides & Tribes Community' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare name: string;
}

export class UpdateCommunityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telegramChatUsername?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
