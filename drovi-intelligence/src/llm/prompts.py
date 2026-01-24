"""
Prompt Templates for Intelligence Extraction

Well-crafted prompts for each extraction task.
"""

# =============================================================================
# Classification Prompt
# =============================================================================

CLASSIFICATION_SYSTEM_PROMPT = """You are an expert at analyzing communication content to determine what types of intelligence can be extracted.

Your task is to classify the content and identify:
1. Whether it contains extractable intelligence
2. What types of intelligence are present (commitments, decisions, claims, risks, questions)
3. The primary intent, topics, urgency, importance, and sentiment

Be conservative - only mark categories as present if you're confident they exist.

Guidelines:
- COMMITMENTS: Explicit or implicit promises, agreements, or obligations (e.g., "I'll send you the report", "We agreed to meet Tuesday")
- DECISIONS: Choices made or being made (e.g., "We've decided to go with Option A", "I'm choosing the blue one")
- CLAIMS: Factual statements, opinions, references (e.g., "The meeting is at 3pm", "Sales were up 20%")
- RISKS: Potential issues, conflicts, unclear ownership, deadline concerns
- QUESTIONS: Open questions that need answers

For urgency (0-1):
- 0.0-0.3: No time pressure mentioned
- 0.3-0.6: Some time sensitivity (e.g., "this week", "soon")
- 0.6-0.8: Urgent (e.g., "today", "ASAP", explicit deadlines)
- 0.8-1.0: Critical (e.g., "immediately", emergency language)

For importance (0-1):
- Consider business impact, decision scope, and stakeholder involvement

For sentiment (-1 to 1):
- Negative: complaints, frustration, bad news
- Neutral: informational, routine
- Positive: appreciation, good news, enthusiasm"""


def get_classification_prompt(content: str, user_email: str | None = None) -> list[dict]:
    """Build the classification prompt."""
    user_context = ""
    if user_email:
        user_context = f"\n\nThe user's email is: {user_email}. Use this to determine direction of commitments (owed_by_me vs owed_to_me)."

    return [
        {"role": "system", "content": CLASSIFICATION_SYSTEM_PROMPT},
        {"role": "user", "content": f"Analyze this content and classify it:{user_context}\n\n---\n{content}\n---"},
    ]


# =============================================================================
# Claim Extraction Prompt
# =============================================================================

CLAIM_EXTRACTION_SYSTEM_PROMPT = """You are an expert at extracting claims from communication content.

A claim is any statement that asserts something. Extract ALL claims, including:

CLAIM TYPES:
- fact: Verifiable statements (dates, numbers, events)
- promise: Commitments to do something
- request: Asking someone to do something
- question: Open questions needing answers
- decision: Choices that were made
- opinion: Subjective views or preferences
- deadline: Time-related constraints
- price: Financial amounts or costs
- contact_info: Names, emails, phone numbers
- reference: Mentions of documents, links, or external resources
- action_item: Tasks that need to be done

GUIDELINES:
1. Extract the claim in clear, concise language
2. Include the EXACT quoted text that supports the claim
3. Assign appropriate importance (low/medium/high)
4. Be thorough - extract every claim, even small ones
5. Don't combine multiple claims into one

IMPORTANCE LEVELS:
- low: Background info, FYI items
- medium: Actionable items, relevant facts
- high: Critical decisions, urgent items, key commitments"""


def get_claim_extraction_prompt(
    content: str,
    classification_topics: list[str],
    user_email: str | None = None,
) -> list[dict]:
    """Build the claim extraction prompt."""
    topics_str = ", ".join(classification_topics) if classification_topics else "general"
    user_context = ""
    if user_email:
        user_context = f"\n\nThe user's email is: {user_email}"

    return [
        {"role": "system", "content": CLAIM_EXTRACTION_SYSTEM_PROMPT},
        {"role": "user", "content": f"""Extract all claims from this content.

Topics identified: {topics_str}{user_context}

---
{content}
---

Extract every claim with its type, content, quoted text, confidence, and importance."""},
    ]


# =============================================================================
# Commitment Extraction Prompt
# =============================================================================

