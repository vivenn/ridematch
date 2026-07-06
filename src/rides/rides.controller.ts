import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RidesService } from './rides.service';
import { RideAllocationService } from './ride-allocation.service';
import { RequestRideDto } from './dto/request-ride.dto';
import { AcceptRideDto } from './dto/accept-ride.dto';

@Controller('rides')
export class RidesController {
  constructor(
    private readonly ridesService: RidesService,
    private readonly allocation: RideAllocationService,
  ) {}

  @Post()
  create(@Body() dto: RequestRideDto) {
    return this.ridesService.create(dto);
  }

  @Get()
  findAll() {
    return this.ridesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ridesService.findOne(id);
  }

  @Post(':id/accept')
  accept(@Param('id') id: string, @Body() dto: AcceptRideDto) {
    return this.allocation.accept(id, dto.driverId);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.allocation.cancel(id);
  }
}
