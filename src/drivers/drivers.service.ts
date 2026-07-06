import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DriverStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { RegisterDriverDto } from './dto/register-driver.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateDriverStatusDto } from './dto/update-driver-status.dto';

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async register(dto: RegisterDriverDto) {
    try {
      return await this.prisma.driver.create({ data: dto });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('a driver with this phone number already exists');
      }
      throw err;
    }
  }

  findAll() {
    return this.prisma.driver.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const driver = await this.prisma.driver.findUnique({ where: { id } });
    if (!driver) {
      throw new NotFoundException('driver not found');
    }
    return driver;
  }

  async updateLocation(id: string, dto: UpdateLocationDto) {
    const driver = await this.findOne(id);

    const updated = await this.prisma.driver.update({
      where: { id },
      data: { lat: dto.lat, lng: dto.lng },
    });

    if (driver.status === DriverStatus.ONLINE) {
      await this.redis.setDriverLocation(id, dto.lat, dto.lng);
    }

    return updated;
  }

  async updateStatus(id: string, dto: UpdateDriverStatusDto) {
    const driver = await this.findOne(id);

    const updated = await this.prisma.driver.update({
      where: { id },
      data: { status: dto.status },
    });

    if (dto.status === DriverStatus.ONLINE) {
      if (driver.lat != null && driver.lng != null) {
        await this.redis.setDriverLocation(id, driver.lat, driver.lng);
      }
    } else {
      await this.redis.removeDriverLocation(id);
    }

    return updated;
  }
}
