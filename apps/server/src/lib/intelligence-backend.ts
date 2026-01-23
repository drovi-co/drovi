/**
 * Python Intelligence Backend Client
 *
 * HTTP client for calling the Python AI backend that handles
 * intelligence extraction via LangGraph.
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const INTELLIGENCE_BACKEND_URL =
  process.env.INTELLIGENCE_BACKEND_URL ?? "http://localhost:8000";

// =============================================================================
// TYPES
// =============================================================================

export interface AnalyzeRequest {
  content: string;
  organization_id: string;
  source_type: string;
  source_id?: string;
  source_account_id?: string;
  conversation_id?: string;
  message_ids?: string[];
  user_email?: string;
  user_name?: string;
}

export interface ExtractedClaim {
  id: string;
  text: string;
  type: string;
  confidence: number;
  quoted_text?: string;
}

export interface ExtractedCommitment {
  id: string;
  title: string;
  description?: string;
  direction: string;
  priority: string;
  owner_name?: string;
  owner_email?: string;
  due_date?: string;
  confidence: number;
  quoted_text?: string;
}

export interface ExtractedDecision {
  id: string;
  title: string;
  statement: string;
  rationale?: string;
  status: string;
  confidence: number;
  quoted_text?: string;
}

export interface ExtractedTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  assignee_name?: string;
  assignee_email?: string;
  due_date?: string;
  commitment_id?: string;
  confidence: number;
}

export interface ExtractedRisk {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: string;
  suggested_action?: string;
  confidence: number;
}

export interface ExtractedContact {
  id: string;
  name: string;
  email?: string;
  role?: string;
  organization?: string;
}

export interface AnalyzeResponse {
  analysis_id: string;
  claims: ExtractedClaim[];
  commitments: ExtractedCommitment[];
  decisions: ExtractedDecision[];
  tasks: ExtractedTask[];
  risks: ExtractedRisk[];
  contacts: ExtractedContact[];
  overall_confidence: number;
  duration_ms: number;
  needs_review: boolean;
}

export interface IntelligenceBackendError {
  error: string;
  detail?: string;
  status_code?: number;
}

// =============================================================================
// CLIENT FUNCTIONS
// =============================================================================

/**
 * Call the Python intelligence backend to analyze content.
 *
 * @param request - The analysis request
 * @returns The analysis response with extracted intelligence
 * @throws Error if the backend call fails
 */
export async function callPythonIntelligence(
  request: AnalyzeRequest
): Promise<AnalyzeResponse> {
  const url = `${INTELLIGENCE_BACKEND_URL}/api/v1/analyze`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    let errorMessage = `Intelligence backend error: ${response.status}`;

    try {
      const errorBody = (await response.json()) as IntelligenceBackendError;
      if (errorBody.detail) {
        errorMessage = `${errorMessage} - ${errorBody.detail}`;
      }
    } catch {
      // Ignore JSON parse errors
    }

    throw new Error(errorMessage);
  }

  return response.json() as Promise<AnalyzeResponse>;
}

/**
 * Check if the Python intelligence backend is healthy.
 *
 * @returns true if the backend is healthy, false otherwise
 */
export async function checkIntelligenceBackendHealth(): Promise<boolean> {
  try {
    const url = `${INTELLIGENCE_BACKEND_URL}/health`;
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Stream analysis results from the Python backend.
 *
 * @param request - The analysis request
 * @param onEvent - Callback for each SSE event
 */
export async function streamPythonIntelligence(
  request: AnalyzeRequest,
  onEvent: (event: { type: string; data: unknown }) => void
): Promise<void> {
  const url = `${INTELLIGENCE_BACKEND_URL}/api/v1/analyze/stream`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Intelligence backend error: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    // Process complete SSE events
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          onEvent({ type: "data", data });
        } catch {
          // Ignore invalid JSON
        }
      } else if (line.startsWith("event: ")) {
        const eventType = line.slice(7);
        onEvent({ type: eventType, data: null });
      }
    }
  }
}
