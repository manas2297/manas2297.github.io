---
title: "Timeouts, Retries, and Backoff: How to Call Other Services Without Causing an Outage"
seoTitle: "Timeouts, Retries, and Backoff Without Causing an Outage"
date: 2026-10-04
category: "Reliability"
tag: "Resilience Patterns"
tags: ["Reliability", "Microservices", "Go", "Retries", "Circuit Breaker"]
image: "img/blog/timeouts-retries-backoff.jpg"
featured: false
description: "How to set timeouts from real latency data, retry with exponential backoff and jitter, cap retries with budgets, and avoid retry storms that cause outages."
---

A network call can fail fast, fail slowly, or never come back. Failing fast is the easy case. The other two cause outages. A missing timeout ties up resources until the process runs out, and a naive retry takes a struggling dependency and hits it three times harder while it's down.

Timeout and retry logic gets copy-pasted around every backend I've seen, and it's dangerous to get wrong. Here's how I think about it.

## Every call needs a timeout

Plenty of HTTP clients default to no timeout at all. In Go, a zero-value `http.Client{}` will wait forever. Rule one: never make a network call without a deadline.

```go
var client = &http.Client{
	Timeout: 2 * time.Second, // hard upper bound for the whole request
}

func GetUser(ctx context.Context, id string) (*User, error) {
	ctx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, userURL(id), nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	// ...
}
```

Same for database queries, Redis calls, Kafka produce calls. Anything that crosses a network.

## Pick timeouts from data, not round numbers

Most timeouts get chosen because "five seconds feels safe." That's too long to protect you, and it has nothing to do with how the dependency actually behaves.

Start from data instead:

1. Look at the dependency's latency distribution under normal load.
2. Set the timeout a bit above its p99 or p99.9. If p99 is 80ms, a 250 to 300ms timeout catches genuinely stuck calls without cutting off normal slow ones.
3. Check it against your own latency budget. If your endpoint promises 500ms and calls three services in sequence, they can't each have a 1-second timeout.

## Propagate deadlines

Timeouts set independently at each hop don't compose. Say service A has a 1-second budget and calls B, which calls C with its own 2-second timeout. A gives up after 1 second. C keeps working for another second on a request nobody is waiting for.

Deadline propagation fixes this: pass the remaining time along with the request and have every hop respect it. In Go this happens naturally if you pass the incoming request's `context.Context` all the way down instead of creating fresh ones from `context.Background()`. gRPC propagates deadlines across services automatically. For HTTP, you can send the remaining budget in a header and have the callee build its context from it.

One small extra that's worth it: if the remaining deadline is already shorter than the fastest the call could possibly be, fail now instead of starting work that can't finish.

## Only retry what's safe to retry

Two questions before adding retries.

**Is the operation idempotent?** Retrying a `GET` is safe. Retrying "charge this card" without an idempotency key can charge it twice. A timeout doesn't tell you the request failed, only that you didn't get an answer. The server may well have done the work. (I cover idempotency keys in the [outbox and idempotent consumers](/posts/transactional-outbox-idempotent-consumers/) post.)

**Is the error retryable?** Retry connection errors, timeouts, `503`, and `429` (respecting `Retry-After`). Don't retry `400`, `401`, `404`, or validation errors; they'll fail the same way every time.

## Exponential backoff with jitter

Retrying immediately just piles load onto a dependency that's already struggling. Fixed intervals are a bit better, but a thousand clients that failed together will retry together. That's a synchronized wave.

The standard fix is exponential backoff with jitter. Wait longer after each attempt, and randomize the wait so clients spread out.

```go
func backoff(attempt int, base, max time.Duration) time.Duration {
	d := base << attempt // base * 2^attempt
	if d > max || d <= 0 {
		d = max
	}
	return time.Duration(rand.Int64N(int64(d))) // "full jitter": random in [0, d)
}

func withRetry(ctx context.Context, attempts int, fn func(context.Context) error) error {
	var err error
	for i := 0; i < attempts; i++ {
		if err = fn(ctx); err == nil || !retryable(err) {
			return err
		}
		select {
		case <-time.After(backoff(i, 50*time.Millisecond, 2*time.Second)):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return err
}
```

"Full jitter" picks a random wait between zero and the exponential cap. It looks odd at first, because some retries happen almost immediately, but AWS's well-known analysis of backoff strategies found it spreads load out far better than adding a little noise to a fixed schedule.

Keep attempts low. Two or three in total is plenty for most calls.

## Retries multiply across layers

This is the part that causes real outages. A request passes through three services, and each tries up to 3 times. When the bottom service fails, the middle one tries 3 times, and the top one retries the middle one 3 times. That's 3 × 3 × 3 = 27 attempts on the bottom service for every user request, right when it's trying to recover.

To keep it under control, retry at one layer only, usually the one closest to the user or the one that knows the operation is safe. Inner layers fail fast. Put retries under a budget too: allow them only while they're a small fraction of total traffic, say 10%, so when a dependency is really down they stop instead of tripling load. gRPC's retry throttling works this way. And with deadlines propagated, retries stop on their own once the time is gone.

## Circuit breakers

A circuit breaker tracks recent failures to a dependency. Past a failure-rate threshold it opens, failing calls immediately without sending them, for a cool-down period. Then it lets a few trial requests through (half-open). If those succeed, it closes again.

Both sides win. Your service stops burning threads, connections, and latency budget on calls that will fail, and the dependency gets room to recover. Pair it with a fallback where one makes sense, like a cached value or a degraded response.

## Hedged requests for tail latency

Idempotent reads get one more tool. If a request hasn't come back by roughly the dependency's p95, send a second copy to another replica and take whichever answers first. Google's "The Tail at Scale" paper describes it. It can cut tail latency sharply for a small increase in load. Only hedge reads that are safe to duplicate, and cap how many hedges you send.

## Checklist

- Every network call has a timeout, set from the dependency's real latency.
- Deadlines propagate through the call chain via context.
- Only idempotent operations, and only retryable errors, get retried.
- Retries use exponential backoff with full jitter and a small attempt count.
- Retries happen at one layer, under a budget.
- Circuit breakers guard dependencies that can fail hard.

All of this protects you from *other* services. Protecting your own service from too much incoming work is the other half, covered in [backpressure and load shedding](/posts/backpressure-load-shedding-services/).
