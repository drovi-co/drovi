// =============================================================================
// ROUND-ROBIN ASSIGNMENT SERVICE
// =============================================================================
//
// Service for intelligent workload distribution in shared inboxes.
// Implements round-robin, load-balanced, and skills-based assignment algorithms.
//

import { db } from "@memorystack/db";
import {
  assignmentHistory,
  conversationAssignment,
  sharedInbox,
  sharedInboxMember,
} from "@memorystack/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";

// =============================================================================
// TYPES
// =============================================================================

export interface AssignmentCandidate {
  userId: string;
  memberId: string;
  currentAssignments: number;
  maxAssignments: number;
  availability: string;
  roundRobinPosition: number;
  skillLevels?: Record<string, number>;
}

export interface AssignmentResult {
  success: boolean;
  assignedToUserId?: string;
  reason: string;
  algorithm: "round_robin" | "load_balanced" | "skills_based" | "manual_only";
}

// =============================================================================
// ASSIGNMENT ALGORITHMS
// =============================================================================

/**
 * Get eligible members for assignment.
 * Filters by availability and capacity.
 */
export async function getEligibleMembers(
  sharedInboxId: string,
  skipAway: boolean = true
): Promise<AssignmentCandidate[]> {
  const members = await db.query.sharedInboxMember.findMany({
    where: and(
      eq(sharedInboxMember.sharedInboxId, sharedInboxId),
      eq(sharedInboxMember.isActive, true)
    ),
    orderBy: [asc(sharedInboxMember.roundRobinPosition)],
  });

  const eligibleMembers: AssignmentCandidate[] = [];

  // Default max assignments if not set on member
  const DEFAULT_MAX_ASSIGNMENTS = 10;

  for (const m of members) {
    // Skip unavailable members if configured
    if (skipAway && (m.availability === "away" || m.availability === "offline")) {
      continue;
    }

    const maxAssignments = m.maxAssignments ?? DEFAULT_MAX_ASSIGNMENTS;

    // Skip members at capacity
    if (m.currentAssignments >= maxAssignments) {
      continue;
    }

    eligibleMembers.push({
      userId: m.userId,
      memberId: m.id,
      currentAssignments: m.currentAssignments,
      maxAssignments,
      availability: m.availability,
      roundRobinPosition: m.roundRobinPosition,
      skillLevels: m.skillLevels as Record<string, number> | undefined,
    });
  }

  return eligibleMembers;
}

/**
 * Round-robin assignment: Assign to the member with lowest position,
 * then move them to end of queue.
 */
export async function roundRobinAssign(
  sharedInboxId: string,
  skipAway: boolean = true
): Promise<AssignmentResult> {
  const candidates = await getEligibleMembers(sharedInboxId, skipAway);

  if (candidates.length === 0) {
    return {
      success: false,
      reason: "No eligible members available for assignment",
      algorithm: "round_robin",
    };
  }

  // First eligible member (lowest position)
  const selected = candidates[0];
  if (!selected) {
    return {
      success: false,
      reason: "No eligible member found",
      algorithm: "round_robin",
    };
  }

  // Move selected member to end of queue
  const maxPosition = Math.max(...candidates.map((c) => c.roundRobinPosition));
  await db
    .update(sharedInboxMember)
    .set({
      roundRobinPosition: maxPosition + 1,
      currentAssignments: selected.currentAssignments + 1,
      updatedAt: new Date(),
    })
    .where(eq(sharedInboxMember.id, selected.memberId));

  return {
    success: true,
    assignedToUserId: selected.userId,
    reason: `Assigned via round-robin (position ${selected.roundRobinPosition})`,
    algorithm: "round_robin",
  };
}

/**
 * Load-balanced assignment: Assign to member with lowest current workload.
 */
