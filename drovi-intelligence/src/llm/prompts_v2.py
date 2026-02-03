"""
Strict Extraction Prompts V2

These prompts enforce high-quality extraction with strict criteria:
- Confidence threshold >= 0.8 for all extractions
- WHO + WHAT + WHEN required for commitments
- Explicit choice (past tense) required for decisions
- Verifiable facts only for claims

Use these prompts to eliminate garbage extractions like:
- Marketing CTAs ("We'll send you tips")
- Footer garbage (legal notices, addresses)
- Social actions ("Accept LinkedIn invitation")
"""

from typing import Any


def _format_memory_context(memory_context: dict | None) -> str | None:
    if not memory_context:
        return None

    def _summarize(uios: list[dict]) -> list[str]:
        lines = []
        for uio in uios[:5]:
            title = uio.get("title") or "Untitled"
            uio_type = uio.get("type") or "unknown"
            status = uio.get("status") or "unknown"
            lines.append(f"- [{uio_type}/{status}] {title}")
        return lines

    parts = []
    recent = memory_context.get("recent_uios") or []
    convo = memory_context.get("conversation_uios") or []
    if convo:
        parts.append("Conversation-linked UIOs:\n" + "\n".join(_summarize(convo)))
    if recent:
        parts.append("Relevant UIOs:\n" + "\n".join(_summarize(recent)))

    if not parts:
        return None
    return "\n\n".join(parts)


def _source_specific_guidance(source_type: str) -> str:
    source = (source_type or "").lower()
    if source in {"meeting", "call", "recording"}:
        return (
            "Source guidance: spoken transcript. Prefer explicit statements and attributed speakers. "
            "Avoid inferring intent from tentative language or brainstorming."
        )
    if source in {"slack", "whatsapp"}:
        return (
            "Source guidance: short chat messages. Treat emojis and reactions as non-evidence. "
            "Prefer explicit commitments/decisions; avoid casual statements or jokes."
        )
    if source in {"email"}:
        return (
            "Source guidance: email thread. Ignore quoted replies, signatures, and footer boilerplate. "
            "Prefer the newest message content."
        )
    if source in {"calendar"}:
        return "Source guidance: calendar/event metadata. Be conservative with commitments."
    if source in {"notion", "google_docs", "documents"}:
        return (
            "Source guidance: document content. Extract explicit commitments/decisions/tasks from "
            "section text; avoid summarizing general context or headings."
        )
    return "Source guidance: extract only explicit commitments/decisions/tasks."

# =============================================================================
# COMMITMENT EXTRACTION - STRICT
# =============================================================================

COMMITMENT_EXTRACTION_V2_SYSTEM = """You are an expert at extracting REAL BUSINESS COMMITMENTS only.

## WHAT IS A COMMITMENT?

A commitment is a PROMISE or OBLIGATION that meets ALL THREE criteria:

1. **WHO**: A specific, identifiable person (not a company, not "we", not vague)
2. **WHAT**: A specific, actionable thing to be done (not vague platitudes)
3. **WHEN**: An explicit or strongly implied deadline (even "soon" counts, but must exist)

## WHAT IS NOT A COMMITMENT

DO NOT extract these - they are NOT real commitments:

❌ **Marketing CTAs**:
- "We'll send you tips and best practices"
- "We'll keep you updated on new features"
- "Stay tuned for more"
- "We're here to help you succeed"

❌ **Generic pleasantries**:
- "We'll be in touch"
- "Looking forward to connecting"
- "Let's chat soon"
- "Happy to help whenever"

❌ **Automated messages**:
- "Your order will ship within 3-5 business days"
- "We'll notify you when your package arrives"
- "Your subscription will renew automatically"

❌ **Newsletter boilerplate**:
- "More tips coming next week"
- "See you in your inbox"
- "Check out our latest post"

❌ **Vague intentions**:
- "We're working on improving this"
- "We plan to address this"
- "Hopefully we can"

## EXAMPLES OF REAL COMMITMENTS

✓ "I'll send you the proposal by Friday"
  → WHO: sender, WHAT: send proposal, WHEN: Friday

✓ "John will review the contract and get back to you by EOD"
  → WHO: John, WHAT: review contract + respond, WHEN: EOD

✓ "I can have the analysis ready for the Monday meeting"
  → WHO: sender, WHAT: prepare analysis, WHEN: Monday meeting

✓ "Let me check with Sarah and follow up tomorrow"
  → WHO: sender, WHAT: check with Sarah + follow up, WHEN: tomorrow

## EXTRACTION RULES

1. **Confidence >= 0.8** - Only extract if you're highly confident
2. **Return empty array []** if no REAL commitments found - this is the correct response for most newsletters and automated emails
3. **Quote the exact text** that supports the commitment
4. **Be conservative** - When in doubt, don't extract

## OUTPUT FORMAT

For each commitment found:
- title: Clear, actionable description
- description: Additional context if needed
- direction: owed_by_me (user made it) or owed_to_me (owed to user)
- debtor_name/email: Person who owes
- creditor_name/email: Person owed to
- due_date_text: Original deadline text
- due_date: ISO date if determinable
- priority: low/medium/high/urgent
- confidence: Must be >= 0.8
- quoted_text: Exact supporting quote
- quoted_text_start: 0-based start index of quoted_text within CONTENT
- quoted_text_end: 0-based end index of quoted_text within CONTENT
- supporting_quotes: Additional evidence spans if this commitment is confirmed elsewhere
- reasoning: Why this is a real commitment

Remember: Most emails contain ZERO real commitments. An empty result is often correct."""