COMMITMENT_EXTRACTION_SYSTEM_PROMPT = """You are an expert at extracting commitments from communication content.

A commitment is a promise or obligation - something someone has agreed to do or provide.

DIRECTION:
- owed_by_me: The user (based on user_email) made this commitment
- owed_to_me: Someone else made this commitment to the user

PRIORITY:
- low: Nice to have, no deadline
- medium: Should be done, flexible timing
- high: Important, has deadline or business impact
- urgent: Critical, immediate attention needed

DUE DATES:
- Extract explicit dates when stated ("January 15th", "next Tuesday")
- Convert relative dates: "by EOD" = end of today, "by EoW" = end of week, "next week" = 7 days, "end of quarter" = quarter end
- Set due_date_is_explicit=true only for specific dates/times
- Include the original text mentioning the date

CONDITIONAL COMMITMENTS:
- Mark is_conditional=true if the commitment depends on something else
- Specify the condition (e.g., "if the budget is approved")

GUIDELINES:
1. Be thorough - capture all commitments, even implicit ones
2. Include exact quoted text as evidence
3. Identify parties clearly (debtor = who owes, creditor = who is owed)
4. Provide reasoning for why this is a commitment

EXAMPLES:

Example 1 - Explicit Promise (owed_by_me):
Input: "I'll send you the updated proposal by Friday."
Output: {
  "title": "Send updated proposal",
  "description": "Send the updated proposal document",
  "direction": "owed_by_me",
  "debtor_name": "Me", "debtor_email": "[user_email]",
  "creditor_name": "You", "creditor_email": "[recipient_email]",
  "due_date_text": "by Friday",
  "due_date_is_explicit": true,
  "priority": "medium",
  "confidence": 0.95,
  "quoted_text": "I'll send you the updated proposal by Friday."
}

Example 2 - Request (owed_to_me):
Input: "Can you review the contract and get back to me by EOD?"
Output: {
  "title": "Review contract",
  "description": "Review the contract and provide feedback",
  "direction": "owed_to_me",
  "debtor_name": "You", "debtor_email": "[recipient_email]",
  "creditor_name": "Me", "creditor_email": "[user_email]",
  "due_date_text": "by EOD",
  "due_date_is_explicit": true,
  "priority": "high",
  "confidence": 0.90,
  "quoted_text": "Can you review the contract and get back to me by EOD?"
}

Example 3 - Implicit Promise:
Input: "Thanks for your patience. I'm working on finalizing the budget numbers."
Output: {
  "title": "Finalize budget numbers",
  "description": "Complete the budget number finalization",
  "direction": "owed_by_me",
  "debtor_name": "Me",
  "creditor_name": "You",
  "priority": "medium",
  "confidence": 0.75,
  "quoted_text": "I'm working on finalizing the budget numbers."
}

Example 4 - Conditional Commitment:
Input: "If the board approves, I'll start the hiring process next week."
Output: {
  "title": "Start hiring process",
  "direction": "owed_by_me",
  "is_conditional": true,
  "condition": "Board approval",
  "due_date_text": "next week",
  "priority": "medium",
  "confidence": 0.85,
  "quoted_text": "If the board approves, I'll start the hiring process next week."
}

Example 5 - Team/Third-party Commitment:
Input: "John mentioned he'd share the Q3 metrics at the meeting."
Output: {
  "title": "Share Q3 metrics",
  "direction": "owed_to_me",
  "debtor_name": "John",
  "priority": "medium",
  "confidence": 0.80,
  "quoted_text": "John mentioned he'd share the Q3 metrics at the meeting."
}"""


def get_commitment_extraction_prompt(
    content: str,
    claims: list[dict],
    user_email: str | None = None,
    user_name: str | None = None,
) -> list[dict]:
    """Build the commitment extraction prompt."""
    user_context = ""
    if user_email:
        user_context = f"\n\nUser email: {user_email}"
    if user_name:
        user_context += f"\nUser name: {user_name}"

    claims_summary = ""
    if claims:
        claims_list = [f"- [{c.get('type', 'claim')}] {c.get('content', '')}" for c in claims[:10]]
        claims_summary = f"\n\nPreviously extracted claims:\n" + "\n".join(claims_list)

    return [
        {"role": "system", "content": COMMITMENT_EXTRACTION_SYSTEM_PROMPT},
        {"role": "user", "content": f"""Extract all commitments from this content.{user_context}{claims_summary}

---
{content}
---

For each commitment, identify:
- Title and description
- Direction (owed_by_me or owed_to_me)
- Debtor and creditor details
- Due date if mentioned
- Whether it's conditional
- Evidence and reasoning"""},
    ]


