// =============================================================================
// PROFILE ENRICHMENT PROMPTS
// =============================================================================
//
// LLM prompts for extracting and enriching contact profile information.
//

import type { ThreadContext } from "../types";

// =============================================================================
// SIGNATURE EXTRACTION
// =============================================================================

/**
 * Build prompt for extracting contact information from email signatures.
 */
export function buildSignatureExtractionPrompt(
  emails: Array<{
    bodyText: string;
    fromEmail: string;
    fromName?: string;
  }>
): string {
  const emailSamples = emails
    .map(
      (e, i) => `
--- Email ${i + 1} ---
From: ${e.fromName ?? "Unknown"} <${e.fromEmail}>
Body:
${e.bodyText.slice(-2000)}
`
    )
    .join("\n");

  return `You are an expert at extracting contact information from email signatures.

Analyze the following emails and extract any contact information found in the signatures.
Look for patterns like:
- Name and title
- Company name
- Phone numbers (direct, mobile, office)
- LinkedIn URLs
- Website URLs
- Physical addresses

Emails to analyze:
${emailSamples}

Extract information for each unique person found. Focus on the signature blocks at the end of emails.
Return high confidence (0.8-1.0) for clearly stated information, medium confidence (0.5-0.7) for inferred information.

Respond with JSON matching this schema:
{
  "extractions": [
    {
      "name": "string or null",
      "title": "string or null",
      "company": "string or null",
      "phone": "string or null",
      "email": "string or null",
      "linkedinUrl": "string or null",
      "website": "string or null",
      "address": "string or null",
      "confidence": number between 0 and 1
    }
  ]
}`;
}

// =============================================================================
// PROFILE ENRICHMENT
// =============================================================================

/**
 * Build prompt for enriching a contact profile from conversation context.
 */
export function buildProfileEnrichmentPrompt(
  contactEmail: string,
  existingProfile: {
    displayName?: string;
    title?: string;
    company?: string;
  },
  threads: ThreadContext[]
): string {
  const threadSummaries = threads.slice(0, 10).map((t) => {
    const contactMessages = t.messages
      .filter((m) => m.fromEmail.toLowerCase() === contactEmail.toLowerCase())
      .slice(0, 3);

    return `
Subject: ${t.subject ?? "(no subject)"}
Date: ${t.lastMessageAt.toISOString().split("T")[0]}
Sample messages from contact:
${contactMessages.map((m) => `  "${m.bodyText?.slice(0, 500) ?? ""}"...`).join("\n")}
`;
  });

  return `You are an expert at building professional profiles from email conversations.

Contact email: ${contactEmail}
Existing profile information:
- Name: ${existingProfile.displayName ?? "Unknown"}
- Title: ${existingProfile.title ?? "Unknown"}
- Company: ${existingProfile.company ?? "Unknown"}

Recent email threads with this contact:
${threadSummaries.join("\n---\n")}

Based on the email content, extract or infer:
1. Full display name (if not already known)
2. First name and last name separately
3. Job title or role
4. Company or organization
5. Department (if mentioned)
6. Phone number (if mentioned in emails)
7. LinkedIn URL (if mentioned)

Only include information you can reasonably infer from the emails.
Provide a confidence score (0-1) for your overall extraction.

Respond with JSON matching this schema:
{
  "displayName": "string or null",
  "firstName": "string or null",
  "lastName": "string or null",
  "title": "string or null",
  "company": "string or null",
  "department": "string or null",
  "phone": "string or null",
  "linkedinUrl": "string or null",
  "confidence": number between 0 and 1,
  "reasoning": "brief explanation of how you determined this information"
}`;
}

// =============================================================================
// VIP SIGNAL DETECTION
// =============================================================================

/**
 * Build prompt for detecting VIP signals from email content.
 */
