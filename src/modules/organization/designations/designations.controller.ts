import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { CreateDesignationDto, UpdateDesignationDto } from './dto/designation.dto';
import { DesignationsService } from './designations.service';

@ApiTags('Designations')
@ApiBearerAuth()
@Controller('companies/:companyId/designations')
export class DesignationsController {
  constructor(private readonly designationsService: DesignationsService) {}

  @Get()
  @RequirePermissions('designations:view')
  @ApiOperation({ summary: 'List designations for company' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.designationsService.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('designations:view')
  @ApiOperation({ summary: 'Get designation by ID' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.designationsService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('designations:create')
  @ApiOperation({ summary: 'Create designation' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateDesignationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.designationsService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('designations:edit')
  @ApiOperation({ summary: 'Update designation' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDesignationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.designationsService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('designations:delete')
  @ApiOperation({ summary: 'Delete designation' })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    assertCompanyAccess(companyId, user);
    return this.designationsService.remove(id, companyId, user.sub);
  }
}
