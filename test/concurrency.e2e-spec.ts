import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface DriverResponse {
  id: string;
}

interface RideOfferResponse {
  driverId: string;
}

interface RideResponse {
  id: string;
  driverId: string;
  offers: RideOfferResponse[];
}

describe('ride acceptance concurrency', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
        .send({
          name: `Concurrency Driver ${i}`,
          phone: `9${runId}${i}`,
          vehicleNo: `TEST${i}`,
        });
      driverIds.push((res.body as DriverResponse).id);
    }

    // stack every driver on the exact same spot so they all land in the same offer batch
    for (const id of driverIds) {
      await request(server)
        .patch(`/drivers/${id}/location`)
        .send({ lat: 12.9716, lng: 77.5946 });
      await request(server)
        .patch(`/drivers/${id}/status`)
        .send({ status: 'ONLINE' });
    }

    const rideRes = await request(server)
      .post('/rides')
      .send({
        riderName: 'Concurrency Test',
        riderPhone: `8${runId}`,
        pickupLat: 12.9716,
        pickupLng: 77.5946,
      });

    const ride = rideRes.body as RideResponse;
    const rideId = ride.id;
    const offeredDriverIds = ride.offers.map((o) => o.driverId);
    expect(offeredDriverIds.length).toBeGreaterThan(1);

    const responses = await Promise.all(
      offeredDriverIds.map((driverId) =>
        request(server).post(`/rides/${rideId}/accept`).send({ driverId }),
      ),
    );

    const successes = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(offeredDriverIds.length - 1);

    const winner = (successes[0].body as RideResponse).driverId;
    const persisted = await prisma.ride.findUniqueOrThrow({
      where: { id: rideId },
    });
    expect(persisted.status).toBe('ASSIGNED');
    expect(persisted.driverId).toBe(winner);

    // the winner retrying (network hiccup, client-side timeout, etc) should replay the same
    // assignment instead of erroring out
    const retry = await request(server)
      .post(`/rides/${rideId}/accept`)
      .send({ driverId: winner });
    expect(retry.status).toBe(201);
    expect((retry.body as RideResponse).driverId).toBe(winner);
  }, 30000);
});