def get_commitment_extraction_v2_prompt(
    content: str,
    source_type: str,
    user_email: str | None = None,
    user_name: str | None = None,
    contact_context: dict | None = None,
    memory_context: dict | None = None,
) -> list[dict]:
    """Build strict commitment extraction prompt."""
    context_parts = []

    if user_email:
        context_parts.append(f"User email: {user_email}")
    if user_name:
        context_parts.append(f"User name: {user_name}")

    context_parts.append(f"Source type: {source_type}")
    context_parts.append(_source_specific_guidance(source_type))

    # Add contact context if available
    if contact_context:
        context_parts.append("Known contacts mentioned:")
        for email, info in list(contact_context.items())[:5]:
            if isinstance(info, dict):
                context_parts.append(f"  - {email}: {info.get('display_name', '')} ({info.get('company', '')})")

    memory_str = _format_memory_context(memory_context)
    if memory_str:
        context_parts.append(f"Memory context:\n{memory_str}")

    context_str = "\n".join(context_parts)

    return [
        {"role": "system", "content": COMMITMENT_EXTRACTION_V2_SYSTEM},
        {"role": "user", "content": f"""Extract REAL business commitments from this content.

Context:
{context_str}

---
CONTENT:
{content}
---

Return ONLY commitments with confidence >= 0.8 that have:
1. A specific WHO (person, not company)
2. A specific WHAT (actionable thing)
3. A WHEN (deadline or timeframe)
4. Include quoted_text_start and quoted_text_end for each commitment

If there are no real commitments, return an empty array [].
Most newsletters and automated emails have ZERO real commitments."""},
    ]


# =============================================================================
# DECISION EXTRACTION - STRICT
# =============================================================================

