#!/bin/bash
# =============================================================================
# Graph Integration Test Script
# Tests all graph features against seeded data
# =============================================================================

TOKEN="X-Internal-Service-Token: dev-test-token-drovi-2024"
ORG="dcb75260-c4bd-421f-8d14-c26d5c670b53"
BASE="http://localhost:8000/api/v1"

echo "================================================================"
echo "  DROVI INTELLIGENCE - GRAPH INTEGRATION TESTS"
echo "================================================================"
echo ""

# ----- TEST 1: Graph Stats -----
echo ">>> TEST 1: Graph Stats"
curl -s -H "$TOKEN" "$BASE/graph/stats?organization_id=$ORG" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if d.get('success'):
    print('  Node counts:')
    for n in d.get('node_counts', []):
        print(f'    {n[\"nodeType\"]:25s} {n[\"count\"]:>5}')
    print('  Relationship counts:')
    for r in d.get('relationship_counts', []):
        print(f'    {r[\"relType\"]:25s} {r[\"count\"]:>5}')
else:
    print(f'  Error: {d}')
"
echo ""

# ----- TEST 2: Influential Contacts (PageRank) -----
echo ">>> TEST 2: Most Influential Contacts (PageRank)"
curl -s -H "$TOKEN" "$BASE/analytics/graph/influential/$ORG?limit=5" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for c in d.get('contacts', []):
    print(f'  {c[\"name\"]:30s} PR={c[\"influence_score\"]:.4f}  bridge={c.get(\"bridge_score\",0):.4f}  {c[\"company\"]}')
print(f'  Algorithm: {d.get(\"algorithm\")}')
"
echo ""

# ----- TEST 3: Bridge Connectors (Betweenness Centrality) -----
echo ">>> TEST 3: Bridge Connectors (Betweenness)"
curl -s -H "$TOKEN" "$BASE/analytics/graph/bridges/$ORG?limit=5" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for b in d.get('connectors', []):
    print(f'  {b[\"name\"]:30s} bridge={b[\"bridge_score\"]:.4f}  community={b.get(\"community_id\",\"?\")}  {b[\"company\"]}')
print(f'  Algorithm: {d.get(\"algorithm\")}')
"
echo ""

# ----- TEST 4: Communities -----
echo ">>> TEST 4: Communication Communities"
curl -s -H "$TOKEN" "$BASE/analytics/graph/communities/$ORG?min_size=3" | python3 -c "
import json, sys
d = json.load(sys.stdin)
clusters = d.get('clusters', [])
print(f'  Total clusters: {len(clusters)}')
for c in clusters[:5]:
    members = [m['name'] for m in c.get('members', [])[:3]]
    print(f'  {c[\"cluster_id\"]}: {len(c.get(\"members\",[]))} members - {\", \".join(members)}...')
"
echo ""

# ----- TEST 5: Pending Commitments with Owners -----
echo ">>> TEST 5: Pending Commitments with Owners (Cypher Query)"
curl -s -H "$TOKEN" -X POST "$BASE/graph/query" \
  -H "Content-Type: application/json" \
  -d "{\"cypher\": \"MATCH (c:Commitment {organizationId: '$ORG'})-[:OWNED_BY]->(p:Contact) WHERE c.status = 'pending' RETURN c.title as title, c.priority as priority, p.name as owner, p.company as company ORDER BY c.priority DESC LIMIT 5\", \"organization_id\": \"$ORG\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('results', []):
    print(f'  [{r.get(\"priority\",\"?\")}] {str(r.get(\"title\",\"?\"))[:55]}')
    print(f'       Owner: {r.get(\"owner\")} @ {r.get(\"company\")}')
if not d.get('results'): print(f'  Raw: {json.dumps(d)[:200]}')
"
echo ""

# ----- TEST 6: Decisions with Owners -----
echo ">>> TEST 6: Recent Decisions with Owners"
curl -s -H "$TOKEN" -X POST "$BASE/graph/query" \
  -H "Content-Type: application/json" \
  -d "{\"cypher\": \"MATCH (d:Decision {organizationId: '$ORG'})-[:OWNED_BY]->(c:Contact) RETURN d.title as decision, c.name as owner, c.company as company, d.status as status ORDER BY d.createdAt DESC LIMIT 5\", \"organization_id\": \"$ORG\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('results', []):
    print(f'  [{r.get(\"status\")}] {str(r.get(\"decision\",\"?\"))[:60]}')
    print(f'       Owner: {r.get(\"owner\")} @ {r.get(\"company\")}')
