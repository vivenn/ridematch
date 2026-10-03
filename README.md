# ridematch

Real-time driver allocation service. A rider requests a ride, the system finds the
nearest online drivers using Redis geo search, offers the ride to a small batch of them
at once, and makes sure exactly one of them ends up assigned even if several try to
accept in the same instant.

## Stack

- NestJS (TypeScript)
- PostgreSQL + Prisma
- Redis (geo search + atomic assignment via Lua)
- Socket.IO for pushing offers to drivers

## Running it

```bash
docker compose up -d        # postgres + redis
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

The API listens on `http://localhost:3000`.

To quickly have some drivers to test against:

```bash
npm run seed
```

This registers six drivers around Connaught Place, Delhi and puts them online.

## Running the concurrency test

```bash
npm run test:e2e
```

`test/concurrency.e2e-spec.ts` spins up the app against the real Postgres/Redis, puts
five drivers on the same spot, creates a ride, then fires `POST /rides/:id/accept` for
all of them **at the same time** with `Promise.all`. It asserts exactly one request
comes back `201` and the rest come back `409`, and that the ride in Postgres agrees with
whoever won. It also checks that the winner retrying the same accept call gets the same
result back instead of an error, which is the idempotency requirement.

## Architecture

```
 rider                         drivers
   |                              |
   | POST /rides                  | (connected over websocket,
   v                              |  joined room driver:{id})
+-----------------------------+   |
|  RidesService.create        |   |
|  - saves ride (REQUESTED)   |   |
+-----------------------------+   |
   |                              |
   v                              |
+-----------------------------+   |
| RideAllocationService        |   |
|  - flips ride to SEARCHING   |   |
|  - GEOSEARCH drivers:geo     |   |
|    for nearest N drivers     |   |
|  - records offers in pg+redis|   |
|  - emits "ride:offer" ------------> driver app(s)
|  - starts offer timeout timer|   |
+-----------------------------+   |
   |                              |
   |                    POST /rides/:id/accept { driverId }
   |                              |
   v                              v
+---------------------------------------------+
| redis EVAL assign-ride.lua                    |
| atomically: is ride still SEARCHING, is this   |
| driver's offer still for the active batch,     |
| is the driver free? -> assign, else reject     |
+---------------------------------------------+
   |
   v
 winner: ride -> ASSIGNED in postgres, driver -> ON_TRIP, "ride:status" pushed to rider
 losers: 409 (someone else got it) / 410 (offer already expired)

 nobody accepts in time -> advance-batch.lua atomically moves to the next nearest
 batch of drivers, or closes the ride out to TIMEOUT after the configured retries
```

## Ride lifecycle

`REQUESTED -> SEARCHING -> ASSIGNED`, with `SEARCHING -> TIMEOUT` if nobody accepts
after all retries, and `SEARCHING -> CANCELLED` if the rider cancels mid-search. Once a
ride is `ASSIGNED`, `TIMEOUT` or `CANCELLED` it's terminal.

## Concurrency design

This is the part the assignment cares most about, so here's the reasoning.

**Why Redis Lua scripts instead of a distributed lock.** A lock (Redlock or otherwise)
would mean: acquire lock for ride X, read its status, decide, write, release lock. That's
correct but it's two round trips wrapped around application logic, plus lock TTL
tuning and the risk of a stuck lock if a process dies mid-hold. A ride assignment is a
single, small, well-defined state transition ("if SEARCHING, become ASSIGNED"), and Redis
already executes a Lua script as one atomic unit with no other client's commands
interleaved. So the check-and-set just *is* the lock, with no separate acquire/release
step and nothing to leak if a request dies halfway through.

**How the actual race is closed.** `assign-ride.lua` (`src/redis/lua/assign-ride.lua`)
does the whole "is this ride still available, and is this specific driver's offer still
valid" check and the write in one round trip. When two drivers hit `/accept` at the same
moment, Redis simply executes one script fully before the other starts - there is no
window where both can read "still SEARCHING". Whoever's script runs first flips the
ride to `ASSIGNED`; the second one reads that new state and is rejected. This is verified
by `test/concurrency.e2e-spec.ts`, which fires real concurrent HTTP requests rather than
just asserting the behaviour in prose.

