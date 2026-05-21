# Zuti UX Execution Blueprint

## Objective
Turn Zuti into an AI-assisted Resolution Operating System with one primary operating flow:

Intake -> Triage -> Resolve -> Learn -> Optimize.

This blueprint translates the product audit into implementation-ready structure.

## V1 Simplicity Guardrails
1. Keep language literal and obvious (use "Escalations" instead of abstract labels).
2. Prefer 1 clear path per task over feature-rich branching.
3. Avoid introducing advanced controls unless they are required to resolve customer issues.
4. Favor defaults over configuration in V1.
5. Every screen should answer: "What should I do next?"
6. If a feature adds cognitive load but not daily operational value, defer it.

## 1) Information Architecture (Target)

### Primary Nav Groups
1. Operations
   - Inbox
   - Resolution Center
2. Intelligence
   - Knowledge
   - AI Quality
3. Configure
   - Bots & Channels
   - Team
   - Settings
4. Monitor
   - Analytics
   - Activity

### IA Decisions
1. Merge Team Chat and Knowledge Gaps into Resolution Center tabs:
   - Escalations
   - Team Chat
   - Knowledge Gaps
2. Keep Knowledge as source/training workspace (ingestion + suggestion review).
3. Keep Activity as audit timeline.
4. Keep Analytics as management cockpit, but add action-focused insights.
5. V1 naming should use "Escalations" in navigation for clarity.

### Route Plan
1. Keep existing routes for backward compatibility.
2. Add new route:
   - /resolution
3. Redirect from /team-chat and /knowledge-gaps to /resolution with tab query params after migration period.

## 2) Page-by-Page UX Spec

## A. Inbox (Primary Operating Surface)

Current file: apps/web/app/(dashboard)/inbox/page.tsx

### Goals
1. Increase triage speed.
2. Reduce context switching.
3. Make AI confidence explicit and actionable.

### New UX Blocks
1. Queue Modes (top):
   - New
   - Waiting on Customer
   - Escalated
   - Assigned to Me
   - High Risk AI
2. AI Decision Panel (inside conversation):
   - Why answered
   - Why escalated
   - Confidence + answerability with plain-language explanation
   - Knowledge sources used
3. Agent Presence Guard:
   - "Anna is typing" / "Mark is viewing" to reduce duplicate replies.
4. Sticky Customer Timeline Card:
   - Last 3 interactions
   - Channel history
   - Prior escalations

### Key Actions
1. One-click assign/unassign.
2. One-click escalate to Resolution Center.
3. One-click resolve + reason.
4. Snooze with explicit return time.

### Keyboard Targets
1. J/K next/previous conversation.
2. R reply focus.
3. A assign.
4. E escalate.
5. Cmd/Ctrl+Enter send.
6. Shift+N internal note mode.

## B. Resolution Center (New)

New route: /resolution
Source files to merge concepts from:
- apps/web/app/(dashboard)/team-chat/page.tsx
- apps/web/app/(dashboard)/knowledge-gaps/page.tsx

### Tabs
1. Escalations
2. Team Chat
3. Knowledge Gaps

### Escalations Tab
1. Thread owner
2. SLA due time
3. Priority (P1-P4)
4. Status transitions with reason:
   - Open
   - Answered
   - Resolved
   - Duplicate
5. Suggested knowledge extraction action after reply

### Team Chat Tab
1. Keep internal communication, but show linked escalation/thread chips.
2. Add quick jump to related customer conversation.

### Knowledge Gaps Tab
1. Keep status controls.
2. Add "promote to suggestion draft" CTA.
3. Add trend signal (seen count delta in last 7 days).

## C. Knowledge Workspace

Current file: apps/web/app/(dashboard)/knowledge/page.tsx

### Keep
1. URL/Text ingestion.
2. Suggestion review + edit workflow.

### Add
1. Source quality indicator per item (freshness + usage in answers).
2. Suggestion rationale block:
   - originating thread
   - business impact estimate
3. Bulk actions:
   - approve selected
   - reject selected

## D. Analytics (Decision Support)

Current file: apps/web/app/(dashboard)/analytics/page.tsx

### Keep
1. Core volume and status metrics.
2. AI usage tokens and calls.

### Add Action Insights
1. "Top 5 escalation drivers" (topics/channels/teams).
2. "AI uncertainty hotspots" with deep links to Resolution Center.
3. "Knowledge impact" metrics:
   - suggestions approved
   - deflection uplift after approval
4. Role-based default dashboards:
   - Owner: business outcomes
   - Admin: operations health
   - Agent: personal throughput and queue quality

## E. Bots & Channels

Current file: apps/web/app/(dashboard)/bots/page.tsx

### Keep
1. Multi-channel setup.
2. Widget snippets.
3. AI prompt + routing controls.

### Add
1. Channel health state:
   - connected
   - degraded
   - disconnected
2. Last successful message timestamp per channel.
3. Test channel action (send synthetic ping).
4. Safe config history (last modified by + timestamp).

## F. Team

Current file: apps/web/app/(dashboard)/team/page.tsx

### Keep
1. Invite and role updates.
2. Agent specialization and availability.

### Add
1. Workload view:
   - assigned open conversations
   - escalations owned
2. Capacity recommendations from AI.
3. Permission presets:
   - Agent Basic
   - Agent Advanced
   - Team Lead

## G. Onboarding

Current file: apps/web/app/(auth)/onboarding/page.tsx

