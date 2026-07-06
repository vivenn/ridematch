import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('ride acceptance concurrency', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('assigns exactly one driver when several drivers accept the same ride at the same instant', async () => {
    const server = app.getHttpServer();
    const runId = Date.now();

    const driverIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(server)
        .post('/drivers')
        .send({ name: `Concurrency Driver ${i}`, phone: `9${runId}${i}`, vehicleNo: `TEST${i}` });
      driverIds.push(res.body.id);
    }

    // stack every driver on the exact same spot so they all land in the same offer batch
    for (const id of driverIds) {
      await request(server).patch(`/drivers/${id}/location`).send({ lat: 12.9716, lng: 77.5946 });
      await request(server).patch(`/drivers/${id}/status`).send({ status: 'ONLINE' });
    }

    const rideRes = await request(server)
      .post('/rides')
      .send({ riderName: 'Concurrency Test', riderPhone: `8${runId}`, pickupLat: 12.9716, pickupLng: 77.5946 });

    const rideId = rideRes.body.id;
    const offeredDriverIds: string[] = rideRes.body.offers.map((o: { driverId: string }) => o.driverId);
    expect(offeredDriverIds.length).toBeGreaterThan(1);

    const responses = await Promise.all(
      offeredDriverIds.map((driverId) => request(server).post(`/rides/${rideId}/accept`).send({ driverId })),
    );

    const successes = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(offeredDriverIds.length - 1);

    const ride = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(ride.status).toBe('ASSIGNED');
    expect(ride.driverId).toBe(successes[0].body.driverId);

    // the winner retrying (network hiccup, client-side timeout, etc) should replay the same
    // assignment instead of erroring out
    const retry = await request(server).post(`/rides/${rideId}/accept`).send({ driverId: ride.driverId });
    expect(retry.status).toBe(201);
    expect(retry.body.driverId).toBe(ride.driverId);
  }, 30000);
});
