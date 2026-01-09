// =============================================================================
// COMMUNICATION ANALYTICS
// =============================================================================
//
// Calculate interaction frequency, responsiveness, and direction metrics.
//

import type {
  DirectionMetrics,
  FrequencyMetrics,
  ResponsivenessMetrics,
  ThreadContext,
  TimePeriod,
  TopicAssociation,
} from "../types";

// =============================================================================
// TIME PERIOD HELPERS
// =============================================================================

/**
 * Convert time period to milliseconds.
 */
function periodToMs(period: TimePeriod): number {
  const day = 24 * 60 * 60 * 1000;
  switch (period) {
    case "7d":
      return 7 * day;
    case "30d":
      return 30 * day;
    case "90d":
      return 90 * day;
    case "365d":
      return 365 * day;
    case "all":
      return Number.MAX_SAFE_INTEGER;
  }
}

/**
 * Filter threads by time period.
 */
function filterByPeriod(
  threads: ThreadContext[],
  period: TimePeriod
): ThreadContext[] {
  if (period === "all") {
    return threads;
  }

  const cutoff = new Date(Date.now() - periodToMs(period));
  return threads.filter((t) => t.lastMessageAt >= cutoff);
}

// =============================================================================
// FREQUENCY CALCULATION
// =============================================================================

/**
 * Calculate communication frequency metrics.
 */
export function calculateFrequency(
  threads: ThreadContext[],
  period: TimePeriod = "30d"
): FrequencyMetrics {
  const filtered = filterByPeriod(threads, period);

  const threadCount = filtered.length;
  const messageCount = filtered.reduce((sum, t) => sum + t.messageCount, 0);

  // Calculate per-month rates
  const periodDays =
    period === "all"
      ? calculateDaysSpan(threads)
      : periodToMs(period) / (24 * 60 * 60 * 1000);
  const months = periodDays / 30;

  const threadsPerMonth = months > 0 ? threadCount / months : 0;
  const messagesPerMonth = months > 0 ? messageCount / months : 0;

  // Calculate trend by comparing halves of the period
  const midpoint = new Date(Date.now() - periodToMs(period) / 2);
  const recentThreads = filtered.filter((t) => t.lastMessageAt >= midpoint);
  const olderThreads = filtered.filter((t) => t.lastMessageAt < midpoint);

  const recentRate = recentThreads.length;
  const olderRate = olderThreads.length;

  let trend: FrequencyMetrics["trend"] = "stable";
  let trendPercentage = 0;

  if (olderRate > 0) {
    trendPercentage = ((recentRate - olderRate) / olderRate) * 100;
    if (trendPercentage > 20) {
      trend = "increasing";
    } else if (trendPercentage < -20) {
      trend = "decreasing";
    }
  } else if (recentRate > 0) {
    trend = "increasing";
    trendPercentage = 100;
  }

  return {
    period,
    threadCount,
    messageCount,
    threadsPerMonth: Math.round(threadsPerMonth * 10) / 10,
    messagesPerMonth: Math.round(messagesPerMonth * 10) / 10,
    trend,
    trendPercentage: Math.round(trendPercentage),
  };
}

/**
 * Calculate days between first and last thread.
 */
function calculateDaysSpan(threads: ThreadContext[]): number {
  if (threads.length === 0) {
    return 0;
  }

  const dates = threads.map((t) => t.firstMessageAt.getTime());
  const earliest = Math.min(...dates);
  const latest = Math.max(...dates);

  return Math.max(1, (latest - earliest) / (24 * 60 * 60 * 1000));
}

// =============================================================================
// RESPONSIVENESS METRICS
// =============================================================================

/**
 * Calculate responsiveness metrics for a contact.
 */
