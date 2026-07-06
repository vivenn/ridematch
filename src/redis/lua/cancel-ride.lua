-- KEYS[1] = ride:{id} hash
-- cancels a ride only if it hasn't already been assigned or closed out

local status = redis.call('HGET', KEYS[1], 'status')

if status == false then
  return { 0, 'NOT_FOUND' }
end

if status ~= 'SEARCHING' then
  return { 0, status }
end

redis.call('HSET', KEYS[1], 'status', 'CANCELLED')
return { 1, 'CANCELLED' }
