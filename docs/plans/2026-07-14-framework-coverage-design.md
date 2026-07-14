# Framework Coverage Experience Design

## Purpose

Turn `/app/frameworks` into the plain-language Statement of Applicability (SoA)
coverage view. It explains how an organisation-authored mapping connects one
shared ISO 27001 control to one published requirement reference in another
framework, and how mature SoA implementation can reuse recorded work and
evidence.

This is not a canonical cross-framework catalogue. ComplianceHub will not seed,
license, infer, or endorse mappings. The organisation owns every reference and
rationale it records.

## Coverage model

- A recorded external requirement is identified by framework plus requirement
  reference.
- It is **Covered** when any ISO control mapped to it has an SoA status of
  `established`, `operational`, or `advanced`.
- Several ISO controls mapped to one external requirement use OR semantics. The
  requirement is counted once, and every row for it shows the same status.
- Percentages use only distinct requirements recorded by the organisation as
  the denominator. They never represent total framework compliance,
  certification, legal advice, or audit assurance.
- No mappings is shown as no recorded coverage data—not as zero compliance.

## Page experience

The page starts with a compact three-step explanation:

1. Record one ISO-control-to-requirement mapping and its rationale.
2. Implement the ISO control in the SoA.
3. Reuse the recorded work: when any mapped control is mature, the recorded
   requirement is displayed as Covered.

Framework cards use neutral language such as “All 2 recorded requirements
covered” and retain a prominent denominator/disclaimer. The mapping table shows
source ISO control, target framework, published requirement reference,
rationale, and Covered/Not yet covered with an explanation of what changes the
status. Existing null notes render as a labelled legacy gap.

Owner and Admin see the guided add form and remove actions. Member sees the
same explanation, metrics, and mapping table read-only. The form requires a
source ISO control, target framework, published requirement reference, and the
organisation’s rationale/interpretation.

## Authorization and data flow

`manage_frameworks` is an explicit Owner/Admin capability. Both server actions
check it immediately after loading the app context and before rate limiting or
database access. Inserts derive organisation and actor from the trusted context.
Deletes parse a UUID, filter by both mapping ID and active organisation, request
the deleted ID, and fail closed when no row matches.

Existing RLS already restricts control-crosswalk mutations to operators and
tenant scope; database tests will make Member denial explicit without adding a
new migration.

## Testing

- Domain: mature-status coverage, distinct requirement denominator, and OR
  semantics reflected on every mapping row.
- Access/actions: explicit capability, Member rejection before writes, UUID
  parsing, tenant-scoped delete, duplicate handling, and no-match failure.
- Page: Member/operator controls, accessible labels/table, honest empty and 100%
  copy, Covered/Not yet covered explanations, and legacy null-note rendering.
- Database: explicit Member insert/delete denial while Owner mutation and tenant
  isolation remain covered.