export function calculateResponsiveness(
  threads: ThreadContext[],
  contactEmail: string,
  userEmail: string
): ResponsivenessMetrics {
  const responseTimes: number[] = [];
  let messagesRequiringResponse = 0;
  let messagesResponded = 0;

  for (const thread of threads) {
    const sortedMessages = [...thread.messages].sort((a, b) => {
      const aTime = a.sentAt?.getTime() ?? 0;
      const bTime = b.sentAt?.getTime() ?? 0;
      return aTime - bTime;
    });

    for (let i = 0; i < sortedMessages.length - 1; i++) {
      const current = sortedMessages[i];
      const next = sortedMessages[i + 1];

      if (!(current && next)) {
        continue;
      }

      // Check if user sent a message and contact responded
      if (
        current.fromEmail.toLowerCase() === userEmail.toLowerCase() &&
        next.fromEmail.toLowerCase() === contactEmail.toLowerCase()
      ) {
        messagesRequiringResponse++;

        if (current.sentAt && next.sentAt) {
          const responseTime =
            (next.sentAt.getTime() - current.sentAt.getTime()) / (60 * 1000); // minutes
          if (responseTime > 0 && responseTime < 10_080) {
            // Less than 1 week
            responseTimes.push(responseTime);
            messagesResponded++;
          }
        }
      }
    }
  }

  // Calculate metrics
  const avgResponseTimeMinutes =
    responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

  const sortedTimes = [...responseTimes].sort((a, b) => a - b);
  const medianResponseTimeMinutes =
    sortedTimes.length > 0
      ? (sortedTimes[Math.floor(sortedTimes.length / 2)] ?? 0)
      : 0;

  const responseRate =
    messagesRequiringResponse > 0
      ? messagesResponded / messagesRequiringResponse
      : 0;

  return {
    avgResponseTimeMinutes: Math.round(avgResponseTimeMinutes),
    medianResponseTimeMinutes: Math.round(medianResponseTimeMinutes),
    responseRate: Math.round(responseRate * 100) / 100,
    fastestResponseMinutes:
      responseTimes.length > 0 ? Math.round(Math.min(...responseTimes)) : 0,
    slowestResponseMinutes:
      responseTimes.length > 0 ? Math.round(Math.max(...responseTimes)) : 0,
    businessHoursOnly: false, // TODO: Implement business hours filtering
  };
}

// =============================================================================
// DIRECTION ANALYSIS
// =============================================================================

/**
 * Calculate communication direction metrics.
 */
export function calculateDirection(
  threads: ThreadContext[],
  userEmail: string
): DirectionMetrics {
  let initiatedByUser = 0;
  let initiatedByContact = 0;

  for (const thread of threads) {
    // Find the first message in the thread
    const firstMessage = thread.messages.reduce((earliest, current) => {
      const earliestTime = earliest.sentAt?.getTime() ?? Number.MAX_VALUE;
      const currentTime = current.sentAt?.getTime() ?? Number.MAX_VALUE;
      return currentTime < earliestTime ? current : earliest;
    }, thread.messages[0]);

    if (firstMessage) {
      if (firstMessage.fromEmail.toLowerCase() === userEmail.toLowerCase()) {
        initiatedByUser++;
      } else {
        initiatedByContact++;
      }
    }
  }

  const total = initiatedByUser + initiatedByContact;
  const initiationRatio =
    initiatedByContact > 0
      ? initiatedByUser / initiatedByContact
      : initiatedByUser > 0
        ? 10
        : 1;

  let trend: DirectionMetrics["trend"] = "balanced";
  if (initiationRatio > 2) {
    trend = "user_initiating_more";
  } else if (initiationRatio < 0.5) {
    trend = "contact_initiating_more";
  }

  return {
    initiatedByUser,
    initiatedByContact,
    initiationRatio: Math.round(initiationRatio * 100) / 100,
    trend,
  };
}

// =============================================================================
// TOPIC ASSOCIATION
// =============================================================================

/**
 * Calculate topic associations for a contact.
 */