### Replace Single-Step Onboarding With Activation Checklist
1. Create workspace
2. Connect one channel
3. Add one knowledge source
4. Run sample conversation
5. Confirm first successful AI reply

### Success Criteria
User should reach first value within 10 minutes.

## 3) UI System & Component Upgrades

## Global Tokens
Current base styles: apps/web/app/globals.css

### Introduce Design Tokens
1. Semantic colors:
   - success, warning, danger, info, neutral
2. State tokens:
   - interactive default, hover, active, disabled
3. Data density tokens:
   - compact, comfortable

### Accessibility Baselines
1. Body text minimum contrast >= 4.5:1.
2. Non-text UI indicators >= 3:1.
3. Visible keyboard focus for all actionable controls.

## Core Shared Components (Build Once, Reuse)
1. QueueToolbar
2. StatusChip (with semantic variants)
3. AIReasonCard
4. EscalationThreadCard
5. CustomerTimelineCard
6. CommandPalette
7. EmptyStateShell (contextual CTA)
8. LoadingSkeleton variants

## Interaction Principles
1. Show next best action in every operational view.
2. Avoid dead-end empty states.
3. Keep destructive actions two-step with explicit consequence text.

## 4) 6-Week Rollout Plan

Note: for V1, prioritize clarity and adoption over depth. Advanced enterprise controls can ship in a later phase.

## Week 1: IA and Foundations
1. Add nav grouping structure in sidebar.
2. Create /resolution route shell with tab architecture.
3. Introduce design tokens and shared status chip component.
4. Add event instrumentation for baseline metrics.

Deliverables:
1. Navigation v2 live behind feature flag.
2. Resolution Center shell accessible.
3. Baseline telemetry dashboards.

## Week 2: Inbox Productivity
1. Implement Queue Modes.
2. Add keyboard shortcuts.
3. Add sticky customer timeline block.
4. Add agent presence guard in conversation view.

Deliverables:
1. Inbox speed improvements in production.
2. Shortcut help modal.

## Week 3: Resolution Center Core
1. Port escalation threads into /resolution.
2. Add ownership + priority + SLA due fields.
3. Add deep links to/from Inbox.
4. Soft-deprecate standalone /team-chat and /knowledge-gaps nav visibility.

Deliverables:
1. End-to-end escalation flow in one surface.
2. Migration guide for current users.

## Week 4: AI Trust Layer
1. Build AI Decision Panel in Inbox.
2. Display source references used for answer.
3. Add escalation rationale labels.
4. Add feedback action: "AI answer was incorrect".

Deliverables:
1. Explainable AI visible in operator workflow.
2. Feedback captured for quality loop.

## Week 5: Intelligence and Analytics Actions
1. Add Knowledge impact metrics in Analytics.
2. Add top escalation drivers section.
3. Add AI uncertainty hotspot list with deep links.
4. Add bulk suggestion review actions in Knowledge.

Deliverables:
1. Analytics becomes action-oriented.
2. Faster knowledge operations.

## Week 6: Onboarding and Hardening
1. Launch checklist-based activation flow.
2. Add role-based default layouts.
3. Accessibility pass (focus, contrast, keyboard).
4. Mobile responder mode for Inbox.

Deliverables:
1. Activation flow v2 live.
2. Accessibility and mobile QA pass complete.
3. Rollout retrospective and KPI readout.

## 5) KPI Framework

## Activation KPIs
1. Time to first AI-resolved conversation (target: < 10 minutes from signup).
2. Onboarding checklist completion rate (target: > 65%).

## Operational KPIs
1. Median first response time (target: -20%).
2. Median handling time for escalated conversations (target: -15%).
3. Escalation ownership assignment latency (target: < 5 minutes).

## AI Trust KPIs
1. Agent override rate after AI answer (target: down over time).
2. AI explainability panel usage (target: > 40% weekly active agents view it).
3. Confirmed bad-answer feedback loop closure rate (target: > 80% reviewed within 7 days).

## Retention and Expansion KPIs
1. 4-week active workspace retention.
2. Weekly active agents per workspace.
3. Knowledge suggestion approval throughput.

## 6) Feature Flag Strategy

1. nav_v2_resolution_center
2. inbox_queue_modes
3. inbox_keyboard_shortcuts
4. ai_decision_panel
5. analytics_action_insights
6. onboarding_activation_checklist

Rollout:
1. Internal dogfood
2. 10% pilot workspaces
3. 50% ramp
4. 100% release

## 7) Implementation Notes For Current Codebase

## Immediate Refactor Targets
1. Sidebar grouping and labels:
   - apps/web/components/sidebar.tsx
2. Resolution route and migration redirects:
   - apps/web/app/(dashboard)/resolution/page.tsx (new)
   - apps/web/app/(dashboard)/team-chat/page.tsx
   - apps/web/app/(dashboard)/knowledge-gaps/page.tsx
3. Inbox UX upgrade surface:
   - apps/web/app/(dashboard)/inbox/page.tsx
4. Shared primitives location:
   - apps/web/components/

## Non-Goals For This Phase
1. Full visual redesign of landing/auth pages.
2. Rewriting backend domain models.
3. Building a complete permissions matrix UI.

## 8) Final Product Direction

Zuti should prioritize operational excellence over cosmetic novelty.

Primary strategy:
1. One operating surface for resolution work.
2. AI transparency where decisions are made.
3. Faster agent execution through keyboard and context persistence.
4. Clear activation path to first measurable value.

This sequence will improve trust, retention, and enterprise readiness while preserving the current momentum of shipped functionality.