DECISION_EXTRACTION_V2_SYSTEM = """You are an expert at extracting REAL BUSINESS DECISIONS only.

## WHAT IS A DECISION?

A decision is an EXPLICIT CHOICE that was MADE (past tense). The decision must:

1. **Be EXPLICIT**: Clearly stated, not implied or potential
2. **Be MADE**: Past tense - the choice has been finalized
3. **Be ACTIONABLE**: A real business choice with consequences

## WHAT IS NOT A DECISION

DO NOT extract these - they are NOT real decisions:

❌ **Pending considerations**:
- "We're considering switching to..."
- "We might want to look at..."
- "I'm thinking about..."

❌ **CTAs and buttons**:
- "Click to accept"
- "Accept invitation"
- "Confirm your email"
- "Update preferences"

❌ **Social actions**:
- "Accept LinkedIn invitation"
- "Follow us on Twitter"
- "Join our newsletter"

❌ **Routine actions**:
- "We've updated our privacy policy"
- "Your settings have been saved"
- "Account created successfully"

❌ **Vague statements**:
- "We're committed to excellence"
- "We believe in quality"
- "Our focus is on customers"

## EXAMPLES OF REAL DECISIONS

✓ "We've decided to go with Vendor A for our cloud infrastructure"
  → EXPLICIT choice, MADE (past), has business impact

✓ "After reviewing the proposals, we're selecting the React option"
  → EXPLICIT choice, selecting = decided, technical direction

✓ "I've decided to postpone the launch to March"
  → EXPLICIT choice about timeline, MADE

✓ "The team voted to move forward with Plan B"
  → EXPLICIT choice through voting, MADE

## DECISION STATUS

- made: Decision is final
- pending: Still being considered (rarely extract - must have significant context)
- deferred: Explicitly postponed
- reversed: Changed from previous decision

## EXTRACTION RULES

1. **Confidence >= 0.8** - Only extract high-confidence decisions
2. **Return empty array []** if no REAL decisions found
3. **"Deciding to" in future tense is NOT a decision**
4. **Quote exact text** that proves the decision was made

## OUTPUT FORMAT

For each decision:
- title: Clear name for the decision
- statement: What was decided
- rationale: Why (if stated)
- status: made/pending/deferred/reversed
- decision_maker_name/email: Who made it
- stakeholders: Who is affected
- confidence: Must be >= 0.8
- quoted_text: Exact supporting quote
- quoted_text_start: 0-based start index of quoted_text within CONTENT
- quoted_text_end: 0-based end index of quoted_text within CONTENT
- supporting_quotes: Additional evidence spans if this decision is confirmed elsewhere

Remember: CTAs like "Accept invitation" are NOT decisions. An empty result is often correct."""


def get_decision_extraction_v2_prompt(
    content: str,
    source_type: str,
    user_email: str | None = None,
    user_name: str | None = None,
    memory_context: dict | None = None,
) -> list[dict]:
    """Build strict decision extraction prompt."""
    context_parts = []

    if user_email:
        context_parts.append(f"User email: {user_email}")
    if user_name:
        context_parts.append(f"User name: {user_name}")

    context_parts.append(f"Source type: {source_type}")
    context_parts.append(_source_specific_guidance(source_type))
    memory_str = _format_memory_context(memory_context)
    if memory_str:
        context_parts.append(f"Memory context:\n{memory_str}")
    context_str = "\n".join(context_parts)

    return [
        {"role": "system", "content": DECISION_EXTRACTION_V2_SYSTEM},
        {"role": "user", "content": f"""Extract REAL business decisions from this content.

Context:
{context_str}

---
CONTENT:
{content}
---

Return ONLY decisions with confidence >= 0.8 that are:
1. EXPLICIT choices (not considerations or preferences)
2. MADE (past tense, finalized)
3. ACTIONABLE (real business impact)
4. Include quoted_text_start and quoted_text_end for each decision

If there are no real decisions, return an empty array [].
CTAs like "Accept invitation" or "Click to confirm" are NOT decisions."""},
    ]


# =============================================================================
# CLAIM EXTRACTION - STRICT
# =============================================================================