export async function loadBalancedAssign(
  sharedInboxId: string,
  skipAway: boolean = true
): Promise<AssignmentResult> {
  const candidates = await getEligibleMembers(sharedInboxId, skipAway);

  if (candidates.length === 0) {
    return {
      success: false,
      reason: "No eligible members available for assignment",
      algorithm: "load_balanced",
    };
  }

  // Sort by workload ratio (current / max)
  const sorted = candidates.sort((a, b) => {
    const ratioA = a.currentAssignments / a.maxAssignments;
    const ratioB = b.currentAssignments / b.maxAssignments;
    return ratioA - ratioB;
  });

  const selected = sorted[0];
  if (!selected) {
    return {
      success: false,
      reason: "No eligible member found",
      algorithm: "load_balanced",
    };
  }

  // Update workload
  await db
    .update(sharedInboxMember)
    .set({
      currentAssignments: selected.currentAssignments + 1,
      updatedAt: new Date(),
    })
    .where(eq(sharedInboxMember.id, selected.memberId));

  return {
    success: true,
    assignedToUserId: selected.userId,
    reason: `Assigned via load balancing (workload: ${selected.currentAssignments}/${selected.maxAssignments})`,
    algorithm: "load_balanced",
  };
}

/**
 * Skills-based assignment: Match skills to conversation tags/categories.
 * Falls back to load-balanced if no skill match.
 */
export async function skillsBasedAssign(
  sharedInboxId: string,
  requiredSkills: string[] = [],
  skipAway: boolean = true
): Promise<AssignmentResult> {
  const candidates = await getEligibleMembers(sharedInboxId, skipAway);

  if (candidates.length === 0) {
    return {
      success: false,
      reason: "No eligible members available for assignment",
      algorithm: "skills_based",
    };
  }

  // If no skills required, fall back to load balanced
  if (requiredSkills.length === 0) {
    return loadBalancedAssign(sharedInboxId, skipAway);
  }

  // Score candidates by skill match
  const scoredCandidates = candidates.map((c) => {
    let skillScore = 0;
    if (c.skillLevels) {
      for (const skill of requiredSkills) {
        skillScore += c.skillLevels[skill] ?? 0;
      }
    }
    // Combine skill score with capacity (lower workload = better)
    const workloadRatio = c.currentAssignments / c.maxAssignments;
    const combinedScore = skillScore * 100 - workloadRatio * 10;
    return { ...c, combinedScore };
  });

  // Sort by combined score (highest first)
  scoredCandidates.sort((a, b) => b.combinedScore - a.combinedScore);

  const selected = scoredCandidates[0];
  if (!selected) {
    return {
      success: false,
      reason: "No eligible member found",
      algorithm: "skills_based",
    };
  }

  // Update workload
  await db
    .update(sharedInboxMember)
    .set({
      currentAssignments: selected.currentAssignments + 1,
      updatedAt: new Date(),
    })
    .where(eq(sharedInboxMember.id, selected.memberId));

  return {
    success: true,
    assignedToUserId: selected.userId,
    reason: `Assigned via skills matching (score: ${selected.combinedScore.toFixed(1)})`,
    algorithm: "skills_based",
  };
}

// =============================================================================
// MAIN ASSIGNMENT FUNCTION
// =============================================================================

/**
 * Assign a conversation to a member using the inbox's configured algorithm.
 */
