import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { parseBigIntId } from '@/common/utils/bigint.util';
import { assertCompanyAccess } from '@/common/utils/company-access.util';
import { BomLinesService, parseId } from './bom-lines.service';
import { BomsService } from './boms.service';
import {
  AddBomLineDto,
  BomListQueryDto,
  ByItemQueryDto,
  CreateBomDto,
  DeleteBomLineQueryDto,
  ReasonDto,
  ReleaseBomDto,
  RequirementsDto,
  ReviseBomDto,
  UpdateBomDto,
  UpdateBomLineDto,
  WhereUsedQueryDto,
} from './dto/bom.dto';

const IDEMPOTENCY_HEADER = { name: 'Idempotency-Key', required: true, description: 'New UUID per click; reuse only to retry the same click' };

@ApiTags('Bill of Materials')
@ApiBearerAuth()
@Controller('companies/:companyId/boms')
export class BomsController {
  constructor(
    private readonly boms: BomsService,
    private readonly lines: BomLinesService,
  ) {}

  private scope(companyId: string, user: AuthenticatedUser): bigint {
    assertCompanyAccess(companyId, user);
    return parseBigIntId(companyId, 'companyId');
  }

  // ---------- static routes first

  @Get()
  @RequirePermissions('boms:view')
  @ApiOperation({ summary: 'List BOMs (latest version of each by default; allVersions=true for all)' })
  list(@Param('companyId') companyId: string, @Query() query: BomListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.boms.list(this.scope(companyId, user), query, user);
  }

  @Get('where-used')
  @RequirePermissions('boms:view')
  @ApiOperation({ summary: 'BOMs and groups that use an item (MAIN or SUB); current versions by default' })
  whereUsed(@Param('companyId') companyId: string, @Query() query: WhereUsedQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.boms.whereUsed(this.scope(companyId, user), query);
  }

  @Get('by-item/:itemId')
  @RequirePermissions('boms:view')
  @ApiOperation({ summary: 'Current released standard BOM of an item' })
  byItem(
    @Param('companyId') companyId: string,
    @Param('itemId') itemId: string,
    @Query() query: ByItemQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boms.byItem(this.scope(companyId, user), parseId(itemId), query, user);
  }

  @Post()
  @RequirePermissions('boms:create')
  @ApiOperation({ summary: 'Create a DRAFT BOM (number from Number Series BOM), optionally with MAIN groups + SUB lines' })
  create(@Param('companyId') companyId: string, @Body() dto: CreateBomDto, @CurrentUser() user: AuthenticatedUser) {
    return this.boms.create(this.scope(companyId, user), dto, user);
  }

  // ---------- one BOM

  @Get(':bomId')
  @RequirePermissions('boms:view')
  @ApiOperation({ summary: 'BOM header + groups (MAIN with SUB lines by Common Key), allowedActions, rowVersion' })
  get(@Param('companyId') companyId: string, @Param('bomId') bomId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boms.get(this.scope(companyId, user), parseId(bomId), user);
  }

  @Patch(':bomId')
  @RequirePermissions('boms:edit')
  @ApiOperation({ summary: 'Update a DRAFT header (rowVersion required)' })
  update(
    @Param('companyId') companyId: string,
    @Param('bomId') bomId: string,
    @Body() dto: UpdateBomDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boms.updateHeader(this.scope(companyId, user), parseId(bomId), dto, user);
  }

  @Delete(':bomId')
  @RequirePermissions('boms:delete')
  @ApiOperation({ summary: 'Delete a DRAFT BOM (never a released one)' })
  remove(@Param('companyId') companyId: string, @Param('bomId') bomId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boms.remove(this.scope(companyId, user), parseId(bomId), user);
  }

  @Post(':bomId/main-lines')
  @RequirePermissions('boms:edit')
  @ApiOperation({ summary: 'Add a MAIN line; the backend allocates the next Common Key' })
  addMain(
    @Param('companyId') companyId: string,
    @Param('bomId') bomId: string,
    @Body() dto: AddBomLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const cid = this.scope(companyId, user);
    const id = parseId(bomId);
    return this.lines.addMain(cid, id ?? 0n, dto, user);
  }

