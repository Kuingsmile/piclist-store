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
