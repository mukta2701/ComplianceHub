# ComplianceHub Visual Product Design

**Date:** 2026-07-10

**Status:** Approved concept

**Audience:** UK-first software companies preparing for ISO 27001

## Product Direction

ComplianceHub should feel like a quiet operational workspace, not a compliance questionnaire. The interface must reduce uncertainty, make ownership visible, and move people from an unresolved decision to an approved record with as little typing as possible.

The core interaction model is:

`Summary -> prioritised queue -> contextual detail -> human decision -> next item`

Every operational page must answer five questions without requiring the user to remember guidance from another screen:

1. What needs my attention?
2. Why does it matter?
3. What does ComplianceHub already know?
4. What decision must I make?
5. What happens after I save?

This applies recognition over recall and progressive disclosure. Guidance appears beside the decision, while complete records and advanced fields appear only after selection. See [Recognition vs. Recall](https://www.nngroup.com/articles/recognition-and-recall/) and [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/).

## Information Architecture

The navigation is organised around user outcomes rather than database entities.

### Focus

- Overview
- Review inbox
- Readiness plan

### Prepare

- Assessment
- Risks
- Statement of Applicability
- Evidence

### Operate

- Policies
- Tasks
- Audits
- Performance

### Share and Admin

- Leadership report
- Trust Center
- Connections
- Settings

The first navigation group contains the product's decision surfaces. The remaining groups preserve the current GRC lifecycle and manual workflows.

## Shared Page Anatomy

Every operational page uses four layers:

1. **Heading:** outcome-oriented title, concise context, and one primary action.
2. **Outcome summary:** blockers, completion, missing ownership, and evidence health.
3. **Work queue:** searchable, filterable rows ordered by attention required.
4. **Detail surface:** a right-side panel on desktop and an inline section on mobile.

Avoid page-section cards, card walls, nested cards, and persistent forms for every record. Borders, spacing, typography, and row selection provide most of the hierarchy.

## Dashboard

The dashboard is a decision cockpit, not a collection of metrics.

### First viewport

- Greeting and a single `Start next action` command.
- Readiness confidence with the lifecycle: Scope -> Assess -> Treat -> Evidence -> Audit.
- A visible disclaimer that readiness is not a certification score.
- The four highest-priority decisions, ordered by blocker severity and due date.

### Supporting information

- What changed since the user's last visit.
- Readiness by outcome or control domain.
- Connector, evidence-freshness, and overdue-work signals.

Vanity metrics and completed work remain available in reports but do not compete with current decisions.

## Statement of Applicability

The current page renders all controls as complete forms. The replacement is a review workspace.

### Summary and filters

- Needs attention
- Reviewed
- Missing rationale
- Evidence gaps
- Unassigned
- Search
- Annex A domain
- Owner
- Applicability
- Implementation state
- Evidence freshness
- Only my controls

The default view is `Needs attention`, not all 93 controls.

### Control queue

Each row shows:

- Control code and title
- Domain
- Decision state
- Owner
- Evidence health
- A clear open affordance

### Detail surface

The selected control shows:

- Plain-English purpose
- Applicability
- Implementation state
- Named owner
- Decision rationale
- Evidence health and accepted records
- Linked risks and tasks
- Decision history
- Draft assistance, clearly labelled as draft-only

The primary action is `Save and next`. Finalisation runs deterministic preflight and links every blocker to the affected control. Applicability and exclusion rationales are never bulk-approved.

Drata and Vanta use searchable control lists, assignment, and focused control details rather than rendering every control as an expanded form. See [Drata control management](https://help.drata.com/en/articles/13380335-create-edit-and-manage-controls) and [Vanta Controls](https://help.vanta.com/en/articles/11345373-controls-page).

## Assessment

The assessment presents one decision at a time.

Each question includes:

- Why this matters
- What good enough looks like for a startup
- Explicit meanings for Yes, Partially, No, and Not applicable
- Evidence examples
- The consequence of the selected answer
- Saved-state feedback
- Save and continue, save and finish later, and previous actions

Section-level progress remains visible without exposing every question as a full form. Users can skip questions, and preflight keeps unanswered items visible.

## Automation Inbox

Automation is review-first. Every proposal includes:

- Plain-English finding
- Source system and resource
- Observation time
- Collector version
- Confidence and whether it is deterministic or AI-assisted
- Suggested control, assessment, risk, evidence, or task mappings
- What the signal does not prove
- Accept as evidence, use as draft, create task draft, dismiss, and recollect actions

AI explanations are visually distinct with the AI semantic colour. They never share the visual language of confirmed evidence.

## User Journey

### 1. Set up

The user defines scope, assigns area owners, and optionally connects systems. ComplianceHub prepares a collection plan and setup checklist.

### 2. Understand

The user reviews confirmed facts, needs-review signals, and information that was not detected. ComplianceHub prepares evidence suggestions and gap drafts.

### 3. Decide

The user completes risk treatment and SoA decisions from focused queues. ComplianceHub prepares rationales and remediation drafts.

### 4. Operate

The user reviews changes, stale evidence, and overdue work. ComplianceHub prepares refresh proposals and task drafts.

### 5. Prove

The user runs audit preflight and resolves blockers. ComplianceHub prepares an evidence index and auditor notes.

## Colour System

The palette is neutral-dominant. Colour communicates state and action, not decoration.

| Token | Value | Purpose |
|---|---:|---|
| `--ch-ink` | `#171C26` | Primary text and decisive labels |
| `--ch-text-secondary` | `#4B5565` | Supporting copy and metadata |
| `--ch-primary` | `#2557D6` | Primary commands and selected state |
| `--ch-confirmed` | `#0F766E` | Accepted evidence and completed progress |
| `--ch-attention` | `#A15C00` | Review, expiry, and uncertainty |
| `--ch-risk` | `#B4233C` | Blocking gaps and overdue work |
| `--ch-ai` | `#6D4AFF` | AI-generated draft assistance only |
| `--ch-canvas` | `#F6F7F9` | Application background |
| `--ch-border` | `#E3E7ED` | Dividers and structure |

Tinted surfaces use approximately 8-14 percent of the semantic colour mixed into white. Statuses always combine colour with an icon and text label. Normal text targets at least 4.5:1 contrast, and controls, focus indicators, and meaningful graphical objects target at least 3:1. See [USWDS colour guidance](https://designsystem.digital.gov/design-tokens/color/overview/) and [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

## Typography

- Page title: 28px/34px, weight 500
- Section title: 16px/24px, weight 500
- Body and controls: 14px/21px, weight 400 or 500
- Metadata: 12px/18px, weight 400 or 500
- Sentence case throughout
- Letter spacing: 0
- No viewport-scaled type

Each page uses no more than three prominent text levels. Long control names wrap instead of shrinking below the body-text minimum.

## Spacing and Density

- Base grid: 4px
- Icon gap: 4px
- Control gap: 8px
- Row padding: 12px
- Section rhythm: 16px
- Page group: 24px
- Major separation: 32px
- Operational row target: 44-52px desktop
- Card radius: no more than 8px
- Shadows: reserved for overlays and drawers

## Components

### Actions

- One cobalt primary action per region
- Neutral secondary actions
- Ghost treatment for low-emphasis commands
- Lucide icons for familiar actions
- Icon-only controls require accessible names and tooltips where meaning is not obvious

### Status labels

- Icon + text + semantic tint
- Never rely on colour alone
- Use operational language: Confirmed, Needs review, Blocking, Draft
- Avoid ambiguous labels such as Good, Bad, or Complete without context

### Inputs

- Persistent labels
- Plain-English help before validation errors
- 44px minimum interactive target where practical
- Visible keyboard focus
- Autosave state must distinguish Saving, Saved, Conflict, and Failed

### Drawers and detail surfaces

- Desktop: right-side split panel or drawer
- Mobile: inline after the selected row or a full-screen route
- Tabs: Decision, Evidence, Linked work, History
- Preserve selected filters and scroll position when closed

## Responsive Behaviour

### Desktop

- Persistent sidebar
- Queue and detail shown together
- Dense rows and multi-column filters

### Tablet

- Narrow sidebar or collapsible navigation
- Nonessential queue columns hidden
- Detail panel remains visible when space permits

### Mobile

- Top navigation summary
- Controls stack without horizontal scrolling
- Queue rows show control, state, and open affordance
- Detail appears below selection or on a dedicated route
- Tables become labelled stacked rows

## Accessibility and Quality Gates

- WCAG 2.2 AA contrast and focus requirements
- Keyboard access to queues, drawers, tabs, filters, and save-and-next
- Screen-reader announcements for save states and changed proposal details
- No status conveyed only through colour
- No horizontal page overflow at 320px
- Reduced-motion support
- Axe coverage for each redesigned route
- Playwright screenshots at 1440px, 768px, and 390px

## Validation Plan

Test the current and redesigned SoA with 5-7 target users. Give each participant the same tasks:

1. Find controls missing a rationale.
2. Decide whether A.5.23 applies.
3. Link evidence to a control.
4. Assign an owner.
5. Identify what blocks finalisation.

Measure time per task, errors, abandonment, unresolved blockers found, perceived confidence, and perceived workload. The redesigned workspace should reduce time and errors without increasing unjustified exclusions or accidental status changes.
