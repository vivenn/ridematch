export const REDIS_CLIENT = 'REDIS_CLIENT';

export const DRIVERS_GEO_KEY = 'drivers:geo';

export function rideKey(rideId: string) {
  return `ride:${rideId}`;
}

export function rideOffersKey(rideId: string) {
  return `ride:${rideId}:offers`;
}

export function driverActiveRideKey(driverId: string) {
  return `driver:${driverId}:active_ride`;
}
