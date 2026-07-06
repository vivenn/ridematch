-- KEYS[1] = ride:{id} hash (status, driverId, activeBatch)
-- ARGV[1] = the batch number that is currently timing out
-- ARGV[2] = 'TIMEOUT' to close the ride out, otherwise the next batch number to move to

local status = redis.call('HGET', KEYS[1], 'status')

if status ~= 'SEARCHING' then
  return { 0, status }
end

local activeBatch = redis.call('HGET', KEYS[1], 'activeBatch')
if activeBatch ~= ARGV[1] then
  return { 0, 'ALREADY_ADVANCED' }
end

if ARGV[2] == 'TIMEOUT' then
  redis.call('HSET', KEYS[1], 'status', 'TIMEOUT')
  return { 1, 'TIMEOUT' }
end

redis.call('HSET', KEYS[1], 'activeBatch', ARGV[2])
return { 1, 'ADVANCED' }
