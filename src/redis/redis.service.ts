import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Redis } from 'ioredis';
import { REDIS_CLIENT, DRIVERS_GEO_KEY, rideKey, rideOffersKey, driverActiveRideKey } from './redis.constants';

export interface NearbyDriver {
  driverId: string;
  distanceKm: number;
}

export type AssignResult =
  | 'ASSIGNED'
  | 'ALREADY_ASSIGNED_TO_YOU'
  | 'ALREADY_ASSIGNED'
  | 'OFFER_EXPIRED'
  | 'DRIVER_BUSY'
  | 'NOT_FOUND'
  | string;
export type AdvanceResult = 'ADVANCED' | 'TIMEOUT' | 'ALREADY_ADVANCED' | string;

const LUA_DIR = join(__dirname, 'lua');
const assignRideScript = readFileSync(join(LUA_DIR, 'assign-ride.lua'), 'utf8');
const advanceBatchScript = readFileSync(join(LUA_DIR, 'advance-batch.lua'), 'utf8');
const cancelRideScript = readFileSync(join(LUA_DIR, 'cancel-ride.lua'), 'utf8');

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {}

  async onModuleDestroy() {
    await this.client.quit();
  }

  async setDriverLocation(driverId: string, lat: number, lng: number) {
    await this.client.geoadd(DRIVERS_GEO_KEY, lng, lat, driverId);
  }

  async removeDriverLocation(driverId: string) {
    await this.client.zrem(DRIVERS_GEO_KEY, driverId);
  }

  async findNearbyDrivers(lat: number, lng: number, radiusKm: number, count: number): Promise<NearbyDriver[]> {
    const results = (await this.client.geosearch(
      DRIVERS_GEO_KEY,
      'FROMLONLAT',
      lng,
      lat,
      'BYRADIUS',
      radiusKm,
      'km',
      'ASC',
      'COUNT',
      count,
      'WITHDIST',
    )) as unknown as [string, string][];

    return results.map(([driverId, distanceKm]) => ({
      driverId,
      distanceKm: parseFloat(distanceKm),
    }));
  }

  async initRideState(rideId: string, activeBatch: number) {
    await this.client.hset(rideKey(rideId), { status: 'SEARCHING', activeBatch });
  }

  async recordOffers(rideId: string, driverIds: string[], batchNumber: number) {
    if (driverIds.length === 0) return;
    const fields: (string | number)[] = [];
    for (const driverId of driverIds) {
      fields.push(driverId, batchNumber);
    }
    await this.client.hset(rideOffersKey(rideId), ...fields);
  }

  async acceptRide(rideId: string, driverId: string): Promise<AssignResult> {
    const [, message] = (await this.client.eval(
      assignRideScript,
      3,
      rideKey(rideId),
      rideOffersKey(rideId),
      driverActiveRideKey(driverId),
      driverId,
    )) as [number, AssignResult];
    return message;
  }

  async releaseDriver(driverId: string) {
    await this.client.del(driverActiveRideKey(driverId));
  }

  async advanceBatch(rideId: string, currentBatch: number, next: number | 'TIMEOUT'): Promise<AdvanceResult> {
    const [, message] = (await this.client.eval(
      advanceBatchScript,
      1,
      rideKey(rideId),
      String(currentBatch),
      String(next),
    )) as [number, AdvanceResult];
    return message;
  }

  async cancelRide(rideId: string): Promise<AssignResult> {
    const [, message] = (await this.client.eval(cancelRideScript, 1, rideKey(rideId))) as [number, AssignResult];
    return message;
  }

  async getRideState(rideId: string) {
    return this.client.hgetall(rideKey(rideId));
  }
}
