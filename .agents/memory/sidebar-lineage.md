# Sidebar Session Lineage

## 2026-09-01

- Sidebar Lineage is native session-file ancestry from `SessionInfo.parentSessionId`, not dependency-DAG edges or in-file message branches. It derives from the complete available session listing, independent of the currently selected project/worktree.
- The authoritative family starts at the selected session's oldest reachable listed ancestor and includes every listed descendant from that boundary, including siblings and cousins. A missing parent truncates authority; Pi Web never guesses beyond the listing.
- Malformed parent cycles use the existing cycle-detached rendered forest. Membership retains the complete connected family, but selected-path reveal follows only the final rendered forest path so a detached cycle root remains unrelated and keeps its manual collapse state.
- Global explicit/inherited hidden closure is computed before Lineage presentation. Normal mode omits hidden subtrees and explains a hidden selected session; Show hidden restores and labels the family. Unlisted or transient selections remain a bounded unavailable state until ordinary discovery succeeds.
- Lineage and Project share depth-first rows, continuous ancestor lines, child elbows, row actions, and sibling-subtree ordering by newest visible descendant activity with own-activity and ID tie-breaks. Lineage adds compact visible context only across project/worktree boundaries while preserving full context in every tooltip and accessible name.
- Sidebar order is Pinned, Recent, Lineage, Project, Explorer. Lineage starts expanded and Project starts collapsed. Each tree owns separate reload-local section, collapsed-ID, and retained scroll state; no preference, schema, or server endpoint was added.
- Selection changes and every explicit row activation—including reopening the same selected session—remove only the rendered Lineage ancestor path from Lineage collapse state and adjust only its scroll owner. Reveal never calls focus. Project receives selected styling only and never auto-expands or scrolls.
- Project's open-section sizing accounts for its fixed project/worktree controls so both actual tree scroll owners remain usable at short mobile heights. Mobile tree indentation compresses without dropping connector levels or introducing horizontal sidebar overflow.

References: `.agents/plans/2026-08-31-session-lineage-sidebar.md`, `lib/sidebar-session-state.ts`, `components/SessionSidebar.tsx`, and `.agents/reports/2026-08-31-session-lineage-sidebar-browser-validation.md`.
