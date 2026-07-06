import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateDriverStatusDto } from './dto/update-driver-status.dto';

@Controller('drivers')
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Post()
  register(@Body() dto: RegisterDriverDto) {
    return this.driversService.register(dto);
  }

  @Get()
  findAll() {
    return this.driversService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.driversService.findOne(id);
  }

  @Patch(':id/location')
  updateLocation(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.driversService.updateLocation(id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateDriverStatusDto) {
    return this.driversService.updateStatus(id, dto);
  }
}
