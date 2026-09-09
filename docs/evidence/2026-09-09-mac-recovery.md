# Mac stability and local recovery — 9 September 2026

## Observed failure

The owner reported repeated freezes/shutdowns during ComplianceHub development. Git could not create its index lock because the filesystem was full. The retained local database VM subsequently returned I/O errors. These are observed environment failures, not failed compliance workflows.

Targeted macOS diagnostic records show a low-swap event at 18:22 BST. Its largest process was Node (PID 2642): 777,927 pages at 16,384 bytes per page, approximately 11.9 GiB of accounted memory, with a recorded lifetime maximum approximately 12.3 GiB. This machine has 16 GiB RAM. A separate diagnostic for the same PID reported approximately 2.15 GB of disk writes over ten minutes. WindowServer stopped responding for about 40 seconds. Together, these observations support development memory growth combined with insufficient disk/swap headroom as a contributor to this episode. They do not establish that every shutdown has the same cause, identify the allocating module, or rule out an OS/hardware issue. Raw OS reports remain private on the Mac.

## Recovery and mitigation

- Preserved source, all database volumes and existing fictional records. No database reset, personal-file deletion, operating-system change or unrelated application termination.
- Removed only generated `.next/cache` and `.next/dev/cache` directories in the active worktree and two inactive ComplianceHub checkouts. These rebuild automatically. Available Data-volume space rose from about 7.8 GiB to about 13 GiB after the additional cleanup; space varies while macOS reclaims swap and tools write output.
- Restarted the retained Colima/Docker environment following the disk I/O failure. PostgreSQL and authentication health checks recovered. An unrelated original-stack log collector remained unhealthy; this is not presented as repaired.
- Built the current working application in production mode with a 2 GiB Node old-space setting and two Rust worker threads. The build passed, including TypeScript. A sampled build parent plus typechecking worker used roughly 1.8 GiB resident memory. This is a sample, not a measured peak.
- Served a separate production copy on `http://127.0.0.1:3300`, connected only to the isolated local Supabase API on port 55321. Fresh HTTP health returned app and database OK; the existing fictional coordinator's saved policy opened in the actual browser. Production serving avoids the development compiler's accumulation while browsing many routes. The preview launcher now runs independently with macOS as its parent, rather than depending on a temporary terminal session. It does not automatically restart the database or app after an OS shutdown.
- Restored the missing isolated Realtime service using the already-installed pinned image after the supported CLI skipped an already-running stack. Its WebSocket connection and authenticated fictional task subscription pass. This consumed approximately 186 MiB in the measured sample; no application or database restart or existing-record edit was required.
- Added and tested a [local command resource guard](../local-resource-guard.md): refuse startup below 8 GiB disk headroom, interrupt its own process group below 6 GiB free or above 4 GiB resident memory, and preserve unrelated applications. One test/build/browser worker workload at a time. The guard is a sampled precaution, not an OS-enforced memory limit; Node's heap setting alone does not cap native/compiler allocations.

## Evidence limits

A successful production build and healthy local page do not prove long-term Mac stability. No deliberate reproduction of system-wide exhaustion was attempted: that could lose the owner's work. Guard tests use small artificial thresholds and harmless child processes. The prior development and browser runs interrupted by disk failure remain incomplete evidence. Subsequent complete runs must be recorded separately in the release checklist.
