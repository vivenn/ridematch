import { ConflictException, GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DriverStatus, Ride, RideStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';

@Injectable()
export class RideAllocationService {
  private readonly logger = new Logger(RideAllocationService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  private readonly offerTimeoutMs: number;
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly searchRadiusKm: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: NotificationsGateway,
    config: ConfigService,
  ) {
    this.offerTimeoutMs = config.get<number>('RIDE_OFFER_TIMEOUT_MS', 15000);
    this.batchSize = config.get<number>('RIDE_BATCH_SIZE', 3);
    this.maxRetries = config.get<number>('RIDE_MAX_RETRIES', 3);
    this.searchRadiusKm = config.get<number>('RIDE_SEARCH_RADIUS_KM', 5);
  }

  async startAllocation(ride: Ride) {
    await this.prisma.ride.update({ where: { id: ride.id }, data: { status: RideStatus.SEARCHING } });
    await this.redis.initRideState(ride.id, 0);
    await this.runBatch(ride.id, ride.pickupLat, ride.pickupLng, 0);
  }

  async accept(rideId: string, driverId: string) {
    const result = await this.redis.acceptRide(rideId, driverId);

    if (result === 'NOT_FOUND') {
      throw new NotFoundException('ride not found');
    }

    if (result === 'ALREADY_ASSIGNED_TO_YOU') {
      return this.prisma.ride.findUnique({ where: { id: rideId }, include: { assignedDriver: true } });
    }

    if (result === 'ALREADY_ASSIGNED') {
      throw new ConflictException('this ride has already been assigned to another driver');
    }

    if (result === 'OFFER_EXPIRED') {
      throw new GoneException('your offer for this ride has expired');
    }

    if (result === 'DRIVER_BUSY') {
      throw new ConflictException('you are already on another ride');
    }

    if (result !== 'ASSIGNED') {
      throw new ConflictException(`ride cannot be accepted, current status is ${result}`);
    }

    this.clearTimer(rideId);

    const now = new Date();
    const [ride] = await this.prisma.$transaction([
      this.prisma.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.ASSIGNED, driverId, assignedAt: now },
        include: { assignedDriver: true },
      }),
      this.prisma.rideOffer.updateMany({
        where: { rideId, driverId },
        data: { status: 'ACCEPTED', respondedAt: now },
      }),
      this.prisma.rideOffer.updateMany({
        where: { rideId, driverId: { not: driverId }, status: 'PENDING' },
        data: { status: 'EXPIRED', respondedAt: now },
      }),
      this.prisma.driver.update({ where: { id: driverId }, data: { status: DriverStatus.ON_TRIP } }),
    ]);

    await this.redis.removeDriverLocation(driverId);
    this.gateway.notifyRideStatus(rideId, { rideId, status: 'ASSIGNED', driverId });

    return ride;
  }

  async cancel(rideId: string) {
    const result = await this.redis.cancelRide(rideId);

    if (result === 'NOT_FOUND') {
      throw new NotFoundException('ride not found');
    }

    if (result !== 'CANCELLED') {
      throw new ConflictException(`cannot cancel a ride that is already ${result.toLowerCase()}`);
    }

    this.clearTimer(rideId);

    const ride = await this.prisma.ride.update({
      where: { id: rideId },
      data: { status: RideStatus.CANCELLED, cancelledAt: new Date() },
    });

    await this.prisma.rideOffer.updateMany({
      where: { rideId, status: 'PENDING' },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    });

    this.gateway.notifyRideStatus(rideId, { rideId, status: 'CANCELLED' });
    return ride;
  }

  private async runBatch(rideId: string, lat: number, lng: number, batchNumber: number) {
    const previousOffers = await this.prisma.rideOffer.findMany({ where: { rideId }, select: { driverId: true } });
    const alreadyOffered = new Set(previousOffers.map((o) => o.driverId));

    const nearby = await this.redis.findNearbyDrivers(
      lat,
      lng,
      this.searchRadiusKm,
      this.batchSize * (batchNumber + 1) + alreadyOffered.size,
    );

    const candidates = nearby.map((n) => n.driverId).filter((id) => !alreadyOffered.has(id)).slice(0, this.batchSize);

    if (candidates.length === 0) {
      await this.closeOutRide(rideId, batchNumber);
      return;
    }

    await this.prisma.rideOffer.createMany({
      data: candidates.map((driverId) => ({ rideId, driverId, batchNumber })),
      skipDuplicates: true,
    });
    await this.redis.recordOffers(rideId, candidates, batchNumber);

    const ride = await this.prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    this.gateway.notifyDriversOfOffer(candidates, {
      rideId,
      batchNumber,
      riderName: ride.riderName,
      pickup: { lat: ride.pickupLat, lng: ride.pickupLng },
      drop: ride.dropLat != null && ride.dropLng != null ? { lat: ride.dropLat, lng: ride.dropLng } : null,
      expiresInMs: this.offerTimeoutMs,
    });

    const timer = setTimeout(() => {
      this.handleBatchTimeout(rideId, lat, lng, batchNumber).catch((err) =>
        this.logger.error(`batch timeout handling failed for ride ${rideId}`, err),
      );
    }, this.offerTimeoutMs);
    this.timers.set(rideId, timer);
  }

  private async handleBatchTimeout(rideId: string, lat: number, lng: number, batchNumber: number) {
    const nextBatch = batchNumber + 1;

    if (nextBatch > this.maxRetries) {
      await this.closeOutRide(rideId, batchNumber);
      return;
    }

    const result = await this.redis.advanceBatch(rideId, batchNumber, nextBatch);
    await this.expireBatchOffers(rideId, batchNumber);

    if (result === 'ADVANCED') {
      await this.prisma.ride.update({ where: { id: rideId }, data: { retryCount: nextBatch } });
      await this.runBatch(rideId, lat, lng, nextBatch);
      return;
    }

    // anything else means the ride was already resolved elsewhere (e.g. a driver accepted
    // the instant this timer fired) - the accept path owns cleanup from here
    this.timers.delete(rideId);
  }

  // atomically closes a ride out to TIMEOUT, but only if it hasn't already been won by an accept
  // that snuck in just as this batch's window ran out
  private async closeOutRide(rideId: string, batchNumber: number) {
    const result = await this.redis.advanceBatch(rideId, batchNumber, 'TIMEOUT');
    await this.expireBatchOffers(rideId, batchNumber);

    if (result === 'TIMEOUT') {
      await this.prisma.ride.update({ where: { id: rideId }, data: { status: RideStatus.TIMEOUT } });
      this.gateway.notifyRideStatus(rideId, { rideId, status: 'TIMEOUT' });
    }

    this.timers.delete(rideId);
  }

  private async expireBatchOffers(rideId: string, batchNumber: number) {
    await this.prisma.rideOffer.updateMany({
      where: { rideId, batchNumber, status: 'PENDING' },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    });
  }

  private clearTimer(rideId: string) {
    const timer = this.timers.get(rideId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(rideId);
    }
  }
}
