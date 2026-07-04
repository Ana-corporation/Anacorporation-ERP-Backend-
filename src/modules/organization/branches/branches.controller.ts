import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { BranchesService } from './branches.service';

@ApiTags('Branches')
@ApiBearerAuth()
@Controller('companies/:companyId/branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @RequirePermissions('branches:view')
  @ApiOperation({ summary: 'List branches for company' })
  findAll(@Param('companyId') companyId: string, @Query() query: PaginationQueryDto) {
    return this.branchesService.findAll(companyId, query);
  }

  @Get(':id')
  @RequirePermissions('branches:view')
  @ApiOperation({ summary: 'Get branch by ID' })
  findOne(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.branchesService.findOne(id, companyId);
  }

  @Post()
  @RequirePermissions('branches:create')
  @ApiOperation({ summary: 'Create branch' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateBranchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.branchesService.create(companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('branches:edit')
  @ApiOperation({ summary: 'Update branch' })
  update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.branchesService.update(id, companyId, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('branches:delete')
  @ApiOperation({ summary: 'Delete branch' })
  remove(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.branchesService.remove(id, companyId, user.sub);
  }
}