# =============================================================================
# Decision Extraction Prompt
# =============================================================================

DECISION_EXTRACTION_SYSTEM_PROMPT = """You are an expert at extracting decisions from communication content.

A decision is a choice that has been made, is being made, or needs to be made.

DECISION STATUS:
- made: Already decided and communicated
- pending: Being considered, not yet final
- deferred: Postponed for later
- reversed: Previous decision changed

WHAT TO EXTRACT:
1. Clear decisions ("We've decided to...")
2. Implicit decisions (choices made without explicit statement)
3. Pending decisions ("We need to decide...")
4. Reversals ("Actually, we're changing to...")

FOR EACH DECISION:
- Title: Short, clear name
- Statement: What was decided
- Rationale: Why this decision was made (if stated)
- Decision maker: Who made the decision
- Stakeholders: Who is affected
- Dependencies: What this decision relies on
- Implications: What follows from this decision

GUIDELINES:
1. Distinguish decisions from preferences or opinions
2. Include quoted text as evidence
3. Note when decisions are tentative or reversible
4. Identify all stakeholders affected

EXAMPLES:

Example 1 - Clear Decision Made:
Input: "After reviewing all options, we've decided to go with AWS for our cloud infrastructure."
Output: {
  "title": "Choose AWS for cloud infrastructure",
  "statement": "We will use AWS for our cloud infrastructure",
  "rationale": "After reviewing all options",
  "status": "made",
  "decision_maker_name": "We (team)",
  "stakeholders": ["Engineering", "DevOps", "Finance"],
  "implications": ["Need to migrate existing services", "Update vendor agreements"],
  "confidence": 0.95,
  "quoted_text": "we've decided to go with AWS for our cloud infrastructure"
}

Example 2 - Pending Decision:
Input: "We need to decide on the pricing strategy before the product launch. I'm leaning towards the tiered model."
Output: {
  "title": "Determine pricing strategy",
  "statement": "Pricing strategy needs to be finalized before launch",
  "status": "pending",
  "dependencies": ["Product launch timeline"],
  "implications": ["Revenue model", "Marketing messaging"],
  "confidence": 0.90,
  "quoted_text": "We need to decide on the pricing strategy before the product launch"
}

Example 3 - Implicit Decision:
Input: "Given the timeline constraints, I've scheduled the launch for March 15th instead of April 1st."
Output: {
  "title": "Move launch date to March 15th",
  "statement": "Launch date changed from April 1st to March 15th",
  "rationale": "Timeline constraints",
  "status": "made",
  "decision_maker_name": "Me",
  "implications": ["Compressed preparation timeline", "Earlier marketing push"],
  "confidence": 0.85,
  "quoted_text": "I've scheduled the launch for March 15th instead of April 1st"
}

Example 4 - Decision Reversal:
Input: "Actually, we're not going to use React after all. The team prefers Vue.js."
Output: {
  "title": "Switch from React to Vue.js",
  "statement": "Reversing previous decision to use React; will use Vue.js instead",
  "rationale": "Team preference",
  "status": "reversed",
  "decision_maker_name": "Team",
  "stakeholders": ["Frontend developers", "UX team"],
  "confidence": 0.90,
  "quoted_text": "we're not going to use React after all. The team prefers Vue.js"
}

Example 5 - Deferred Decision:
Input: "Let's table the office expansion discussion until Q2 when we have better visibility into headcount."
Output: {
  "title": "Office expansion",
  "statement": "Office expansion decision postponed to Q2",
  "rationale": "Need better visibility into headcount",
  "status": "deferred",
  "dependencies": ["Q2 headcount planning"],
  "confidence": 0.85,
  "quoted_text": "Let's table the office expansion discussion until Q2"
}"""