**The "driver accepts right as the timeout fires" edge case.** Each batch of offers has
a `batchNumber`, and the ride hash tracks an `activeBatch`. Accepting only succeeds if
the driver's offer belongs to the currently active batch. When a batch's timer expires,
`advance-batch.lua` atomically bumps `activeBatch` (or closes the ride to `TIMEOUT`) -
again in one script, so it can't overlap with an in-flight accept for that same batch.
If the accept script runs first, the ride is already `ASSIGNED` by the time the timeout
handler looks, and it just backs off. If the timeout script runs first, the late
driver's `activeBatch` check fails and they get a `410 Gone` ("your offer has expired")
instead of a stale assignment.

**Idempotency.** A driver retrying the same accept call (network blip, client-side
retry, whatever) is handled by the same script: if the ride is already `ASSIGNED` to
*that* driver, it returns success again rather than an error. No separate idempotency
key is needed because the natural identity of the operation - "this driver accepting
this ride" - is already what the script checks against.

**Stopping a driver from being double-booked across two different rides.** The
assignment's concurrency requirement is about one ride, but the same driver can also be
offered on two different rides that are searching at the same time. `assign-ride.lua`
also checks a `driver:{id}:active_ride` key and refuses to assign a driver who's already
on a trip, so accepting ride B while mid-trip on ride A fails with `409` instead of
quietly double-booking them. That key is cleared when a driver flips back to `ONLINE`.

**Timeout/retry scheduling.** Each batch's timeout is a plain `setTimeout` in
`RideAllocationService`, which is simple and easy to reason about for a single process.
The tradeoff: if the process restarts mid-search, in-flight timers are lost. For a
multi-instance deployment I'd move this to delayed jobs (BullMQ, backed by the same
Redis) so any worker can pick up the timeout - the Redis-side atomicity here wouldn't
need to change at all, only who's responsible for firing the timer.

## Notifications

Drivers get ride offers over a Socket.IO gateway (`src/notifications/notifications.gateway.ts`):
connect with `?driverId=<id>` and the server pushes a `ride:offer` event to that driver's
room. Riders can connect with `?rideId=<id>` to receive `ride:status` events as the ride
moves through its lifecycle.

Accepting is done over REST (`POST /rides/:id/accept`), not over the socket. Reasoning:
the notification side just needs to fan a message out to a batch of drivers, which
websockets are a natural fit for, but the accept path is the part that has to be
correct under concurrency, and a plain HTTP endpoint backed by an atomic Redis script is
far easier to reason about (and to test with concurrent HTTP requests) than juggling
multiple socket connections racing each other.

## API

Base URL: `http://localhost:3000`. A Postman collection is at
`postman/vybecabs.postman_collection.json`. curl examples:

```bash
# register a driver
curl -X POST localhost:3000/drivers \
  -H "Content-Type: application/json" \
  -d '{"name":"Ramesh Kumar","phone":"9810000001","vehicleNo":"DL01AB1001"}'

# update a driver's location
curl -X PATCH localhost:3000/drivers/<driverId>/location \
  -H "Content-Type: application/json" \
  -d '{"lat":28.6139,"lng":77.2090}'

# bring a driver online (only online drivers are searchable)
curl -X PATCH localhost:3000/drivers/<driverId>/status \
  -H "Content-Type: application/json" \
  -d '{"status":"ONLINE"}'

# request a ride
curl -X POST localhost:3000/rides \
  -H "Content-Type: application/json" \
  -d '{"riderName":"Aman","riderPhone":"9999999999","pickupLat":28.6139,"pickupLng":77.2090}'

# check ride status / who's been offered it
curl localhost:3000/rides/<rideId>

# driver accepts
curl -X POST localhost:3000/rides/<rideId>/accept \
  -H "Content-Type: application/json" \
  -d '{"driverId":"<driverId>"}'

# rider cancels while still searching
curl -X POST localhost:3000/rides/<rideId>/cancel
```

## Configuration

See `.env.example`. The interesting knobs:

| var | default | meaning |
|---|---|---|
| `RIDE_OFFER_TIMEOUT_MS` | 15000 | how long a batch of drivers has to respond |
| `RIDE_BATCH_SIZE` | 3 | how many nearest drivers get offered at once |
| `RIDE_MAX_RETRIES` | 3 | how many times to retry with a fresh batch before giving up |
| `RIDE_SEARCH_RADIUS_KM` | 5 | geo search radius |