export async function assignConversation(
  sharedInboxId: string,
  conversationId: string,
  performedByUserId: string,
  requiredSkills: string[] = []
): Promise<AssignmentResult> {
  // Get inbox configuration
  const inbox = await db.query.sharedInbox.findFirst({
    where: eq(sharedInbox.id, sharedInboxId),
  });

  if (!inbox) {
    return {
      success: false,
      reason: "Shared inbox not found",
      algorithm: "round_robin",
    };
  }

  // If auto-assign is disabled, return manual-only
  if (!inbox.autoAssignEnabled) {
    return {
      success: false,
      reason: "Auto-assignment is disabled for this inbox",
      algorithm: "manual_only",
    };
  }

  // Select algorithm based on inbox configuration
  let result: AssignmentResult;
  switch (inbox.assignmentMethod) {
    case "round_robin":
      result = await roundRobinAssign(sharedInboxId, inbox.skipAwayMembers);
      break;
    case "load_balanced":
      result = await loadBalancedAssign(sharedInboxId, inbox.skipAwayMembers);
      break;
    case "skills_based":
      result = await skillsBasedAssign(
        sharedInboxId,
        requiredSkills,
        inbox.skipAwayMembers
      );
      break;
    case "manual_only":
      return {
        success: false,
        reason: "Manual-only assignment configured",
        algorithm: "manual_only",
      };
    default:
      result = await roundRobinAssign(sharedInboxId, inbox.skipAwayMembers);
  }

  // Create or update assignment record
  if (result.success && result.assignedToUserId) {
    const existing = await db.query.conversationAssignment.findFirst({
      where: and(
        eq(conversationAssignment.sharedInboxId, sharedInboxId),
        eq(conversationAssignment.conversationId, conversationId)
      ),
    });

    if (existing) {
      // Update existing assignment
      await db
        .update(conversationAssignment)
        .set({
          assigneeUserId: result.assignedToUserId,
          assignedBy: performedByUserId,
          assignedAt: new Date(),
          status: "assigned",
          updatedAt: new Date(),
        })
        .where(eq(conversationAssignment.id, existing.id));

      // Log history
      await logAssignment(
        existing.id,
        "reassigned",
        performedByUserId,
        existing.assigneeUserId,
        result.assignedToUserId,
        result.reason
      );
    } else {
      // Create new assignment
      const [assignment] = await db
        .insert(conversationAssignment)
        .values({
          sharedInboxId,
          conversationId,
          assigneeUserId: result.assignedToUserId,
          assignedBy: performedByUserId,
          assignedAt: new Date(),
          status: "assigned",
        })
        .returning();

      if (assignment) {
        await logAssignment(
          assignment.id,
          "assigned",
          performedByUserId,
          null,
          result.assignedToUserId,
          result.reason
        );
      }
    }
  }

  return result;
}

/**
 * Release an assignment (puts item back in queue).
 */