CLAIM_EXTRACTION_V2_SYSTEM = """You are an expert at extracting FACTUAL BUSINESS CLAIMS only.

## WHAT IS A CLAIM?

A claim is a VERIFIABLE factual statement about business, products, or services. It must be:

1. **VERIFIABLE**: Could be fact-checked
2. **SUBSTANTIVE**: Contains meaningful information
3. **BUSINESS-RELEVANT**: Related to work, products, or services

## WHAT IS NOT A CLAIM

DO NOT extract these - they are NOT real claims:

❌ **Legal disclaimers**:
- "All rights reserved"
- "Terms and conditions apply"
- "This message is confidential"
- "If you received this in error..."

❌ **Addresses and contact info in footers**:
- "123 Main Street, Suite 400, New York, NY 10001"
- "Contact us at support@company.com"
- "Phone: (555) 123-4567"

❌ **Raw URLs and email addresses**:
- "https://example.com/privacy"
- "https://example.com/unsubscribe"
- "support@company.com"
- "noreply@company.com"
- Any standalone URL or email address without substantial context

❌ **Marketing superlatives**:
- "Industry-leading solutions"
- "World-class support"
- "Best-in-class technology"
- "Revolutionary approach"

❌ **Footer/signature content**:
- "Unsubscribe | Privacy Policy | Terms"
- "Follow us on Twitter | LinkedIn | Facebook"
- "Sent from my iPhone"
- "Best regards, [name]"

❌ **Boilerplate**:
- "Thank you for your business"
- "We value your partnership"
- "Please do not reply to this email"

❌ **Legal/Privacy update emails**:
- "Our privacy policy has been updated"
- "We're updating our subprocessors"
- "Changes to our terms of service"
- Announcements about policy changes (not real business claims)

❌ **Generic statements**:
- "We're excited to announce..."
- "We hope you enjoy..."
- "Let us know if you have questions"

## EXAMPLES OF REAL CLAIMS

✓ "We have 500 enterprise customers using our API"
  → VERIFIABLE number, business fact

✓ "The quarterly revenue was $4.2M, up 15% from last quarter"
  → VERIFIABLE metric, specific numbers

✓ "The integration takes approximately 2 hours to complete"
  → VERIFIABLE timeline, technical fact

✓ "John Smith joined as VP of Engineering last month"
  → VERIFIABLE personnel fact

✓ "Our SLA guarantees 99.9% uptime"
  → VERIFIABLE product specification

## CLAIM TYPES

- fact: Verifiable statement (numbers, dates, events)
- reference: Mention of document, link, or resource
- deadline: Time-related constraint
- price: Financial amount or cost
- contact_info: Person's role/title (NOT addresses in footers)

## EXTRACTION RULES

1. **Confidence >= 0.8** - Only extract high-confidence claims
2. **Return empty array []** if no REAL claims found
3. **Skip everything after signature/footer delimiter**
4. **Quote exact text** supporting the claim

## OUTPUT FORMAT

For each claim:
- type: fact/reference/deadline/price/contact_info
- content: The claim statement
- quoted_text: Exact supporting quote
- quoted_text_start: 0-based start index of quoted_text within CONTENT
- quoted_text_end: 0-based end index of quoted_text within CONTENT
- confidence: Must be >= 0.8
- importance: low/medium/high

Remember: Most emails have very few extractable claims. Footers are NEVER claims."""


def get_claim_extraction_v2_prompt(
    content: str,
    source_type: str,
    user_email: str | None = None,
    memory_context: dict | None = None,
) -> list[dict]:
    """Build strict claim extraction prompt."""
    context_parts = []

    if user_email:
        context_parts.append(f"User email: {user_email}")

    context_parts.append(f"Source type: {source_type}")
    context_parts.append(_source_specific_guidance(source_type))
    memory_str = _format_memory_context(memory_context)
    if memory_str:
        context_parts.append(f"Memory context:\n{memory_str}")
    context_str = "\n".join(context_parts)

    return [
        {"role": "system", "content": CLAIM_EXTRACTION_V2_SYSTEM},
        {"role": "user", "content": f"""Extract FACTUAL business claims from this content.

Context:
{context_str}

---
CONTENT:
{content}
---

Return ONLY claims with confidence >= 0.8 that are:
1. VERIFIABLE (could be fact-checked)
2. SUBSTANTIVE (meaningful information)
3. NOT footer/signature/legal content
4. Include quoted_text_start and quoted_text_end for each claim

If there are no real claims, return an empty array [].
Addresses, legal disclaimers, and marketing superlatives are NOT claims."""},
    ]


# =============================================================================
# CONTACT EXTRACTION - STRICT
# =============================================================================

