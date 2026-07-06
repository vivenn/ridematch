import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RideAllocationService } from './ride-allocation.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';

describe('RideAllocationService', () => {
  let service: RideAllocationService;
  let prisma: { ride: any; rideOffer: any; driver: any; $transaction: jest.Mock };
  let redis: { acceptRide: jest.Mock; cancelRide: jest.Mock; removeDriverLocation: jest.Mock };
  let gateway: { notifyRideStatus: jest.Mock };

  beforeEach(() => {
    prisma = {
      ride: { findUnique: jest.fn(), update: jest.fn() },
      rideOffer: { updateMany: jest.fn() },
      driver: { update: jest.fn() },
      $transaction: jest.fn(),
    };
    redis = {
      acceptRide: jest.fn(),
      cancelRide: jest.fn(),
      removeDriverLocation: jest.fn(),
    };
    gateway = { notifyRideStatus: jest.fn() };

    const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService;

    service = new RideAllocationService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      gateway as unknown as NotificationsGateway,
      config,
    );
  });

  describe('accept', () => {
    it('throws NotFoundException when the ride does not exist', async () => {
      redis.acceptRide.mockResolvedValue('NOT_FOUND');
      await expect(service.accept('ride-1', 'driver-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when someone else already has the ride', async () => {
      redis.acceptRide.mockResolvedValue('ALREADY_ASSIGNED');
      await expect(service.accept('ride-1', 'driver-1')).rejects.toThrow(ConflictException);
    });

    it('throws GoneException when the offer is for an expired batch', async () => {
      redis.acceptRide.mockResolvedValue('OFFER_EXPIRED');
      await expect(service.accept('ride-1', 'driver-1')).rejects.toThrow(GoneException);
    });

    it('throws ConflictException when the driver is already on another ride', async () => {
      redis.acceptRide.mockResolvedValue('DRIVER_BUSY');
      await expect(service.accept('ride-1', 'driver-1')).rejects.toThrow(ConflictException);
    });

    it('replays the existing assignment for the winner retrying, without writing again', async () => {
      redis.acceptRide.mockResolvedValue('ALREADY_ASSIGNED_TO_YOU');
      prisma.ride.findUnique.mockResolvedValue({ id: 'ride-1', driverId: 'driver-1', status: 'ASSIGNED' });

      const result = await service.accept('ride-1', 'driver-1');

      expect(result).toEqual({ id: 'ride-1', driverId: 'driver-1', status: 'ASSIGNED' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('persists the assignment when the driver genuinely wins the race', async () => {
      redis.acceptRide.mockResolvedValue('ASSIGNED');
      const assignedRide = { id: 'ride-1', driverId: 'driver-1', status: 'ASSIGNED' };
      prisma.$transaction.mockResolvedValue([assignedRide, {}, {}, {}]);

      const result = await service.accept('ride-1', 'driver-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(redis.removeDriverLocation).toHaveBeenCalledWith('driver-1');
      expect(gateway.notifyRideStatus).toHaveBeenCalledWith('ride-1', {
        rideId: 'ride-1',
        status: 'ASSIGNED',
        driverId: 'driver-1',
      });
      expect(result).toBe(assignedRide);
    });
  });

  describe('cancel', () => {
    it('throws NotFoundException for an unknown ride', async () => {
      redis.cancelRide.mockResolvedValue('NOT_FOUND');
      await expect(service.cancel('ride-1')).rejects.toThrow(NotFoundException);
    });

    it('refuses to cancel a ride that is no longer searching', async () => {
      redis.cancelRide.mockResolvedValue('ASSIGNED');
      await expect(service.cancel('ride-1')).rejects.toThrow(ConflictException);
    });

    it('cancels a ride that is still searching', async () => {
      redis.cancelRide.mockResolvedValue('CANCELLED');
      prisma.ride.update.mockResolvedValue({ id: 'ride-1', status: 'CANCELLED' });

      const result = await service.cancel('ride-1');

      expect(result).toEqual({ id: 'ride-1', status: 'CANCELLED' });
      expect(gateway.notifyRideStatus).toHaveBeenCalledWith('ride-1', { rideId: 'ride-1', status: 'CANCELLED' });
    });
  });
});
