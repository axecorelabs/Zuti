import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MinLength, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { CannedResponsesService } from './canned-responses.service';

class CreateDto {
  @IsString() @IsNotEmpty() @MinLength(1) @MaxLength(50)
  declare shortcut: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  declare title: string;

  @IsString() @IsNotEmpty() @MaxLength(2000)
  declare content: string;
}

class UpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(50)
  declare shortcut?: string;

  @IsOptional() @IsString() @MaxLength(100)
  declare title?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  declare content?: string;
}

@ApiTags('canned-responses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@Controller('organizations/:id/canned-responses')
export class CannedResponsesController {
  constructor(private readonly service: CannedResponsesService) {}

  @Get()
  @ApiOperation({ summary: 'List all canned responses' })
  findAll(@Param('id') orgId: string) {
    return this.service.findAll(orgId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a canned response' })
  create(@Param('id') orgId: string, @Body() dto: CreateDto) {
    return this.service.create(orgId, dto);
  }

  @Patch(':responseId')
  @ApiOperation({ summary: 'Update a canned response' })
  update(
    @Param('id') orgId: string,
    @Param('responseId') responseId: string,
    @Body() dto: UpdateDto,
  ) {
    return this.service.update(orgId, responseId, dto);
  }

  @Delete(':responseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a canned response' })
  remove(@Param('id') orgId: string, @Param('responseId') responseId: string) {
    return this.service.remove(orgId, responseId);
  }
}
