---
title: "Reading PostgreSQL EXPLAIN ANALYZE: A Backend Engineer's Guide to Slow Queries"
date: 2026-09-28
category: "Databases"
tag: "PostgreSQL Performance"
tags: ["PostgreSQL", "SQL", "Query Optimization", "Indexes", "Performance"]
image: "img/blog/postgres-explain-analyze-guide.jpg"
featured: false
description: "How to read PostgreSQL query plans with EXPLAIN (ANALYZE, BUFFERS), spot bad row estimates, choose the right index, and fix the slow-query patterns backend services hit most."
---

Most slow API endpoints I've looked at weren't slow because of the application code. They were slow because of one query, and that query was slow because Postgres picked a plan nobody expected. The way to see that plan is `EXPLAIN ANALYZE`, and learning to read it is one of the best returns on time a backend engineer can get.

## Always use ANALYZE and BUFFERS

Plain `EXPLAIN` shows what Postgres *plans* to do. `EXPLAIN ANALYZE` actually runs the query and shows what happened. Add `BUFFERS` to see how much data it touched:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, total
FROM orders
WHERE customer_id = 4821 AND status = 'paid'
ORDER BY created_at DESC
LIMIT 20;
```

One warning: `ANALYZE` executes the statement. For `UPDATE` or `DELETE`, wrap it in a transaction and roll back:

```sql
BEGIN;
EXPLAIN (ANALYZE, BUFFERS) UPDATE orders SET status = 'void' WHERE ...;
ROLLBACK;
```

## How to read a plan

A plan is a tree. Execution starts at the most indented nodes and flows up. Each node looks something like this:

```text
Index Scan using orders_customer_id_idx on orders
  (cost=0.43..812.20 rows=95 width=16)
  (actual time=0.041..38.512 rows=9120 loops=1)
  Filter: (status = 'paid'::text)
  Rows Removed by Filter: 41388
  Buffers: shared hit=1204 read=3310
```

What to look at, in order:

1. **`actual time`**: the second number is the total time for the node, in milliseconds. Find the node where the time jumps. That's your problem.
2. **`rows` estimated vs actual**: here Postgres expected 95 rows and got 9,120. When estimates are off by 10x or more, the planner is making decisions with bad information, and the plan built on top is often wrong.
3. **`loops`**: the time and rows are *per loop*. A node showing 0.5ms with `loops=20000` actually cost 10 seconds.
4. **`Rows Removed by Filter`**: the index found rows, then Postgres threw most of them away. That usually means the index doesn't match the query.
5. **`Buffers`**: `shared hit` came from Postgres's cache, `read` came from disk or the OS cache. Lots of `read` on a hot query means the working set doesn't fit in memory, or the query is touching far more data than it needs.

## The common scan types

- **Seq Scan**: reads the whole table. Fine for small tables or queries that return a big fraction of rows. A problem on a large table when you want a handful of rows.
- **Index Scan**: walks the index, then fetches each matching row from the table.
- **Index Only Scan**: answers entirely from the index, without visiting the table. Very fast, but only if the visibility map is up to date, which depends on vacuum.
- **Bitmap Heap Scan**: collects matching row locations from one or more indexes first, then reads the table in physical order. Good for medium-sized result sets.

And the join types:

- **Nested Loop**: for each row on one side, look up matches on the other. Great when the outer side is small and the inner lookup is indexed. Terrible when the outer side turns out to be huge, which is what bad estimates cause.
- **Hash Join**: build a hash table from one side, probe with the other. Good for large unsorted inputs.
- **Merge Join**: walk two sorted inputs together.

## Fixing the example: a better index

In the plan above, Postgres used an index on `customer_id`, then filtered out 41,388 rows by status, then had to sort what was left by `created_at`. A composite index that matches the query fixes all three:

```sql
CREATE INDEX CONCURRENTLY orders_customer_status_created_idx
  ON orders (customer_id, status, created_at DESC);
```

The order of columns matters. Equality columns go first (`customer_id`, `status`), then the column you sort or range-scan on (`created_at`). Now Postgres can jump straight to the matching rows, already in order, and stop after 20. The sort node disappears from the plan.

If the query only needs a couple of extra columns, an `INCLUDE` clause can turn it into an index-only scan:

```sql
CREATE INDEX CONCURRENTLY orders_customer_status_created_idx
  ON orders (customer_id, status, created_at DESC) INCLUDE (total);
```

Always use `CONCURRENTLY` on production tables. A plain `CREATE INDEX` blocks writes for the whole build.

## When estimates are wrong

Bad row estimates cause most surprising plans. The usual causes:

- **Stale statistics.** After a big data load or delete, run `ANALYZE orders;`. Autovacuum does this eventually, but "eventually" can be too late.
- **Correlated columns.** Postgres assumes columns are independent by default. If `city = 'Pune'` and `state = 'MH'` always go together, it'll underestimate the combination badly. Extended statistics fix this:

  ```sql
  CREATE STATISTICS orders_city_state (dependencies) ON city, state FROM orders;
  ANALYZE orders;
  ```

- **Skewed data.** If one value is extremely common, increase the statistics target for that column so Postgres samples it better: `ALTER TABLE orders ALTER COLUMN status SET STATISTICS 1000;`.

## Patterns that come up again and again

- **Functions on indexed columns.** `WHERE lower(email) = $1` can't use a plain index on `email`. Create an expression index on `lower(email)`, or store the normalized value.
- **`OFFSET` pagination on deep pages.** `OFFSET 100000` still reads and discards 100,000 rows. Switch to keyset pagination: `WHERE created_at < $last_seen ORDER BY created_at DESC LIMIT 20`.
- **Type mismatches.** Comparing a `bigint` column to a `numeric` parameter, or `text` to `varchar` in some ORMs, can stop an index from being used. The plan will show a cast in the filter.
- **`OR` across different columns.** `WHERE a = $1 OR b = $2` often turns into a seq scan. A `UNION` of two indexed queries can be much faster.
- **N+1 queries from the ORM.** No single query looks slow, but there are 300 of them per request. `pg_stat_statements` will show the same query with a huge call count.

## Find the queries worth fixing

Don't optimize queries at random. Enable `pg_stat_statements` and look at total time, not just mean time:

```sql
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```

A 2ms query called 50 million times a day costs far more than a 3-second report that runs once an hour. For catching slow plans in production as they happen, the `auto_explain` module can log plans for any query slower than a threshold.

<!-- TODO(Manas): optional, add a short example from your own work, e.g. a query where a composite index or keyset pagination turned seconds into milliseconds. -->

## Takeaways

- Use `EXPLAIN (ANALYZE, BUFFERS)`. Plain `EXPLAIN` only shows guesses.
- Find the node where time jumps, and compare estimated rows to actual rows.
- Remember time and rows are per loop.
- Build composite indexes with equality columns first, then sort or range columns. Create them `CONCURRENTLY`.
- Fix estimates with `ANALYZE`, extended statistics, and higher statistics targets.
- Use `pg_stat_statements` to pick which queries to fix by total cost.