if not d.get('results'): print(f'  Raw: {json.dumps(d)[:200]}')
"
echo ""

# ----- TEST 7: Risks Threatening Decisions -----
echo ">>> TEST 7: Risks Threatening Decisions"
curl -s -H "$TOKEN" -X POST "$BASE/graph/query" \
  -H "Content-Type: application/json" \
  -d "{\"cypher\": \"MATCH (r:Risk {organizationId: '$ORG'})-[:THREATENS]->(d:Decision) RETURN r.title as risk, r.severity as severity, d.title as decision LIMIT 5\", \"organization_id\": \"$ORG\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('results', []):
    print(f'  [{r.get(\"severity\")}] {str(r.get(\"risk\",\"?\"))[:55]}')
    print(f'       Threatens: {str(r.get(\"decision\",\"?\"))[:55]}')
if not d.get('results'): print(f'  Raw: {json.dumps(d)[:200]}')
"
echo ""

# ----- TEST 8: Communication Network -----
echo ">>> TEST 8: Top Communication Channels"
curl -s -H "$TOKEN" -X POST "$BASE/graph/query" \
  -H "Content-Type: application/json" \
  -d "{\"cypher\": \"MATCH (a:Contact {organizationId: '$ORG'})-[r:COMMUNICATES_WITH]->(b:Contact) RETURN a.name as from_name, a.company as from_co, b.name as to_name, b.company as to_co, r.count as msgs, r.sentimentAvg as sentiment ORDER BY r.count DESC LIMIT 5\", \"organization_id\": \"$ORG\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('results', []):
    print(f'  {r.get(\"from_name\")} ({r.get(\"from_co\")}) -> {r.get(\"to_name\")} ({r.get(\"to_co\")})')
    print(f'       Messages: {r.get(\"msgs\")}, Sentiment: {r.get(\"sentiment\")}')
if not d.get('results'): print(f'  Raw: {json.dumps(d)[:200]}')
"
echo ""

# ----- TEST 9: Tasks Fulfilling Commitments -----
echo ">>> TEST 9: Tasks Fulfilling Commitments"
curl -s -H "$TOKEN" -X POST "$BASE/graph/query" \
  -H "Content-Type: application/json" \
  -d "{\"cypher\": \"MATCH (t:Task {organizationId: '$ORG'})-[f:FULFILLS]->(c:Commitment) RETURN t.title as task, t.status as task_status, c.title as commitment, c.status as commitment_status, f.completionPercentage as completion ORDER BY f.completionPercentage DESC LIMIT 5\", \"organization_id\": \"$ORG\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('results', []):
    print(f'  Task: {str(r.get(\"task\",\"?\"))[:50]} [{r.get(\"task_status\")}]')
    print(f'       Fulfills: {str(r.get(\"commitment\",\"?\"))[:50]} [{r.get(\"commitment_status\")}]')
    print(f'       Completion: {r.get(\"completion\")}%')
if not d.get('results'): print(f'  Raw: {json.dumps(d)[:200]}')
"
echo ""

# ----- TEST 10: Multi-hop Graph Traversal -----
echo ">>> TEST 10: Multi-hop - Contacts -> Commitments -> Risks"
curl -s -H "$TOKEN" -X POST "$BASE/graph/query" \
  -H "Content-Type: application/json" \
  -d "{\"cypher\": \"MATCH (contact:Contact {organizationId: '$ORG'})<-[:OWNED_BY]-(commitment:Commitment)<-[:THREATENS]-(risk:Risk) RETURN contact.name as person, contact.company as company, commitment.title as commitment, risk.title as risk, risk.severity as severity LIMIT 5\", \"organization_id\": \"$ORG\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('results', []):
    print(f'  Person: {r.get(\"person\")} @ {r.get(\"company\")}')
    print(f'       Commitment: {str(r.get(\"commitment\",\"?\"))[:50]}')
    print(f'       Threatened by: [{r.get(\"severity\")}] {str(r.get(\"risk\",\"?\"))[:50]}')
