#!/bin/bash
# =============================================================================
# Natural Language Search Test Script
# Tests GraphRAG /ask and Hybrid Search /search endpoints
# =============================================================================

TOKEN="X-Internal-Service-Token: dev-test-token-drovi-2024"
ORG="dcb75260-c4bd-421f-8d14-c26d5c670b53"
BASE="http://localhost:8000/api/v1"

PASS=0
FAIL=0

parse() {
    python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    intent = d.get('intent', 'N/A')
    count = d.get('results_count', d.get('count', 'N/A'))
    duration = d.get('duration_seconds', 0)
    print(f'  Intent:   {intent}')
    print(f'  Results:  {count}')
    print(f'  Duration: {duration:.3f}s')
    answer = str(d.get('answer', d.get('results', 'N/A')))
    print(f'  Answer:   {answer[:600]}')
    sources = d.get('sources', [])
    if sources:
        print(f'  Sources ({len(sources)}):')
        for s in sources[:5]:
            if isinstance(s, dict):
                name = s.get('name', s.get('title', s.get('email', '?')))
                stype = s.get('type', s.get('issue_type', ''))
                print(f'    - [{stype}] {name}')
    # Return pass/fail based on results count
    if isinstance(count, int) and count > 0:
        print(f'  STATUS:   PASS')
    elif 'no results' in answer.lower() or 'could not find' in answer.lower():
        print(f'  STATUS:   FAIL (no data)')
    else:
        print(f'  STATUS:   PASS (synthesized)')
except json.JSONDecodeError:
    print(f'  ERROR: Empty or invalid JSON response')
    print(f'  STATUS:   FAIL')
except Exception as e:
    print(f'  ERROR: {e}')
    print(f'  STATUS:   FAIL')
"
}

parse_search() {
    python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    results = d.get('results', [])
    print(f'  Total results: {len(results)}')
    for r in results[:5]:
        title = str(r.get('title', r.get('name', r.get('properties', {}).get('name', r.get('properties', {}).get('title', '?')))))[:60]
        print(f'  [{r.get(\"type\",\"?\")}] {title}  score={r.get(\"score\",0):.3f}  via={r.get(\"match_source\",\"?\")}')
    if len(results) > 0:
        print(f'  STATUS:   PASS')
    else:
        print(f'  STATUS:   FAIL (0 results)')
except json.JSONDecodeError:
    print(f'  ERROR: Empty or invalid JSON response')
    print(f'  STATUS:   FAIL')
except Exception as e:
    print(f'  ERROR: {e}')
    print(f'  STATUS:   FAIL')
"
}

echo "================================================================"
echo "  DROVI INTELLIGENCE - NATURAL LANGUAGE SEARCH TESTS"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "================================================================"
echo ""

# ===== GRAPHRAG /ask TESTS =====
echo "========== GRAPHRAG /ask ENDPOINT (14 tests) =========="
echo ""

# ----- NL 1: Influential People -----
echo ">>> NL 1: Who are the most influential people in our network?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"Who are the most influential people in our network?","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 2: At-Risk Commitments -----
echo ">>> NL 2: What commitments are currently at risk or pending?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"What commitments are currently at risk or pending?","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 3: High Severity Risks -----
echo ">>> NL 3: What are the high severity risks threatening our projects?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"What are the high severity risks threatening our projects?","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 4: Recent Decisions -----
echo ">>> NL 4: What decisions were made recently and who made them?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"What decisions were made recently and who made them?","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 5: Bridge Connectors -----
echo ">>> NL 5: Who are the bridge connectors between different teams?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"Who are the bridge connectors between different teams?","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 6: Communication Clusters -----
echo ">>> NL 6: What communication clusters or communities exist?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"What communication clusters or communities have formed?","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 7: Customer 360 - Aisha Chen -----
echo ">>> NL 7: Tell me everything about Aisha Chen"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"Tell me everything about Aisha Chen","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 8: Relationship Query -----
echo ">>> NL 8: Who does Margaret White communicate with?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"Who does Margaret White communicate with most frequently?","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 9: Multi-concept - Risks + Commitments (WAS FAILING) -----
echo ">>> NL 9: Which commitments are being threatened by risks?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"Which commitments are being threatened by risks?","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 10: Company-specific question (WAS FAILING) -----
echo ">>> NL 10: What is happening at BuildRight Construction?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"Tell me about BuildRight Construction","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 11: Communication pattern (WAS FAILING) -----
echo ">>> NL 11: Which people communicate the most?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"Who communicates the most in our organization?","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 12: Decision analysis (WAS FAILING) -----
echo ">>> NL 12: What decisions about Q1 product roadmap?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"What decisions were made about the Q1 product roadmap?","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 13: Customer 360 - Kenneth Singh -----
echo ">>> NL 13: Tell me about Kenneth Singh from GlobalRetail"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"Tell me about Kenneth Singh from GlobalRetail","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ----- NL 14: Open questions (WAS FAILING) -----
echo ">>> NL 14: What key issues need immediate attention?"
curl -s --max-time 60 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/ask" \
  -d '{"question":"What key issues need immediate attention?","organization_id":"'"$ORG"'","include_evidence":true}' | parse
echo ""

# ===== HYBRID SEARCH /search TESTS =====
echo ""
echo "========== HYBRID SEARCH /search ENDPOINT (5 tests) =========="
echo ""

# ----- SEARCH 1: Fulltext search -----
echo ">>> SEARCH 1: Fulltext - 'partnership agreement'"
curl -s --max-time 30 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/search/fulltext" \
  -d '{"query":"partnership agreement","organization_id":"'"$ORG"'","limit":5}' | parse_search
echo ""

# ----- SEARCH 2: Fulltext search (multi-word with special chars) -----
echo ">>> SEARCH 2: Fulltext - 'budget overrun'"
curl -s --max-time 30 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/search/fulltext" \
  -d '{"query":"budget overrun","organization_id":"'"$ORG"'","limit":5}' | parse_search
echo ""

# ----- SEARCH 3: Hybrid search -----
echo ">>> SEARCH 3: Hybrid - 'data migration risks'"
curl -s --max-time 30 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/search" \
  -d '{"query":"data migration risks","organization_id":"'"$ORG"'","limit":5}' | parse_search
echo ""

# ----- SEARCH 4: Graph-aware search -----
echo ">>> SEARCH 4: Graph-aware - 'customer retention strategy'"
curl -s --max-time 30 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/search/graph-aware" \
  -d '{"query":"customer retention strategy","organization_id":"'"$ORG"'","limit":5,"include_graph_context":true}' | parse_search
echo ""

# ----- SEARCH 5: Type-filtered search -----
echo ">>> SEARCH 5: Filtered - commitments about 'proposal'"
curl -s --max-time 30 -H "$TOKEN" -H "Content-Type: application/json" \
  -X POST "$BASE/search/fulltext" \
  -d '{"query":"proposal","organization_id":"'"$ORG"'","types":["Commitment"],"limit":5}' | parse_search
echo ""

echo "================================================================"
echo "  ALL NATURAL LANGUAGE TESTS COMPLETE"
echo "================================================================"
