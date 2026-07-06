import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RideAllocationService } from './ride-allocation.service';
import { RequestRideDto } from './dto/request-ride.dto';

@Injectable()
export class RidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocation: RideAllocationService,
  ) {}

  async create(dto: RequestRideDto) {
    const ride = await this.prisma.ride.create({
      data: {
        riderName: dto.riderName,
        riderPhone: dto.riderPhone,
        pickupLat: dto.pickupLat,
        pickupLng: dto.pickupLng,
        dropLat: dto.dropLat,
        dropLng: dto.dropLng,
      },
    });

    await this.allocation.startAllocation(ride);

    return this.findOne(ride.id);
  }

  findAll() {
    return this.prisma.ride.findMany({
      orderBy: { requestedAt: 'desc' },
      include: { assignedDriver: true },
    });
  }

  async findOne(id: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id },
      include: { assignedDriver: true, offers: true },
    });
    if (!ride) {
      throw new NotFoundException('ride not found');
    }
    return ride;
  }
}
