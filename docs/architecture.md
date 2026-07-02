# Architecture

ComplianceHub is a Next.js modular monolith backed by Supabase PostgreSQL and Auth. Browser code reads and mutates data only through row-level security or validated server operations. Core scoring, SoA, and risk logic is implemented in framework-independent TypeScript.

All tenant-owned rows carry an organisation identifier. Catalogue versions, finalised SoA snapshots, and audit events are immutable. Exports consume finalised snapshots so historical documents are reproducible.