CONTACT_EXTRACTION_V2_SYSTEM = """You are an expert at extracting REAL BUSINESS CONTACTS only.

## WHAT IS A REAL CONTACT?

A real contact is a person you would actually want to track and communicate with:

1. **A real person** with a name and/or direct email
2. **Someone relevant** to business discussions
3. **Someone reachable** (has contact info or is clearly identifiable)

## WHAT IS NOT A REAL CONTACT

DO NOT extract these:

❌ **Automated/no-reply addresses**:
- noreply@company.com
- no-reply@notifications.service.com
- notifications@github.com
- mailer-daemon@...

❌ **Generic role emails**:
- support@company.com
- sales@company.com
- info@company.com
- team@company.com
- hello@company.com

❌ **System accounts**:
- GitHub notifications
- Slack bots
- Calendar invites from systems
- Newsletter senders

❌ **Marketing list senders**:
- newsletter@...
- updates@...
- news@...

## EXAMPLES OF REAL CONTACTS

✓ "John Smith <john.smith@company.com>"
  → Real person with direct email

✓ "Sarah mentioned in the email: sarah.jones@partner.com"
  → Real person referenced in content

✓ "CC'd to Mike Chen, VP of Sales"
  → Real person with role context

✓ "Please reach out to Jane at jane@acme.com for billing questions"
  → Real person with specific purpose

## EXTRACTION RULES

1. **Confidence >= 0.7** for contacts (slightly lower than other extractions)
2. **Must have at least name OR direct email**
3. **Skip all noreply/automated senders**
4. **Skip generic role emails**

## OUTPUT FORMAT

For each contact:
- name: Full name if available
- email: Direct email address
- role: Job title/role if mentioned
- company: Company name if mentioned
- relationship: How they relate (colleague, client, vendor, etc.)
- confidence: Must be >= 0.7

Remember: Most newsletter/automated emails have ZERO real contacts."""


def get_contact_extraction_v2_prompt(
    content: str,
    source_type: str,
    metadata: dict | None = None,
) -> list[dict]:
    """Build strict contact extraction prompt."""
    context_parts = [f"Source type: {source_type}", _source_specific_guidance(source_type)]

    # Add sender/recipient info from metadata
    if metadata:
        if metadata.get("from"):
            context_parts.append(f"From: {metadata.get('from')}")
        if metadata.get("to"):
            context_parts.append(f"To: {metadata.get('to')}")
        if metadata.get("cc"):
            context_parts.append(f"CC: {metadata.get('cc')}")

    context_str = "\n".join(context_parts)

    return [
        {"role": "system", "content": CONTACT_EXTRACTION_V2_SYSTEM},
        {"role": "user", "content": f"""Extract REAL business contacts from this content.

Context:
{context_str}

---
CONTENT:
{content}
---

Return ONLY contacts with confidence >= 0.7 that are:
1. Real people (not automated senders)
2. Have direct email or full name
3. NOT noreply/support/sales/info type addresses

If there are no real contacts, return an empty array [].
Newsletter senders and automated accounts are NOT real contacts."""},
    ]


# =============================================================================
# CALENDAR EVENT EXTRACTION - STRUCTURED
# =============================================================================

CALENDAR_EXTRACTION_SYSTEM = """You are an expert at extracting intelligence from calendar events.

Calendar events are structured data sources that often contain explicit commitments.

## WHAT TO EXTRACT FROM CALENDAR EVENTS

1. **Commitments**:
   - Meeting attendance is a commitment
   - Action items mentioned in description
   - Follow-ups scheduled

2. **Decisions** (if mentioned in description):
   - "This meeting is to finalize..."
   - "We decided to..."

3. **Claims/Facts**:
   - Meeting purpose
   - Attendee roles
   - Resources/links mentioned

## SPECIAL RULES FOR CALENDAR

- All attendees who accepted ARE committed to attend
- Meeting organizer has implicit ownership
- Recurring meetings have lower commitment weight unless specific agenda

## OUTPUT FORMAT

Extract:
- commitments: Meeting attendance + action items
- decisions: Any decisions mentioned
- claims: Key facts about the meeting
- contacts: Attendees (with their response status)

Be more lenient with confidence for calendar events since they're structured data."""


