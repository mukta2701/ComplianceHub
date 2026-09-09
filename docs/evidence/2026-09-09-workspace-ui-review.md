# Independent UI reviews — 9 September 2026

Fixed point: `c4b2d2434593189ff68b46bd7f7e34784f00efdf`. Review scope: tracked working diff plus new shell/Settings modules and browser acceptance against [the specification](../superpowers/specs/2026-09-09-workspace-ui.md). The reviewers did not author the implementation. Matt Pocock code-review was applied on its two independent axes; implementation and TDD used the existing component/browser seams.

## Standards

Initial independent review found two documented-standard problems: faint Settings input focus rings, and controls smaller than the existing 14px standard. Both were corrected with opaque focus outlines and consistent control typography. The twelve baseline code-smell heuristics found no additional material issue. Narrow source recheck confirms the fixes. Final narrow review caught one mismatched heat-map legend selector; it was corrected from `.heatmap-legend` to the actual `.heat-legend`. No other material standards findings remained.

## Specification

Initial independent review found two P2 gaps in modal isolation: live monitoring notifications remained interactive outside the drawer, and the workspace-setup state had no initial focus target. Both were reproduced with focused tests, fixed and independently rechecked. Subsequent source review accepted the framework-aware history integration and corrected drawer visibility/focus behavior. Final functional source recheck found no remaining defects. It requested broader accessibility evidence beyond Settings; scans were added for the open drawer and representative routes before final acceptance.

## Visual review

Independent inspection compared old Settings/Tasks with actual production Settings at tablet/mobile sizes, the mobile editor, desktop Tasks and mobile Dashboard/Risks/Evidence/Policies. No material visual issue remained. Table scrolling is intentional. The editor screenshot alone does not show the whole save operation; saved editing is established separately by the passing browser journey.

Resolved findings are retained here rather than removed from the historical record. Full verification and local-only limits are in [the evidence](2026-09-09-workspace-ui.md).
