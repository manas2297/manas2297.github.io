---
title: "Distributed Locking Patterns in High-Concurrency Microservices"
date: 2026-08-18
category: "Platform Engineering"
tag: "Architecture & Scale"
tags: ["Redis", "PostgreSQL", "Distributed Systems", "Locks", "Kubernetes"]
image: "img/redis_locks.jpg"
featured: false
description: "Why sync.Mutex stops working once you scale out, how to build a safe Redis lock with tokens and atomic release, why fencing tokens matter, and when you don't need a lock at all."
---

A `sync.Mutex` protects memory inside one process. The moment you run three replicas of a service on Kubernetes, each pod has its own mutex, and they know nothing about each other. If two pods pick up work for the same customer at the same time, the mutex does nothing to stop them.

That's when people reach for a distributed lock. Fair enough, they're useful. They're also one of the easiest things in backend engineering to get subtly wrong, and quite often they're not the right tool in the first place.

## How a simple lock breaks

The usual first attempt is `SET lock:key 1 NX PX 30000`: set the key only if it doesn't exist, with a 30-second expiry. Do the work, then `DEL` the key. Looks fine. It isn't.

1. **The lock expires before the work finishes.** A slow database query, a retrying HTTP call, or a long GC pause pushes the work past 30 seconds. The key expires. Another pod acquires the lock. Now two pods are doing the "exclusive" work at the same time.
2. **You delete someone else's lock.** Pod A's lock expires, Pod B acquires it, then Pod A finishes and runs `DEL`. It just released Pod B's lock, and Pod C can walk right in.
3. **Everyone hammers Redis at once.** Hundreds of workers spinning on the same lock in tight retry loops is a thundering herd. Redis CPU and network spike, and the lock turns into the bottleneck.

## A lock that handles the basics

The second problem is the easy one. Store a unique token as the value, and only delete the key if it still holds *your* token. The check and the delete have to be atomic, so use a Lua script.

```go
var release = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("DEL", KEYS[1])
end
return 0
`)

func Acquire(ctx context.Context, rdb *redis.Client, key string, ttl time.Duration) (string, bool, error) {
	token := uuid.NewString()
	ok, err := rdb.SetNX(ctx, key, token, ttl).Result()
	return token, ok, err
}

func Release(ctx context.Context, rdb *redis.Client, key, token string) error {
	return release.Run(ctx, rdb, []string{key}, token).Err()
}
```

For the first problem you have two levers. Size the TTL comfortably above the p99 of the critical section, not the average. And extend the lease while you work: a background goroutine can refresh the TTL every `ttl/3`, using the same compare-the-token check so it never extends a lock it no longer owns. If a refresh fails, cancel the work's context.

For the third, add jittered backoff to acquisition retries and keep locks fine-grained. `lock:tenant_123:payout` lets thousands of tenants run in parallel. A global `lock:payouts` serializes the whole system.

## Leases alone are not enough: fencing tokens

Now the uncomfortable part. Even with tokens and lease extension, a Redis lock can't fully protect you. Say Pod A acquires the lock and then freezes for 40 seconds, in a stop-the-world pause or a network partition. The lease expires, Pod B takes over and writes to the database. Pod A wakes up with no idea any time has passed, and writes too.

Client-side care can't fix this, because Pod A *can't know* it was paused. The fix has to live in the resource you're protecting. Martin Kleppmann's well-known critique of Redlock describes the standard answer: fencing tokens.

Every time the lock is granted, hand out a number that only ever goes up. The storage layer remembers the highest token it has seen and rejects writes with an older one:

```sql
UPDATE payouts
SET    status = $1, fence = $2
WHERE  id = $3 AND fence < $2;
```

If Pod A shows up late with token 33 after Pod B already wrote with token 34, the update affects zero rows. You can generate the token with `INCR` on a Redis key, ideally in the same Lua script that does the `SET NX` so acquiring the lock and getting its token is one atomic step. A database sequence works too.

## Sometimes you don't need a lock

A lot of "we need a distributed lock" problems are really "we need an atomic operation." If the decision fits in a single round trip, do it in one place and skip the lock entirely.

A Lua script runs atomically in Redis, so this counter enforces a limit with no lock at all:

```lua
-- KEYS[1] = counter key, ARGV[1] = limit, ARGV[2] = ttl seconds
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then
  return 0
end
current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 1
```

The same idea applies in PostgreSQL. A conditional `UPDATE ... WHERE balance >= $1` or an `INSERT ... ON CONFLICT DO NOTHING` often replaces a lock completely, and the database's own concurrency control does the work.

## When the data already lives in Postgres

If the thing you're protecting is a row in PostgreSQL, you may not need Redis in the loop at all. Postgres has advisory locks:

```sql
-- returns true if acquired; released automatically at transaction end
SELECT pg_try_advisory_xact_lock(hashtext('payout:tenant_123'));
```

Transaction-scoped advisory locks can't leak. They're released when the transaction ends, even if the client crashes. And for work-queue patterns, `SELECT ... FOR UPDATE SKIP LOCKED` lets many workers pull distinct rows without stepping on each other.

## Picking the right tool

| Situation | Reach for |
|---|---|
| Decision fits in one atomic step | Lua script, conditional `UPDATE`, unique constraint |
| Protected data lives in Postgres | Advisory lock or `SELECT ... FOR UPDATE SKIP LOCKED` |
| Cross-service, efficiency only (duplicate work is wasteful, not dangerous) | Redis lock with token and TTL |
| Correctness matters (duplicate work corrupts data) | Lock **plus** fencing tokens checked by the storage layer |

Before adding any lock, ask what happens if two holders run at once. "We do some work twice" means a simple lease is fine. "We pay someone twice" means you need fencing, or a design where the database enforces the invariant for you.

Better still is making duplicate work harmless in the first place. That's the subject of [idempotency and the transactional outbox pattern](/posts/transactional-outbox-idempotent-consumers/).