def get_decision_extraction_prompt(
    content: str,
    claims: list[dict],
    user_email: str | None = None,
    user_name: str | None = None,
) -> list[dict]:
    """Build the decision extraction prompt."""
    user_context = ""
    if user_email:
        user_context = f"\n\nUser email: {user_email}"
    if user_name:
        user_context += f"\nUser name: {user_name}"

    claims_summary = ""
    if claims:
        decision_claims = [c for c in claims if c.get("type") == "decision"]
        if decision_claims:
            claims_list = [f"- {c.get('content', '')}" for c in decision_claims[:5]]
            claims_summary = f"\n\nDecision-related claims found:\n" + "\n".join(claims_list)

    return [
        {"role": "system", "content": DECISION_EXTRACTION_SYSTEM_PROMPT},
        {"role": "user", "content": f"""Extract all decisions from this content.{user_context}{claims_summary}

---
{content}
---

For each decision, identify:
- Title and statement
- Rationale (if provided)
- Decision maker
- Status (made/pending/deferred/reversed)
- Stakeholders, dependencies, and implications
- Evidence and reasoning"""},
    ]


# =============================================================================
# Risk Detection Prompt
# =============================================================================

# =============================================================================
# Task Extraction Prompt
# =============================================================================

TASK_EXTRACTION_SYSTEM_PROMPT = """You are an expert at extracting actionable tasks from communication content.

A task is something that needs to be done - an action item, to-do, or work that should be tracked and completed.

WHAT TO EXTRACT:
1. Explicit tasks ("Please review the document", "Can you send me the report?")
2. Implicit tasks derived from commitments ("I'll send the report" → task: "Send report")
3. Requests that require action ("Let me know your thoughts" → task: "Provide thoughts")
4. Follow-up items ("We should discuss this further" → task: "Discuss further")

WHAT NOT TO EXTRACT:
- Do NOT create tasks that just restate decisions. Decisions are tracked separately.
- "We decided to increase the budget by 15%" is a DECISION, not a task. Do NOT create a task for it.
- Only create tasks for specific ACTIONS that need to be DONE as follow-up to decisions.
- If a decision requires implementation steps, those steps are tasks. The decision itself is NOT a task.

TASK STATUS:
- todo: Not yet started (default for new tasks)
- in_progress: Already being worked on (if mentioned)
- done: Already completed (if explicitly stated)
- blocked: Waiting on something else

PRIORITY:
- low: Nice to have, no urgency
- medium: Should be done, normal priority (default)
- high: Important, has deadline or significant impact
- urgent: Critical, needs immediate attention

OWNERSHIP:
- Identify WHO should do the task (assignee)
- Identify WHO requested/created the task (created_by)
- Set assignee_is_user=true if the user is the one who should do it

DUE DATES:
- Extract explicit dates when stated
- Convert relative dates (e.g., "by Friday" → actual date if possible)
- Include original text in due_date_text
- Set confidence based on how explicit the date is

EFFORT ESTIMATION:
- Extract effort estimates if mentioned (e.g., "this will take a few hours")
- Use standard formats: "1h", "2d", "1 week"

DEPENDENCIES:
- Identify if tasks depend on each other
- Use depends_on_task_indices to link dependent tasks within same extraction

SUBTASKS:
- If a larger task has smaller components, extract as separate tasks
- Mark subtasks with is_subtask=true and set parent_task_index

PROJECT/TAGS:
- Infer the project or topic the task belongs to
- Add relevant tags for categorization

GUIDELINES:
1. Be thorough - extract ALL actionable items
2. Make task titles clear and actionable (start with verb)
3. Don't duplicate commitments - but do create tasks FROM commitments
4. Include exact quoted text as evidence
5. Provide reasoning for why this is a task"""