  @Post(':bomId/main-lines/:mainLineId/sub-lines')
  @RequirePermissions('boms:edit')
  @ApiOperation({ summary: 'Add a SUB line under a MAIN; bomId + commonKey + parentLineId are inherited' })
  addSub(
    @Param('companyId') companyId: string,
    @Param('bomId') bomId: string,
    @Param('mainLineId') mainLineId: string,
    @Body() dto: AddBomLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lines.addSub(this.scope(companyId, user), parseId(bomId) ?? 0n, parseId(mainLineId), dto, user);
  }

  @Patch(':bomId/lines/:lineId')
  @RequirePermissions('boms:edit')
  @ApiOperation({ summary: 'Update a line (item, quantity, findNumber, scrap, remarks); never lineType / commonKey / parentLineId' })
  updateLine(
    @Param('companyId') companyId: string,
    @Param('bomId') bomId: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateBomLineDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lines.updateLine(this.scope(companyId, user), parseId(bomId) ?? 0n, parseId(lineId), dto, user);
  }

  @Delete(':bomId/lines/:lineId')
  @RequirePermissions('boms:edit')
  @ApiOperation({ summary: 'Delete a line; a MAIN with SUB lines needs ?withSubLines=true' })
  deleteLine(
    @Param('companyId') companyId: string,
    @Param('bomId') bomId: string,
    @Param('lineId') lineId: string,
    @Query() query: DeleteBomLineQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.lines.deleteLine(this.scope(companyId, user), parseId(bomId) ?? 0n, parseId(lineId), query, user);
  }

  @Post(':bomId/validate')
  @HttpCode(200)
  @RequirePermissions('boms:view')
  @ApiOperation({ summary: 'Errors and warnings without saving' })
  validate(@Param('companyId') companyId: string, @Param('bomId') bomId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boms.validate(this.scope(companyId, user), parseId(bomId));
  }

  @Post(':bomId/requirements')
  @HttpCode(200)
  @RequirePermissions('boms:view')
  @ApiOperation({ summary: 'Required quantities for a production quantity: per group and flat totals per item' })
  requirements(
    @Param('companyId') companyId: string,
    @Param('bomId') bomId: string,
    @Body() dto: RequirementsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boms.requirements(this.scope(companyId, user), parseId(bomId), dto);
  }

  @Post(':bomId/release')
  @HttpCode(200)
  @RequirePermissions('boms:release')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({ summary: 'Release (validate, snapshot, lock); previous current version becomes OBSOLETE' })
  release(
    @Param('companyId') companyId: string,
    @Param('bomId') bomId: string,
    @Body() dto: ReleaseBomDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boms.release(this.scope(companyId, user), parseId(bomId), dto, user, key);
  }

  @Post(':bomId/revisions')
  @RequirePermissions('boms:revise')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({ summary: 'New DRAFT version from the current RELEASED one (groups and Common Keys copied)' })
  revise(
    @Param('companyId') companyId: string,
    @Param('bomId') bomId: string,
    @Body() dto: ReviseBomDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boms.revise(this.scope(companyId, user), parseId(bomId), dto, user, key);
  }

  @Get(':bomId/revisions')
  @RequirePermissions('boms:view')
  @ApiOperation({ summary: 'All versions of this BOM + status history' })
  revisions(@Param('companyId') companyId: string, @Param('bomId') bomId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.boms.revisions(this.scope(companyId, user), parseId(bomId));
  }

  @Post(':bomId/obsolete')
  @HttpCode(200)
  @RequirePermissions('boms:obsolete')
  @ApiHeader(IDEMPOTENCY_HEADER)
  @ApiOperation({ summary: 'Make a RELEASED BOM obsolete (reason required)' })
  obsolete(
    @Param('companyId') companyId: string,
    @Param('bomId') bomId: string,
    @Body() dto: ReasonDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boms.obsolete(this.scope(companyId, user), parseId(bomId), dto, user, key);
  }

  @Post(':bomId/cancel')
  @HttpCode(200)
  @RequirePermissions('boms:edit')
  @ApiOperation({ summary: 'Cancel a DRAFT (reason required)' })
  cancel(
    @Param('companyId') companyId: string,
    @Param('bomId') bomId: string,
    @Body() dto: ReasonDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.boms.cancel(this.scope(companyId, user), parseId(bomId), dto, user, key);
  }
}
