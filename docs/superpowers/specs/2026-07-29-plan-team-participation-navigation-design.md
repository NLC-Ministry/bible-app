# Plan Team Participation Navigation Design

## Problem

The Bible app's team reading feature is hard to discover because team actions are scattered across different surfaces:

- The plan list has a low-emphasis `加入團隊` pill that behaves like a filter but launches an action workflow.
- Joining a plan opens a separate mode dialog for solo, 3-person team, or 6-person team participation.
- Creating a team is available later inside plan detail/team UI.
- Team statistics and rankings live under plan detail tabs, but the path from "I want to read with a team" to those tabs is indirect.

Users do not get a clear mental model that a team is temporary and exists only for a specific reading plan period.

## Goals

- Make team reading discoverable from the plan area without implying teams are independent of plans.
- Treat solo reading and team reading as equal, valid participation modes.
- Keep invite-code joining fast because an invite code already identifies the target team and plan.
- Consolidate team creation, invite-code joining, team status, roster, and ranking into a coherent plan-centered flow.
- Preserve the existing app structure: `計畫` remains the primary navigation area for reading plans and plan-based teams.

## Non-Goals

- Do not add a top-level global `團隊` app tab.
- Do not make teams persist independently across plan periods.
- Do not change the backend team model or invite-code contract.
- Do not redesign unrelated Bible reader, profile, admin, or organization statistics flows.

## UX Principles

- **Contextual grouping:** team actions should live inside or directly beside the relevant plan period.
- **Recognition over recall:** users should see obvious actions such as `有邀請碼？加入團隊`, `自己加入`, and `建立團隊` instead of remembering hidden locations.
- **Task-based navigation:** navigation should match the user's jobs: continue a plan, join a plan alone, join a team by code, create a team, view my team.
- **Progressive disclosure:** plan cards show the next likely action; plan detail shows deeper team state, roster, and rankings after the user enters a plan.
- **Clear state:** every active plan should communicate whether the user is solo, in a 3-person team, in a 6-person team, or in both team divisions.

## Proposed Navigation Model

`計畫` remains the feature home.

At the top of the plan list, add a prominent shortcut:

`有邀請碼？加入團隊`

This opens the invite-code flow directly. Because the invite code identifies the team and plan, the user does not need to pick a plan first. After a successful join, the app routes the user into the matched plan detail and shows the team state for that plan.

Below the shortcut, the list is organized around plan participation:

- `我的計畫`
- `探索計畫`
- `已結束`

The old `加入團隊` list pill is removed as a primary list filter because it is an action, not a plan status.

## My Plans States

Each joined plan card should show the user's participation state.

For a solo plan:

- Status: `個人讀經中`
- Primary action: `繼續讀經`
- Secondary action: `建立 / 加入團隊`

For a team plan:

- Status: `團隊讀經中`
- Show team name, division, and member count when available.
- Primary action: `查看團隊`
- Secondary action: `繼續讀經`

For a user in both 3-person and 6-person teams for the same plan:

- Show both division statuses compactly.
- `查看團隊` opens the team surface with a division switcher.

## Explore Plans States

Available plan cards expose clear participation choices:

- `查看詳情`
- `自己加入`
- `建立團隊`

If the user chooses `自己加入`, the app joins the plan and routes to plan detail/progress.

If the user chooses `建立團隊`, the app joins the plan internally first when needed, then opens team creation. The user-facing flow should feel direct: the user chose to create a team for that plan.

The existing plan details preview can remain, but its call-to-action area should use the same participation language instead of presenting team as an afterthought.

## Plan Detail

For plans that support team participation, the primary plan detail tabs should be:

- `進度`
- `個人統計`
- `團隊`
- `排名`

The `團隊` tab replaces the current team-related statistics wording for team-enabled plans because the surface is broader than statistics. It may include:

- Current team status
- Team roster
- Invite code
- Create team
- Join another division
- Leave/disband actions when allowed

For non-team plans, the existing organization/group statistics language can remain.

Team actions in plan detail should always mention the plan context, for example:

- `加入此計畫團隊`
- `建立此計畫團隊`
- `本期團隊`

## Invite-Code Flow

The invite-code shortcut is globally reachable within `計畫`.

Flow:

1. User taps `有邀請碼？加入團隊`.
2. User enters invite code.
3. App resolves team and plan from the code.
4. If the user has not joined the plan yet, the app joins the matched plan with the current default schedule behavior.
5. App joins the team.
6. App routes to the matched plan detail and opens the team surface.
7. The success state names the plan and team.

Errors should remain specific:

- Invalid code
- Team full
- Already in this division
- Formal login required
- Team feature unavailable

## Data Flow

This design uses existing contracts:

- `joinTeamGlobally(inviteCode)` resolves the plan by trying candidate plans.
- `db.joinReadingTeam(plan, code)` joins by invite code.
- `db.joinPresetPlan(...)` can be used when the invite code points to a plan the user has not joined.
- `db.getMyReadingTeam(plan)` provides current team context.
- `window.renderMyReadingTeamInline(...)` and `window.renderReadingTeamRegistrationInline(...)` remain the rendering foundation for team detail.

Implementation should consolidate UI entry points around these existing data functions rather than introducing a new team domain model.

## Error Handling

- If invite-code join succeeds but plan auto-join fails, show a specific message and keep the user on the invite-code surface.
- If plan join succeeds but team join fails, keep the user in the matched plan context and show the team error with a retry affordance.
- If the user is already in one division, show the remaining available division rather than blocking all team actions.
- If the user is in both divisions, team creation is hidden and team viewing becomes the primary action.

## Testing

Add focused Vitest/source-structure tests around:

- The plan list no longer exposes `加入團隊` as a status pill.
- The plan list includes a prominent invite-code entry point.
- Joined plan cards can represent solo, team, and both-division states.
- Explore plan cards expose solo and team participation actions.
- Invite-code success routes to `plan-view` with the matched plan detail/team surface.
- Team-enabled plan detail can label the third primary tab as `團隊`.

Manual verification should cover mobile and desktop:

- A new user joins a plan alone.
- A new user creates a team from an available plan.
- A user joins by invite code without first joining the plan.
- A user already in a 3-person team joins or creates a 6-person team.
- A user in both divisions sees both team states without layout overflow.

## Open Decisions

No unresolved product decisions remain for this design. The approved direction is plan-centered team participation with a global invite-code shortcut inside `計畫`.
