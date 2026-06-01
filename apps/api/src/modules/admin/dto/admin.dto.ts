import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class AdminListUsersQueryDto {
  @ApiPropertyOptional({ description: 'Filter users by one of their membership roles', enum: ['OWNER', 'ADMIN', 'AGENT'] })
  @IsOptional()
  @IsIn(['OWNER', 'ADMIN', 'AGENT'])
  role?: 'OWNER' | 'ADMIN' | 'AGENT';

  @ApiPropertyOptional({ description: 'Number of users to return', default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class AdminListWorkspacesQueryDto {
  @ApiPropertyOptional({ description: 'Number of workspaces to return', default: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class AdminListBotsQueryDto {
  @ApiPropertyOptional({ description: 'Number of bots to return', default: 200, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({ description: 'Filter by bot active status', enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ description: 'Filter by primary bot channel', enum: ['TELEGRAM', 'WEB_WIDGET', 'EMAIL', 'WHATSAPP'] })
  @IsOptional()
  @IsIn(['TELEGRAM', 'WEB_WIDGET', 'EMAIL', 'WHATSAPP'])
  channel?: 'TELEGRAM' | 'WEB_WIDGET' | 'EMAIL' | 'WHATSAPP';

  @ApiPropertyOptional({ description: 'Search by bot name, workspace name, or workspace slug' })
  @IsOptional()
  q?: string;
}

export class AdminListActivityQueryDto {
  @ApiPropertyOptional({ description: 'Number of activity rows to return', default: 50, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class AdminCashflowQueryDto {
  @ApiPropertyOptional({ description: 'Number of recent cashflow rows to return', default: 50, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class AdminOperationsQueryDto {
  @ApiPropertyOptional({ description: 'Number of recent operation rows to return', default: 25, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class AdminSystemHealthQueryDto {
  @ApiPropertyOptional({ description: 'Number of recent system events to return', default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class UpdateAdminUserRoleDto {
  @ApiPropertyOptional({ description: 'Global platform role for the user', enum: ['USER', 'MANAGER'] })
  @IsIn(['USER', 'MANAGER'])
  role!: 'USER' | 'MANAGER';
}