export function calculateTopicAssociation(
  threads: ThreadContext[],
  threadTopics: Map<string, { topicId: string; topicName: string }[]>
): TopicAssociation[] {
  const topicStats = new Map<
    string,
    {
      topicId: string;
      topicName: string;
      threadCount: number;
      lastDiscussedAt: Date;
      sentimentSum: number;
      sentimentCount: number;
    }
  >();

  for (const thread of threads) {
    const topics = threadTopics.get(thread.threadId) ?? [];

    for (const topic of topics) {
      const existing = topicStats.get(topic.topicId);

      if (existing) {
        existing.threadCount++;
        if (thread.lastMessageAt > existing.lastDiscussedAt) {
          existing.lastDiscussedAt = thread.lastMessageAt;
        }
      } else {
        topicStats.set(topic.topicId, {
          topicId: topic.topicId,
          topicName: topic.topicName,
          threadCount: 1,
          lastDiscussedAt: thread.lastMessageAt,
          sentimentSum: 0,
          sentimentCount: 0,
        });
      }
    }
  }

  // Convert to array and sort by thread count
  return Array.from(topicStats.values())
    .map((stat) => ({
      topicId: stat.topicId,
      topicName: stat.topicName,
      threadCount: stat.threadCount,
      lastDiscussedAt: stat.lastDiscussedAt,
      sentimentScore:
        stat.sentimentCount > 0
          ? stat.sentimentSum / stat.sentimentCount
          : undefined,
    }))
    .sort((a, b) => b.threadCount - a.threadCount);
}

// =============================================================================
// AGGREGATED COMMUNICATION METRICS
// =============================================================================

/**
 * Communication metrics aggregation result.
 */
export interface CommunicationMetrics {
  frequency: FrequencyMetrics;
  responsiveness: ResponsivenessMetrics;
  direction: DirectionMetrics;
  topics: TopicAssociation[];
  summary: {
    totalThreads: number;
    totalMessages: number;
    firstInteractionAt?: Date;
    lastInteractionAt?: Date;
    avgWordsPerMessage: number;
  };
}

/**
 * Calculate all communication metrics for a contact.
 */
export function calculateCommunicationMetrics(
  threads: ThreadContext[],
  contactEmail: string,
  userEmail: string,
  threadTopics: Map<string, { topicId: string; topicName: string }[]>,
  period: TimePeriod = "30d"
): CommunicationMetrics {
  const frequency = calculateFrequency(threads, period);
  const responsiveness = calculateResponsiveness(
    threads,
    contactEmail,
    userEmail
  );
  const direction = calculateDirection(threads, userEmail);
  const topics = calculateTopicAssociation(threads, threadTopics);

  // Calculate summary stats
  const totalThreads = threads.length;
  const totalMessages = threads.reduce((sum, t) => sum + t.messageCount, 0);

  const allDates = threads.flatMap((t) => [t.firstMessageAt, t.lastMessageAt]);
  const firstInteractionAt =
    allDates.length > 0
      ? new Date(Math.min(...allDates.map((d) => d.getTime())))
      : undefined;
  const lastInteractionAt =
    allDates.length > 0
      ? new Date(Math.max(...allDates.map((d) => d.getTime())))
      : undefined;

  // Calculate average words per message
  let totalWords = 0;
  let messageCount = 0;

  for (const thread of threads) {
    for (const message of thread.messages) {
      if (
        message.fromEmail.toLowerCase() === contactEmail.toLowerCase() &&
        message.bodyText
      ) {
        totalWords += message.bodyText.split(/\s+/).length;
        messageCount++;
      }
    }
  }

  const avgWordsPerMessage = messageCount > 0 ? totalWords / messageCount : 0;

  return {
    frequency,
    responsiveness,
    direction,
    topics,
    summary: {
      totalThreads,
      totalMessages,
      firstInteractionAt,
      lastInteractionAt,
      avgWordsPerMessage: Math.round(avgWordsPerMessage),
    },
  };
}