export async function releaseAssignment(
  assignmentId: string,
  performedByUserId: string,
  reason?: string
): Promise<{ success: boolean; reason: string }> {
  const assignment = await db.query.conversationAssignment.findFirst({
    where: eq(conversationAssignment.id, assignmentId),
  });

  if (!assignment) {
    return { success: false, reason: "Assignment not found" };
  }

  const previousAssignee = assignment.assigneeUserId;

  // Update assignment
  await db
    .update(conversationAssignment)
    .set({
      assigneeUserId: null,
      status: "unassigned",
      updatedAt: new Date(),
    })
    .where(eq(conversationAssignment.id, assignmentId));

  // Decrease workload for previous assignee
  if (previousAssignee) {
    await db
      .update(sharedInboxMember)
      .set({
        currentAssignments: sql`GREATEST(${sharedInboxMember.currentAssignments} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sharedInboxMember.sharedInboxId, assignment.sharedInboxId),
          eq(sharedInboxMember.userId, previousAssignee)
        )
      );
  }

  // Log history
  await logAssignment(
    assignmentId,
    "released",
    performedByUserId,
    previousAssignee,
    null,
    reason ?? "Released back to queue"
  );

  return { success: true, reason: "Assignment released" };
}

/**
 * Claim an unassigned conversation.
 */
export async function claimAssignment(
  sharedInboxId: string,
  conversationId: string,
  claimingUserId: string
): Promise<{ success: boolean; reason: string; assignmentId?: string }> {
  // Verify user is a member
  const member = await db.query.sharedInboxMember.findFirst({
    where: and(
      eq(sharedInboxMember.sharedInboxId, sharedInboxId),
      eq(sharedInboxMember.userId, claimingUserId),
      eq(sharedInboxMember.isActive, true)
    ),
  });

  if (!member) {
    return { success: false, reason: "User is not a member of this shared inbox" };
  }

  // Check capacity
  const memberMaxAssignments = member.maxAssignments ?? 10;
  if (member.currentAssignments >= memberMaxAssignments) {
    return {
      success: false,
      reason: `You have reached your maximum concurrent assignments (${memberMaxAssignments})`,
    };
  }

  // Check for existing assignment
  let assignment = await db.query.conversationAssignment.findFirst({
    where: and(
      eq(conversationAssignment.sharedInboxId, sharedInboxId),
      eq(conversationAssignment.conversationId, conversationId)
    ),
  });

  if (assignment?.assigneeUserId) {
    return { success: false, reason: "Conversation is already assigned" };
  }

  // Create or update assignment
  if (assignment) {
    await db
      .update(conversationAssignment)
      .set({
        assigneeUserId: claimingUserId,
        claimedBy: claimingUserId,
        claimedAt: new Date(),
        status: "assigned",
        updatedAt: new Date(),
      })
      .where(eq(conversationAssignment.id, assignment.id));
  } else {
    const [newAssignment] = await db
      .insert(conversationAssignment)
      .values({
        sharedInboxId,
        conversationId,
        assigneeUserId: claimingUserId,
        claimedBy: claimingUserId,
        claimedAt: new Date(),
        status: "assigned",
      })
      .returning();
    assignment = newAssignment;
  }

  // Update workload
  await db
    .update(sharedInboxMember)
    .set({
      currentAssignments: member.currentAssignments + 1,
      updatedAt: new Date(),
    })
    .where(eq(sharedInboxMember.id, member.id));

  // Log history
  if (assignment) {
    await logAssignment(
      assignment.id,
      "claimed",
      claimingUserId,
      null,
      claimingUserId,
      "Self-claimed"
    );
  }

  return {
    success: true,
    reason: "Conversation claimed successfully",
    assignmentId: assignment?.id,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function logAssignment(
  assignmentId: string,
  action: string,
  performedBy: string,
  fromUserId: string | null,
  toUserId: string | null,
  reason: string | null
): Promise<void> {
  await db.insert(assignmentHistory).values({
    conversationAssignmentId: assignmentId,
    action: action as
      | "assigned"
      | "reassigned"
      | "claimed"
      | "released"
      | "escalated"
      | "resolved"
      | "reopened",
    performedBy,
    fromUserId,
    toUserId,
    reason,
  });
}

/**
 * Rebalance workload across members (admin utility).
 * Moves excess assignments from overloaded members to underloaded ones.
 */
export async function rebalanceWorkload(
  sharedInboxId: string,
  performedByUserId: string
): Promise<{ rebalanced: number }> {
  const members = await db.query.sharedInboxMember.findMany({
    where: and(
      eq(sharedInboxMember.sharedInboxId, sharedInboxId),
      eq(sharedInboxMember.isActive, true)
    ),
  });

  // Default max if not set
  const getMaxAssignments = (m: (typeof members)[number]) => m.maxAssignments ?? 10;

  // Find overloaded and underloaded members
  const overloaded = members.filter(
    (m) => m.currentAssignments > getMaxAssignments(m)
  );
  const underloaded = members.filter(
    (m) => m.currentAssignments < getMaxAssignments(m)
  );

  let rebalanced = 0;

  // Simple rebalancing - move excess from overloaded to underloaded
  for (const over of overloaded) {
    const excess = over.currentAssignments - getMaxAssignments(over);

    // Get assignments for this member
    const assignments = await db.query.conversationAssignment.findMany({
      where: and(
        eq(conversationAssignment.sharedInboxId, sharedInboxId),
        eq(conversationAssignment.assigneeUserId, over.userId),
        eq(conversationAssignment.status, "assigned")
      ),
      limit: excess,
    });

    for (const assignment of assignments) {
      // Find an underloaded member
      const target = underloaded.find(
        (u) => u.currentAssignments < getMaxAssignments(u)
      );

      if (!target) break;

      // Reassign
      await db
        .update(conversationAssignment)
        .set({
          assigneeUserId: target.userId,
          assignedBy: performedByUserId,
          assignedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(conversationAssignment.id, assignment.id));

      // Update workload counts
      over.currentAssignments--;
      target.currentAssignments++;
      rebalanced++;

      // Log
      await logAssignment(
        assignment.id,
        "reassigned",
        performedByUserId,
        over.userId,
        target.userId,
        "Workload rebalancing"
      );
    }
  }

  // Update member workload counts in DB
  for (const m of members) {
    await db
      .update(sharedInboxMember)
      .set({
        currentAssignments: m.currentAssignments,
        updatedAt: new Date(),
      })
      .where(eq(sharedInboxMember.id, m.id));
  }

  return { rebalanced };
}