def get_calendar_extraction_prompt(
    event_data: dict,
    user_email: str | None = None,
) -> list[dict]:
    """Build calendar-specific extraction prompt."""
    context_parts = []

    if user_email:
        context_parts.append(f"User email: {user_email}")

    # Build event summary
    summary = event_data.get("summary", "No title")
    description = event_data.get("description", "")
    start = event_data.get("start", {})
    end = event_data.get("end", {})
    attendees = event_data.get("attendees", [])
    organizer = event_data.get("organizer", {})

    event_text = f"""
Event: {summary}
Start: {start.get('dateTime', start.get('date', 'Unknown'))}
End: {end.get('dateTime', end.get('date', 'Unknown'))}
Organizer: {organizer.get('email', 'Unknown')}
Attendees: {', '.join(a.get('email', '') for a in attendees[:10])}
Description:
{description}
"""

    context_str = "\n".join(context_parts)

    return [
        {"role": "system", "content": CALENDAR_EXTRACTION_SYSTEM},
        {"role": "user", "content": f"""Extract intelligence from this calendar event.

Context:
{context_str}

---
CALENDAR EVENT:
{event_text}
---

Extract commitments, decisions, and contacts from this event.
Meeting attendance by accepted attendees is an implicit commitment."""},
    ]


# =============================================================================
# TASK EXTRACTION - STRICT
# =============================================================================

TASK_EXTRACTION_V2_SYSTEM = """You are an expert at extracting ACTIONABLE TASKS only.

## WHAT IS A TASK?

A task is a SPECIFIC, ACTIONABLE item that someone needs to DO. It must have:

1. **CLEAR ACTION**: What specifically needs to be done
2. **ASSIGNEE**: Who is responsible (explicit or implicit)
3. **DERIVATION**: Comes from a commitment, decision, or explicit request

## WHAT IS NOT A TASK

DO NOT extract these:

❌ **Vague statements**:
- "Follow up"
- "Look into this"
- "Think about it"

❌ **Already completed actions**:
- "I sent the email"
- "We discussed this"
- "The meeting happened"

❌ **Marketing/CTA items**:
- "Click here to learn more"
- "Register for our webinar"
- "Unsubscribe from emails"

❌ **Generic suggestions**:
- "Consider upgrading"
- "Check out our new features"
- "Stay tuned"

## EXAMPLES OF REAL TASKS

✓ "Send the proposal by Friday" → Task: Send proposal, Due: Friday
✓ "Review the contract before signing" → Task: Review contract
✓ "Schedule a follow-up call with Sarah" → Task: Schedule call with Sarah
✓ "Update the pricing page with new tiers" → Task: Update pricing page

## EXTRACTION RULES

1. **Confidence >= 0.8** - Only high-confidence tasks
2. **Return empty []** if no real tasks found
3. **Link to source** - Reference the commitment/decision it comes from
4. **Be specific** - Generic tasks are probably not real tasks
5. **Provide quote spans** - Include quoted_text_start and quoted_text_end for each task"""


def get_task_extraction_v2_prompt(
    content: str,
    commitments: list[dict] | None = None,
    decisions: list[dict] | None = None,
    source_type: str = "email",
    memory_context: dict | None = None,
) -> list[dict]:
    """Build strict task extraction prompt."""
    context_parts = []

    context_parts.append(f"Source type: {source_type}")

    if commitments:
        context_parts.append("\\nCommitments found:")
        for c in commitments[:5]:
            context_parts.append(f"  - {c.get('title', c.get('content', ''))}")

    if decisions:
        context_parts.append("\\nDecisions found:")
        for d in decisions[:5]:
            context_parts.append(f"  - {d.get('title', d.get('content', ''))}")

    memory_str = _format_memory_context(memory_context)
    if memory_str:
        context_parts.append("\\nMemory context:")
        context_parts.append(memory_str)

    context_str = "\\n".join(context_parts)

    return [
        {"role": "system", "content": TASK_EXTRACTION_V2_SYSTEM},
        {"role": "user", "content": f"""Extract ACTIONABLE TASKS from this content.

Context:
{context_str}

---
CONTENT:
{content}
---

Return ONLY tasks with confidence >= 0.8 that are:
1. SPECIFIC and ACTIONABLE
2. Have a clear assignee
3. Derived from commitments or explicit requests
4. Include quoted_text_start and quoted_text_end for each task

If there are no real tasks, return an empty array []."""},
    ]


# =============================================================================
# RISK DETECTION - STRICT
# =============================================================================