export function buildVIPSignalPrompt(
  contactEmail: string,
  contactName: string | undefined,
  threads: ThreadContext[]
): string {
  const threadSummaries = threads.slice(0, 15).map((t) => {
    const participantCount = new Set(t.participants).size;
    return `
Subject: ${t.subject ?? "(no subject)"}
Date: ${t.lastMessageAt.toISOString().split("T")[0]}
Participants: ${participantCount} people
Messages: ${t.messageCount}
`;
  });

  return `You are an expert at identifying VIP contacts in professional communications.

Contact: ${contactName ?? contactEmail}
Email: ${contactEmail}

Recent email threads involving this contact:
${threadSummaries.join("\n")}

Analyze the communication patterns and content to determine if this contact should be considered a VIP.

Look for signals like:
1. **Seniority signals**: Executive titles, decision-maker language, authority indicators
2. **Frequency signals**: High volume of communication, quick response patterns
3. **Deal signals**: Mentions of deals, contracts, partnerships, negotiations
4. **Explicit signals**: Direct mentions of importance, urgency, or priority

For each signal found, rate its strength (0-1):
- 0.9-1.0: Very strong signal (e.g., clear CEO title, active deal discussion)
- 0.7-0.8: Strong signal (e.g., director level, frequent strategic discussions)
- 0.5-0.6: Moderate signal (e.g., manager level, occasional important topics)
- Below 0.5: Weak signal

Respond with JSON matching this schema:
{
  "isLikelyVip": boolean,
  "confidence": number between 0 and 1,
  "signals": [
    {
      "type": "frequency" | "seniority" | "deal" | "explicit",
      "strength": number between 0 and 1,
      "description": "brief description of the signal"
    }
  ],
  "reasoning": "brief explanation of your VIP assessment"
}`;
}

// =============================================================================
// COMPANY DETECTION
// =============================================================================

/**
 * Build prompt for detecting company/organization from email content.
 */
export function buildCompanyDetectionPrompt(
  contactEmail: string,
  threads: ThreadContext[]
): string {
  const emailDomain = contactEmail.split("@")[1] ?? "";

  const signatures = threads
    .flatMap((t) =>
      t.messages
        .filter((m) => m.fromEmail.toLowerCase() === contactEmail.toLowerCase())
        .map((m) => m.bodyText?.slice(-1000) ?? "")
    )
    .slice(0, 5);

  return `You are an expert at identifying company affiliations from email communications.

Contact email: ${contactEmail}
Email domain: ${emailDomain}

Sample email signatures/content from this contact:
${signatures.map((s, i) => `--- Sample ${i + 1} ---\n${s}`).join("\n\n")}

Based on the email domain and content, identify:
1. Company/organization name
2. Industry (if determinable)
3. Company size estimate (startup, SMB, enterprise, etc.)
4. Any parent company or subsidiary relationships

Consider:
- The email domain (is it a corporate domain or personal?)
- Signature blocks mentioning company names
- Context clues in email content
- Professional networking patterns

Respond with JSON:
{
  "companyName": "string or null",
  "industry": "string or null",
  "companySize": "startup" | "smb" | "enterprise" | "unknown",
  "parentCompany": "string or null",
  "confidence": number between 0 and 1,
  "reasoning": "brief explanation"
}`;
}

// =============================================================================
// TIMEZONE DETECTION
// =============================================================================

/**
 * Build prompt for detecting contact's timezone from email patterns.
 */
export function buildTimezoneDetectionPrompt(
  contactEmail: string,
  messageTimes: Date[]
): string {
  const timeDistribution = messageTimes.map((d) => ({
    hour: d.getUTCHours(),
    dayOfWeek: d.getUTCDay(),
    timestamp: d.toISOString(),
  }));

  const hourCounts = new Array(24).fill(0);
  for (const t of timeDistribution) {
    hourCounts[t.hour]++;
  }

  return `You are an expert at inferring timezone from email sending patterns.

Contact: ${contactEmail}

Email sending times (UTC):
${timeDistribution
  .slice(0, 50)
  .map((t) => `- ${t.timestamp}`)
  .join("\n")}

Hour distribution (UTC):
${hourCounts.map((count, hour) => `${hour.toString().padStart(2, "0")}:00 - ${count} emails`).join("\n")}

Based on these sending patterns, estimate the contact's timezone.
Consider:
- Most emails are sent during business hours (9 AM - 6 PM local time)
- Very few emails at night (11 PM - 6 AM local time)
- Weekend patterns may differ from weekdays

Respond with JSON:
{
  "timezone": "IANA timezone string (e.g., America/New_York)",
  "utcOffset": number (hours from UTC, e.g., -5 for EST),
  "confidence": number between 0 and 1,
  "reasoning": "brief explanation of the pattern analysis"
}`;
}
