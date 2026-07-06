import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { RideAllocationService } from './ride-allocation.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [RidesController],
  providers: [RidesService, RideAllocationService],
  exports: [RidesService, RideAllocationService],
})
export class RidesModule {}