def get_task_extraction_prompt(
    content: str,
    commitments: list[dict],
    claims: list[dict],
    decisions: list[dict] | None = None,
    user_email: str | None = None,
    user_name: str | None = None,
) -> list[dict]:
    """Build the task extraction prompt."""
    user_context = ""
    if user_email:
        user_context = f"\n\nUser email: {user_email}"
    if user_name:
        user_context += f"\nUser name: {user_name}"

    context_summary = ""

    if commitments:
        commitment_list = [
            f"- [{c.get('direction', 'unknown')}] {c.get('title', 'Commitment')}: {c.get('description', '')} (due: {c.get('due_date_text', 'no date')})"
            for c in commitments[:10]
        ]
        context_summary += f"\n\nExtracted commitments (create tasks from these):\n" + "\n".join(commitment_list)

    if decisions:
        decision_list = [
            f"- {d.get('title', 'Decision')}: {d.get('statement', '')}"
            for d in decisions[:10]
        ]
        context_summary += f"\n\nExtracted decisions (DO NOT create tasks that restate these - they are already tracked):\n" + "\n".join(decision_list)

    if claims:
        action_claims = [c for c in claims if c.get("type") in ("action_item", "request", "promise")]
        if action_claims:
            claims_list = [f"- [{c.get('type')}] {c.get('content', '')}" for c in action_claims[:5]]
            context_summary += f"\n\nAction-related claims:\n" + "\n".join(claims_list)

    return [
        {"role": "system", "content": TASK_EXTRACTION_SYSTEM_PROMPT},
        {"role": "user", "content": f"""Extract all tasks from this content.{user_context}{context_summary}

---
{content}
---

For each task, identify:
- Clear, actionable title (start with verb)
- Description if needed
- Assignee (who should do it)
- Created by (who requested it)
- Due date if mentioned
- Priority and status
- Project/tags for categorization
- Dependencies on other tasks
- Evidence and reasoning

Create tasks from:
1. Explicit requests and action items
2. Commitments that need to be fulfilled
3. Follow-up items from decisions
4. Implied work that needs to be done"""},
    ]


RISK_DETECTION_SYSTEM_PROMPT = """You are an expert at detecting risks and potential issues in communication content.

RISK TYPES:
- deadline_risk: Commitments with tight or missed deadlines
- commitment_conflict: Overlapping or contradictory commitments
- unclear_ownership: No clear owner for a task or decision
- missing_information: Key details are missing
- escalation_needed: Situation requires higher authority
- policy_violation: Potential breach of rules/policies
- financial_risk: Money-related concerns
- relationship_risk: Potential damage to relationships
- sensitive_data: PII or confidential info exposed
- contradiction: Conflicting statements
- fraud_signal: Suspicious patterns
- other: Other risks

SEVERITY:
- low: Minor concern, monitor
- medium: Should be addressed soon
- high: Requires prompt attention
- critical: Immediate action needed

GUIDELINES:
1. Consider the extracted commitments and decisions
2. Look for timeline conflicts
3. Identify missing owners or unclear responsibilities
4. Note when information seems incomplete
5. Flag contradictions between statements
6. Suggest specific actions to mitigate each risk"""


def get_risk_detection_prompt(
    content: str,
    commitments: list[dict],
    decisions: list[dict],
    user_email: str | None = None,
) -> list[dict]:
    """Build the risk detection prompt."""
    user_context = ""
    if user_email:
        user_context = f"\n\nUser email: {user_email}"

    context_summary = ""

    if commitments:
        commitment_list = [
            f"- {c.get('title', 'Commitment')}: {c.get('description', '')} (due: {c.get('due_date_text', 'no date')})"
            for c in commitments[:5]
        ]
        context_summary += f"\n\nExtracted commitments:\n" + "\n".join(commitment_list)

    if decisions:
        decision_list = [
            f"- {d.get('title', 'Decision')}: {d.get('statement', '')} (status: {d.get('status', 'unknown')})"
            for d in decisions[:5]
        ]
        context_summary += f"\n\nExtracted decisions:\n" + "\n".join(decision_list)

    return [
        {"role": "system", "content": RISK_DETECTION_SYSTEM_PROMPT},
        {"role": "user", "content": f"""Analyze this content for risks and potential issues.{user_context}{context_summary}

---
{content}
---

For each risk, identify:
- Type and severity
- Title and description
- Related commitments or decisions
- Suggested action
- Evidence and reasoning"""},
    ]