if not d.get('results'): print(f'  Raw: {json.dumps(d)[:200]}')
"
echo ""

# ----- TEST 11: Active Threads -----
echo ">>> TEST 11: Active Threads with Intelligence"
curl -s -H "$TOKEN" -X POST "$BASE/graph/query" \
  -H "Content-Type: application/json" \
  -d "{\"cypher\": \"MATCH (t:ThreadContext {organizationId: '$ORG'}) WHERE t.status = 'active' RETURN t.subject as subject, t.messageCount as messages, t.participantCount as participants, t.priority as priority, t.urgencyScore as urgency ORDER BY t.urgencyScore DESC LIMIT 5\", \"organization_id\": \"$ORG\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('results', []):
    print(f'  [{r.get(\"priority\")}] {str(r.get(\"subject\",\"?\"))[:50]}')
    print(f'       Messages: {r.get(\"messages\")}, Participants: {r.get(\"participants\")}, Urgency: {r.get(\"urgency\")}')
if not d.get('results'): print(f'  Raw: {json.dumps(d)[:200]}')
"
echo ""

# ----- TEST 12: Cross-company Communication -----
echo ">>> TEST 12: Cross-company Communication Patterns"
curl -s -H "$TOKEN" -X POST "$BASE/graph/query" \
  -H "Content-Type: application/json" \
  -d "{\"cypher\": \"MATCH (a:Contact {organizationId: '$ORG'})-[r:COMMUNICATES_WITH]->(b:Contact {organizationId: '$ORG'}) WHERE a.company <> b.company RETURN a.company as company_a, b.company as company_b, count(r) as connections, avg(r.count) as avg_msgs ORDER BY connections DESC LIMIT 8\", \"organization_id\": \"$ORG\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('results', []):
    print(f'  {r.get(\"company_a\")} <-> {r.get(\"company_b\")}: {r.get(\"connections\")} links, avg {float(r.get(\"avg_msgs\",0)):.0f} msgs')
if not d.get('results'): print(f'  Raw: {json.dumps(d)[:200]}')
"
echo ""

# ----- TEST 13: Full-text Search in Raw Messages -----
echo ">>> TEST 13: Raw Message Search (Full-text)"
curl -s -H "$TOKEN" -X POST "$BASE/graph/query" \
  -H "Content-Type: application/json" \
  -d "{\"cypher\": \"MATCH (m:RawMessage {organizationId: '$ORG'}) WHERE m.content CONTAINS 'Following up' OR m.content CONTAINS 'conversation' RETURN m.subject as subject, m.senderName as sender, m.sentAt as sent ORDER BY m.sentAt DESC LIMIT 5\", \"organization_id\": \"$ORG\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('results', []):
    print(f'  [{str(r.get(\"sent\",\"?\"))[:10]}] {r.get(\"sender\")}: {str(r.get(\"subject\",\"?\"))[:50]}')
if not d.get('results'): print(f'  Raw: {json.dumps(d)[:200]}')
"
echo ""

# ----- TEST 14: Entity Knowledge Graph -----
echo ">>> TEST 14: Entity Knowledge Graph"
curl -s -H "$TOKEN" -X POST "$BASE/graph/query" \
  -H "Content-Type: application/json" \
  -d "{\"cypher\": \"MATCH (e:Entity {organizationId: '$ORG'}) RETURN e.name as name, e.entityType as type, e.relevanceScore as relevance ORDER BY e.relevanceScore DESC LIMIT 8\", \"organization_id\": \"$ORG\"}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('results', []):
    print(f'  [{r.get(\"type\")}] {r.get(\"name\"):35s} relevance={r.get(\"relevance\")}')
if not d.get('results'): print(f'  Raw: {json.dumps(d)[:200]}')
"
echo ""

# ----- TEST 15: Run Analytics -----
echo ">>> TEST 15: Trigger Graph Analytics (Run)"
curl -s -H "$TOKEN" -X POST "$BASE/analytics/graph/run-analytics/$ORG" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'  Status: {d.get(\"status\", \"unknown\")}')
for k, v in d.items():
    if k != 'status':
        print(f'  {k}: {v}')
"
echo ""

echo "================================================================"
echo "  ALL TESTS COMPLETE"
echo "================================================================"
