# Bug reproductions

Run from the repository root:

```sh
npm run repro:bugs
```

This builds the current source and executes 20 assertion-based cases covering the 15 findings from the project review.
**CONFIRMED means the bug exists.** These checks intentionally assert the faulty behavior; a successful run is not a
passing regression suite.

Each case prints its finding number, severity, method, expected correct behavior, and observed behavior. A separate
child process isolates each case and limits it to 15 seconds. There are no added dependencies.

To inspect or select cases:

```sh
node scripts/reproduce-bugs.mjs --list
npm run repro:bugs -- --case 3
npm run repro:bugs -- --case 03-read
```

A finding number runs all cases for that finding. An exact case ID runs just that case. After an existing build, the
script can also run directly with Node; its imports resolve relative to the script, independently of the working
directory. Run it as a file rather than piping it through Node's --input-type=module mode, which interferes with the
compression dependency's worker startup.

| Finding | Severity    | Case IDs             | What is checked                                                                     |
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
afterward. Everything else uses the public store API and synthetic file setup. These methods are also labeled in the
console and JSON report.

Exit codes:

- 0: Every selected case confirmed its asserted bug signature.
- 1: At least one case did not confirm its signature, with no execution errors.
- 2: Invalid arguments, worker failure, timeout, or another execution error.

A non-confirmed case is not automatically proof of a fix. Check its assertions and result against the changed
implementation. For example, a fix that serializes operations may prevent a controlled interleaving and cause its worker
to exit or time out; this is reported as an error, never as confirmation. Some fixes deliberately reject inputs accepted
by the old implementation, so those cases also need to be updated when converted into regression tests.
