import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '@/common/decorators/auth.decorators';
import { CompanyId, CurrentUser } from '@/common/decorators/current-user.decorator';
import { PaginationQueryDto } from '@/common/dto/pagination.dto';
import { AuthenticatedUser } from '@/common/interfaces/auth.interface';
import { CreateUserDeviceDto, UpdateUserDeviceDto } from './dto/user-device.dto';
import { UserDevicesService } from './user-devices.service';

@ApiTags('User Devices')
@ApiBearerAuth()
@Controller('users/:userId/devices')
export class UserDevicesController {
  constructor(private readonly userDevicesService: UserDevicesService) {}

  @Get()
  @RequirePermissions('user_devices:view')
  @ApiOperation({ summary: 'List devices for a user' })
  findAll(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.userDevicesService.findAll(userId, companyId, query);
  }

  @Get(':id')
  @RequirePermissions('user_devices:view')
  @ApiOperation({ summary: 'Get user device by ID' })
  findOne(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
  ) {
    return this.userDevicesService.findOne(userId, companyId, id);
  }

  @Post()
  @RequirePermissions('user_devices:create')
  @ApiOperation({ summary: 'Register a user device' })
  create(
    @Param('userId') userId: string,
    @CompanyId() companyId: string,
    @Body() dto: CreateUserDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDevicesService.create(userId, companyId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermissions('user_devices:edit')
  @ApiOperation({ summary: 'Update device metadata or trust/block status' })
  update(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @Body() dto: UpdateUserDeviceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDevicesService.update(userId, companyId, id, dto, user.sub);
  }

  @Delete(':id')
  @RequirePermissions('user_devices:delete')
  @ApiOperation({ summary: 'Delete user device' })
  remove(
    @Param('userId') userId: string,
    @Param('id') id: string,
    @CompanyId() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userDevicesService.remove(userId, companyId, id, user.sub);
  }
}