RISK_DETECTION_V2_SYSTEM = """You are an expert at detecting REAL BUSINESS RISKS only.

## WHAT IS A RISK?

A risk is a POTENTIAL PROBLEM that could impact business outcomes. It must be:

1. **SPECIFIC**: Clear description of what could go wrong
2. **ACTIONABLE**: Something that can be mitigated
3. **RELEVANT**: Related to actual commitments or decisions
4. **MATERIAL**: Has real business impact if it occurs

## RISK TYPES (use EXACTLY these values)

- deadline_risk: Commitment due date is too soon or conflicts with other obligations
- commitment_conflict: Two or more commitments that are incompatible
- unclear_ownership: No clear owner for a commitment or decision
- missing_information: Critical information needed but not provided
- escalation_needed: Issue requires attention from higher authority
- policy_violation: Action that may violate policies or agreements
- financial_risk: Potential financial impact or exposure
- relationship_risk: Risk to business relationship or reputation
- sensitive_data: Sensitive or confidential information at risk
- contradiction: Statements that contradict each other
- fraud_signal: Indicators of potential fraud or misrepresentation
- other: Other risk types not covered above

## WHAT IS NOT A RISK

DO NOT flag these as risks:

❌ **Generic concerns**:
- "This might be difficult"
- "We should be careful"
- "Consider potential issues"

❌ **Marketing/promotional content**:
- "Don't miss this opportunity"
- "Limited time offer"
- Webinar registrations

❌ **Normal business operations**:
- Regular meetings scheduled
- Standard approval processes
- Routine communications

❌ **Already mitigated items**:
- Risks with clear mitigation already in place
- Completed actions

## EXAMPLES OF REAL RISKS

✓ "Commitment to deliver by Friday, but dependencies not yet resolved"
  → Type: deadline_risk, Severity: high

✓ "No one assigned to review the contract before signing"
  → Type: unclear_ownership, Severity: medium

✓ "Client expects feature X but we committed to feature Y"
  → Type: commitment_conflict, Severity: high

✓ "Customer expects feature X, but we committed to feature Y"
  → Type: stakeholder_misalignment, Severity: high

## EXTRACTION RULES

1. **Confidence >= 0.75** - Only flag high-confidence risks
2. **Return empty []** if no real risks found
3. **Link to source** - Reference the commitment/decision at risk
4. **Suggest mitigation** - Each risk should have actionable mitigation
5. **Most emails have ZERO risks** - Don't invent problems
6. **Provide quote spans** - Include quoted_text_start and quoted_text_end for each risk evidence span"""


def get_risk_detection_v2_prompt(
    content: str,
    commitments: list[dict] | None = None,
    decisions: list[dict] | None = None,
    source_type: str = "email",
    memory_context: dict | None = None,
) -> list[dict]:
    """Build strict risk detection prompt."""
    context_parts = [f"Source type: {source_type}", _source_specific_guidance(source_type)]

    if commitments:
        context_parts.append("\nCommitments to analyze for risks:")
        for c in commitments[:10]:
            title = c.get('title', '')
            due = c.get('due_date_text', 'no deadline')
            priority = c.get('priority', 'medium')
            context_parts.append(f"  - {title} (due: {due}, priority: {priority})")

    if decisions:
        context_parts.append("\nDecisions to analyze for risks:")
        for d in decisions[:10]:
            title = d.get('title', '')
            status = d.get('status', 'made')
            context_parts.append(f"  - {title} (status: {status})")

    memory_str = _format_memory_context(memory_context)
    if memory_str:
        context_parts.append("\nMemory context:")
        context_parts.append(memory_str)

    context_str = "\n".join(context_parts)

    return [
        {"role": "system", "content": RISK_DETECTION_V2_SYSTEM},
        {"role": "user", "content": f"""Detect REAL BUSINESS RISKS in this content.

Context:
{context_str}

---
CONTENT:
{content}
---

Return ONLY risks with confidence >= 0.75 that:
1. Are SPECIFIC and ACTIONABLE
2. Have MATERIAL business impact
3. Are linked to specific commitments or decisions
4. Include quoted_text_start and quoted_text_end for each risk

If there are no real risks, return an empty array [].
Marketing emails and newsletters typically have ZERO risks."""},
    ]
