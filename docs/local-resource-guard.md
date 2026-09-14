# Running local work within the Mac's capacity

Use the resource guard around one development or verification command at a time:

```sh
node --import=tsx scripts/local-resource-guard.ts -- npm run test -- --maxWorkers=1
node --import=tsx scripts/local-resource-guard.ts -- npm run demo:build
```

The guard refuses to start with less than **8 GiB** available on the working directory's disk. Once started, it checks once per second and stops its command if available space falls below **6 GiB**, or the command and its process-group descendants exceed **4 GiB of resident memory**. It first asks that group to stop, then forces it to stop after three seconds. An interruption also stops that group. It never searches for unrelated applications to close. Commands that leave background children behind have those children stopped when the command ends.

The inherited Node setting limits each child's V8 **old-generation heap** to 2 GiB. This is not a cap on total Node memory: native allocations, younger heap generations and additional processes consume memory too. An inherited percentage heap setting is refused because Node lets it override the fixed setting. A child that replaces its environment or explicitly overrides Node arguments can bypass the inherited setting.

These are sampled safeguards, not an operating-system memory limit or a guarantee against a crash. Resident-memory totals can double-count shared pages and understate compressed or swapped memory. A process that deliberately starts another process group escapes this group's monitoring. Other applications, Docker and writes to other disks are outside this guard. A sudden allocation or write between samples can exceed the reserve. Prefer a production preview for longer app reviews and keep builds and browser tests sequential.

This script does not change database targets or credentials. Continue using the supported local launchers and their local-environment checks. A stopped build may need rerunning; the guard deletes no files or records. Do not free space by deleting database volumes or personal files.

Advanced diagnostic overrides use `--min-start-gib=N`, `--min-free-gib=N`, `--max-rss-mib=N`, `--interval-ms=N` and `--grace-ms=N` before `--`. The focused tests use deliberately low thresholds with tiny processes; they do not fill the disk or exhaust memory. Keep the defaults for normal work on this Mac.

Verify the guard itself:

```sh
node node_modules/vitest/vitest.mjs run src/test/local-resource-guard.test.ts --maxWorkers=1
```
