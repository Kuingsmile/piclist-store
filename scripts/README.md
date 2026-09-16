# Benchmarks

```sh
yarn benchmark
yarn benchmark 1000 10000 --runs 3
yarn benchmark 100 --json
```

The command builds current source before comparing it with published `3.0.1`. After building, run
`node scripts/benchmark.mjs` directly to skip the build. Sizes must be integers from 1 to 100,000; the default is 1,000
and 10,000. `--runs` accepts 1 to 20 and defaults to 1. `--help` lists the options.

Each store and dataset size gets a table with the operation, work per run, legacy milliseconds, current milliseconds,
and a relative faster/slower label. Times cover the entire workload in the row, not the average per call. With multiple
runs, each column reports its median and the comparison is the ratio of those medians. Lower milliseconds are better.
`--json` emits one JSON object per store/size with numeric timings and `speedup = legacyMs / currentMs` (above 1 means
current is faster). Use the direct Node command for JSON output without package-manager/build messages.

- **DBStore:** opening/reading, cached reads, successful and missing ID lookups, sorted pagination, count/existence
  queries, forced reloads, single and batch inserts/updates/deletes, and overwrites.
- **JSONStore:** opening/reading, cached get/has, forced reloads, single and batch sets, unset, and clear.
- Rows marked `*` compare newer APIs with equivalent legacy operations: `count()` versus `get().total`, `hasById()`
  versus `Boolean(getById())`, `removeMany()` versus sequential `removeById()`, and `setMany()` versus sequential
  `set()`. These measure equivalent final results; sequential legacy writes do not have the current batch atomicity
  guarantees.

Cached read workloads run 100 calls. Insert/remove/set batches and overwrite replacement lists contain at most 25
records/keys to bound legacy full-file writes. `updateMany()` updates the whole dataset. Overwrite starts with the full
dataset and replaces it with the bounded replacement list. DB fixtures are ordered by creation time so legacy reverse
ordering and current timestamp sorting return identical pages; this does not compare arbitrary unsorted input.

Every measurement starts from the same synthetic fixture. Repeated runs alternate version order. Fixture creation,
loading for warm operations, assertions, and reopening to verify persisted mutations are excluded from timings. Opening
includes construction and the initial read, but does not flush the operating system's filesystem cache. Timings include
each version's validation and persistence behavior; no performance threshold is asserted. These are local measurements
affected by startup, JIT, garbage collection, filesystem caching, and machine load. Use repeated runs for a more
representative comparison. Temporary fixtures are removed even if a check fails.

# Bug reproductions

Run from the repository root:

```sh
yarn repro:bugs
```

This builds the current source and executes 20 assertion-based cases covering the 15 findings from the project review.
The default mode asserts correct behavior: **FIXED means those assertions passed**, REGRESSION means an assertion
failed, and ERROR means the case could not complete. `--verify-fixed` explicitly selects this mode.

The original faulty-behavior assertions remain available with `--reproduce`. In that historical mode, CONFIRMED means
the bug exists; an unsuccessful historical reproduction alone does not prove a fix. Use the default verification mode to
validate the corrections.

Each case prints its finding number, severity, method, expected correct behavior, and observed behavior. A separate
child process isolates each case and limits it to 15 seconds. There are no added dependencies.

To inspect or select cases:

```sh
node scripts/reproduce-bugs.mjs --list
yarn repro:bugs --case 3
yarn repro:bugs --case 03-read
yarn repro:bugs --reproduce --case 3
```

A finding number runs all cases for that finding. An exact case ID runs just that case. After an existing build, the
script can also run directly with Node; its imports resolve relative to the script, independently of the working
directory. Run it as a file rather than piping it through Node's --input-type=module mode, which interferes with the
compression dependency's worker startup.

| Finding | Severity    | Case IDs             | Original bug covered                                                                |
| ------- | ----------- | -------------------- | ----------------------------------------------------------------------------------- |
| 1       | P1 / High   | 01                   | A delayed older write restores a deleted record on disk.                            |
| 2       | P1 / High   | 02-db, 02-json       | Corrupt files are accepted as empty, then overwritten.                              |
| 3       | P1 / High   | 03-read, 03-write    | Initialization exposes empty data and can lose saved records.                       |
| 4       | P1 / High   | 04-db, 04-json       | Two instances targeting one file overwrite each other's changes.                    |
| 5       | P2 / Medium | 05-count, 05-partial | Batch inserts write n+1 times; a rejected overwrite persists a partial replacement. |
| 6       | P2 / Medium | 06                   | Changing an ID breaks the index and permits duplicates.                             |
| 7       | P2 / Medium | 07                   | Inherited property names are mistaken for existing IDs.                             |
| 8       | P2 / Medium | 08                   | Opening a new collection in an existing database throws.                            |
| 9       | P2 / Medium | 09                   | A rejected insert is persisted by a later successful insert.                        |
| 10      | P2 / Medium | 10-write, 10-default | Documented write() and get(key, defaultValue) do not work.                          |
| 11      | P2 / Medium | 11                   | Timestamp sorting follows insertion order instead.                                  |
| 12      | P2 / Medium | 12                   | unset cannot remove bracket paths accepted by set/get/has.                          |
| 13      | P2 / Medium | 13                   | Named properties on an accepted array root disappear after reopening.               |
| 14      | P2 / Medium | 14                   | Reinsertion resets creation time and returns an incomplete record.                  |
| 15      | P3 / Low    | 15                   | Returned batch timestamps differ from stored timestamps.                            |

The script creates a new directory named piclist-store-repro-* under the system temporary directory. All database paths
point into freshly created case directories. It reads and writes only synthetic fixtures, does not touch test_data or
any existing application databases, and does not delete directories. Fixtures and results.json are retained for
inspection; the final output prints their location. Parser diagnostics are suppressed because they can include file
contents.

Cases 01 and 03-write pause real adapter operations with promises to make a permitted asynchronous ordering
reproducible. They do not alter snapshots or invent filesystem results. Case 05-count wraps the real writer to count
calls; cases 05-partial and 09 inject a write rejection. Case 15 uses an advancing Date.now test clock and restores it
afterward. The verification for case 04-db also injects a failure to test queue recovery. Case 09 uses the JSON adapter
to simulate synchronous write failures, and case 08 writes a legacy fixture without its index. The controlled
verification cases release their gates even when operations correctly wait. These methods are labeled in the console and
JSON report.

Shared-file verification covers independent instances within one Node.js process. DBStore mutations use a per-file
queue; JSONStore mutations reload synchronously. This does not provide a cross-process transaction lock. Cached reads
can be refreshed explicitly with `read(true)`.

Exit codes:

- 0: Every selected case passed its assertions in the selected mode.
- 1: At least one assertion failed, with no execution errors.
- 2: Invalid arguments, worker failure, timeout, or another execution error.

The historical timing reproductions can time out or throw after fixes prevent their old schedules or reject invalid
inputs. Those outcomes are never treated as successful verification.
