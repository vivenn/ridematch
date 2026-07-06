-- KEYS[1] = ride:{id} hash (status, driverId, activeBatch)
-- KEYS[2] = ride:{id}:offers hash (driverId -> batchNumber)
-- KEYS[3] = driver:{driverId}:active_ride (holds the rideId a driver is currently on, if any)
-- ARGV[1] = driverId trying to accept

local status = redis.call('HGET', KEYS[1], 'status')

if status == false then
  return { 0, 'NOT_FOUND' }
end

if status == 'ASSIGNED' then
  local assignedDriver = redis.call('HGET', KEYS[1], 'driverId')
  if assignedDriver == ARGV[1] then
    return { 1, 'ALREADY_ASSIGNED_TO_YOU' }
  end
  return { 0, 'ALREADY_ASSIGNED' }
end

if status ~= 'SEARCHING' then
  return { 0, status }
end

local activeBatch = redis.call('HGET', KEYS[1], 'activeBatch')
local offeredBatch = redis.call('HGET', KEYS[2], ARGV[1])

if offeredBatch == false or offeredBatch ~= activeBatch then
  return { 0, 'OFFER_EXPIRED' }
end

local busyOn = redis.call('GET', KEYS[3])
if busyOn then
  return { 0, 'DRIVER_BUSY' }
end

redis.call('HSET', KEYS[1], 'status', 'ASSIGNED', 'driverId', ARGV[1])
redis.call('SET', KEYS[3], KEYS[1])
return { 1, 'ASSIGNED' }
