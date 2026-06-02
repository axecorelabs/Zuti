import { Controller, Get, Param, Query, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminService } from './admin.service';
import {
  AdminListBotsQueryDto,
  AdminCashflowQueryDto,
  AdminListActivityQueryDto,
  AdminOperationsQueryDto,
  AdminSystemHealthQueryDto,
  AdminListUsersQueryDto,
  AdminListWorkspacesQueryDto,
  UpdateAdminUserRoleDto,
} from './dto/admin.dto';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get global Zuti admin overview metrics' })
  getOverview() {
    return this.admin.getOverview();
  }

  @Get('users')
  @ApiOperation({ summary: 'List all Zuti users for super admin management' })
  @ApiQuery({ name: 'role', required: false, enum: ['OWNER', 'ADMIN', 'AGENT'] })
  @ApiQuery({ name: 'limit', required: false })
  listUsers(@Query() query: AdminListUsersQueryDto) {
    return this.admin.listUsers(query);
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'Get a single Zuti user for super admin review' })
  getUser(@Param('userId') userId: string) {
    return this.admin.getUser(userId);
  }

  @Patch('users/:userId/role')
  @ApiOperation({ summary: 'Update a Zuti user global platform role' })
  updateUserRole(@Param('userId') userId: string, @Body() dto: UpdateAdminUserRoleDto) {
    return this.admin.updateUserRole(userId, {
      role: dto.role,
      canCreateWorkspace: dto.canCreateWorkspace,
      managerVerificationStatus: dto.managerVerificationStatus,
    });
  }

  @Get('workspaces')
  @ApiOperation({ summary: 'List all Zuti workspaces (organizations)' })
  @ApiQuery({ name: 'limit', required: false })
  listWorkspaces(@Query() query: AdminListWorkspacesQueryDto) {
    return this.admin.listWorkspaces(query);
  }

  @Get('bots')
  @ApiOperation({ summary: 'List and monitor bots across all workspaces for super admin management' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['ACTIVE', 'INACTIVE'] })
  @ApiQuery({ name: 'channel', required: false, enum: ['TELEGRAM', 'WEB_WIDGET', 'EMAIL', 'WHATSAPP'] })
  @ApiQuery({ name: 'q', required: false })
  listBots(@Query() query: AdminListBotsQueryDto) {
    return this.admin.listBots(query);
  }

  @Get('workspaces/:workspaceId')
  @ApiOperation({ summary: 'Get a single Zuti workspace for super admin review' })
  getWorkspace(@Param('workspaceId') workspaceId: string) {
    return this.admin.getWorkspace(workspaceId);
  }

  @Get('cashflow')
  @ApiOperation({ summary: 'Get platform-wide cashflow summary and recent incoming payments' })
  @ApiQuery({ name: 'limit', required: false })
  getCashflow(@Query() query: AdminCashflowQueryDto) {
    return this.admin.getCashflow(query);
  }

  @Get('activity')
  @ApiOperation({ summary: 'List recent platform-wide activity logs for super admin review' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'page', required: false })
  listActivity(@Query() query: AdminListActivityQueryDto) {
    return this.admin.listActivity(query);
  }

  @Get('operations')
  @ApiOperation({ summary: 'Get platform operations queues, pending invites, and delivery incidents' })
  @ApiQuery({ name: 'limit', required: false })
  getOperations(@Query() query: AdminOperationsQueryDto) {
    return this.admin.getOperations(query);
  }

  @Get('system-health')
  @ApiOperation({ summary: 'Get platform health checks and reliability indicators for super admin' })
  @ApiQuery({ name: 'limit', required: false })
  getSystemHealth(@Query() query: AdminSystemHealthQueryDto) {
    return this.admin.getSystemHealth(query);
  }
}
