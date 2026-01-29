#!/usr/bin/env python3
"""
FalkorDB Graph Seeder

Drops and reseeds the graph with realistic, complex data for testing:
- Natural language queries (GraphRAG)
- Graph analytics (PageRank, communities, betweenness)
- Communication patterns
- Intelligence extraction
- Temporal queries
- Multi-hop search

Usage:
    python scripts/seed_graph.py
    # or
    python scripts/seed_graph.py --org-count 3 --contacts-per-org 50
"""

import asyncio
import random
import uuid
from datetime import datetime, timedelta
from typing import Any

import structlog

# Configure logging
structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(20),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
)

logger = structlog.get_logger()

# =============================================================================
# Realistic Data Templates
# =============================================================================

COMPANIES = [
    ("Acme Corp", "acme.com", "Enterprise Software"),
    ("TechVentures", "techventures.io", "Venture Capital"),
    ("GlobalRetail Inc", "globalretail.com", "Retail"),
    ("DataFlow Systems", "dataflow.io", "Data Analytics"),
    ("CloudNine Solutions", "cloudnine.tech", "Cloud Infrastructure"),
    ("FinanceFirst", "financefirst.com", "Financial Services"),
    ("HealthTech Labs", "healthtechlabs.com", "Healthcare Technology"),
    ("EduLearn Platform", "edulearn.io", "EdTech"),
    ("GreenEnergy Co", "greenenergy.com", "Renewable Energy"),
    ("MediaMax Studios", "mediamax.tv", "Media & Entertainment"),
    ("LogiTrans Global", "logitrans.com", "Logistics"),
    ("SecureNet Systems", "securenet.io", "Cybersecurity"),
    ("AI Innovations", "aiinnovations.ai", "Artificial Intelligence"),
    ("BuildRight Construction", "buildright.co", "Construction"),
    ("FoodTech Ventures", "foodtech.io", "Food Technology"),
]

FIRST_NAMES = [
    "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
    "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
    "Thomas", "Sarah", "Charles", "Karen", "Christopher", "Nancy", "Daniel", "Lisa",
    "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley",
    "Steven", "Kimberly", "Paul", "Emily", "Andrew", "Donna", "Joshua", "Michelle",
    "Kenneth", "Dorothy", "Kevin", "Carol", "Brian", "Amanda", "George", "Melissa",
    "Edward", "Deborah", "Alex", "Priya", "Wei", "Fatima", "Carlos", "Yuki",
    "Ahmed", "Sofia", "Raj", "Ingrid", "Omar", "Elena", "Jin", "Aisha",
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
    "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
    "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker",
    "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill",
    "Flores", "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell",
    "Mitchell", "Carter", "Roberts", "Chen", "Patel", "Kumar", "Singh", "Kim",
    "Yamamoto", "Mueller", "Johansson", "Petrov", "Costa", "Nakamura", "Schmidt",
]

TITLES = [
    "CEO", "CTO", "CFO", "COO", "VP of Engineering", "VP of Sales", "VP of Marketing",
    "Director of Product", "Director of Engineering", "Director of Operations",
    "Senior Product Manager", "Product Manager", "Engineering Manager",
    "Senior Software Engineer", "Software Engineer", "Data Scientist",
    "Account Executive", "Sales Manager", "Customer Success Manager",
    "Marketing Manager", "Head of Growth", "Head of Partnerships",
    "General Counsel", "HR Director", "Finance Manager",
]

COMMITMENT_TEMPLATES = [
    ("Send the updated proposal by {date}", "owed_by_me", "high"),
    ("Review the contract terms", "owed_by_me", "medium"),
    ("Provide feedback on the product demo", "owed_to_me", "medium"),
    ("Schedule a follow-up meeting", "owed_by_me", "low"),
    ("Share the pricing breakdown", "owed_by_me", "high"),
    ("Get approval from legal team", "owed_to_me", "high"),
    ("Deliver the Q{quarter} roadmap presentation", "owed_by_me", "urgent"),
    ("Finalize the partnership agreement", "owed_to_me", "high"),
    ("Send the technical specifications", "owed_by_me", "medium"),
    ("Complete the security audit questionnaire", "owed_to_me", "high"),
    ("Provide customer references", "owed_to_me", "medium"),
    ("Share the implementation timeline", "owed_by_me", "high"),
    ("Confirm the pilot program dates", "owed_to_me", "medium"),
    ("Send the updated SLA document", "owed_by_me", "medium"),
    ("Get sign-off from procurement", "owed_to_me", "high"),
]

DECISION_TEMPLATES = [
    ("Decided to proceed with {vendor} for the {project} project", "made"),
    ("Selected {technology} as the primary {category} solution", "made"),
    ("Approved the budget increase for Q{quarter}", "made"),
    ("Chose to delay the launch until {date}", "made"),
    ("Agreed to extend the pilot program by {weeks} weeks", "made"),
    ("Confirmed {name} as the project lead", "made"),
    ("Decided to prioritize {feature} over {other_feature}", "made"),
    ("Approved the hiring of {count} additional engineers", "made"),
    ("Selected the enterprise tier for the subscription", "made"),
    ("Agreed on a {discount}% discount for annual commitment", "made"),
    ("Postponed decision on {topic} until further review", "deferred"),
    ("Considering options for {category} - decision pending", "pending"),
]

RISK_TEMPLATES = [
    ("Budget overrun risk - current spend {percent}% above forecast", "high", "budget"),
    ("Timeline slippage - {weeks} weeks behind schedule", "high", "timeline"),
    ("Key stakeholder {name} may leave the project", "medium", "stakeholder"),
    ("Integration complexity higher than estimated", "medium", "technical"),
    ("Competitor {competitor} launching similar product", "high", "competitive"),
    ("Resource constraint - team capacity at {percent}%", "medium", "resource"),
    ("Regulatory compliance deadline approaching", "high", "compliance"),
    ("Data migration complexity underestimated", "medium", "technical"),
    ("Customer satisfaction declining - NPS dropped to {score}", "high", "customer"),
    ("Vendor dependency risk with {vendor}", "medium", "vendor"),
]

TASK_TEMPLATES = [
    "Complete the API integration documentation",
    "Review and approve the design mockups",
    "Set up the staging environment",
    "Conduct user acceptance testing",
    "Prepare the executive summary",
    "Update the project timeline",
    "Schedule training sessions for the team",
    "Finalize the go-live checklist",
    "Create the data migration scripts",
    "Document the rollback procedures",
    "Configure the monitoring dashboards",
    "Test the backup and recovery process",
]

MESSAGE_TEMPLATES = [
    """Hi {recipient},

Hope this email finds you well. Following up on our conversation last week about the {topic}.

I wanted to share some updates:
- {update1}
- {update2}
- {update3}

Let me know if you have any questions or if we should schedule a call to discuss further.

Best regards,
{sender}""",

    """Dear {recipient},

Thank you for taking the time to meet with us yesterday. I really appreciated your insights on {topic}.

As discussed, here are the next steps:
1. {action1}
2. {action2}
3. {action3}

I'll send over the {document} by {date}. Please let me know if you need anything else in the meantime.

Warm regards,
{sender}""",

    """Hey {recipient},

Quick update on the {project} project - we're making good progress!

The team has completed {achievement} and we're now focused on {next_phase}.
Current timeline looks like we'll hit our {milestone} milestone by {date}.

One thing I wanted to flag: {concern}. Can we chat about this tomorrow?

Thanks,
{sender}""",

    """Hi {recipient},

I wanted to circle back on the {topic} we discussed. After reviewing with the team, here's what we're thinking:

{proposal}

This approach would allow us to {benefit1} while also {benefit2}.

The estimated timeline is {timeline} and budget is approximately ${budget}.

Would love to get your thoughts. Are you available for a call this week?

Best,
{sender}""",

    """{recipient},

Urgent: Need your input on {topic} before EOD today.

The key question is: {question}

Options we're considering:
A) {option_a}
B) {option_b}
C) {option_c}

My recommendation is Option {recommended} because {rationale}.

Can you confirm your preference?

Thanks,
{sender}""",
]

TOPICS = [
    "Q1 product roadmap", "enterprise integration", "pricing strategy",
    "partnership expansion", "technical architecture", "customer onboarding",
    "security compliance", "data migration", "API development", "mobile app launch",
    "marketing campaign", "sales enablement", "customer retention", "feature prioritization",
    "infrastructure scaling", "vendor evaluation", "budget planning", "team expansion",
    "process automation", "analytics dashboard", "user experience redesign",
]

ENTITY_TYPES = ["project", "product", "technology", "process", "system", "team"]

# =============================================================================
# Seed Data Generator
# =============================================================================


class GraphSeeder:
    """Generates and seeds realistic graph data."""

    def __init__(self, graph):
        self.graph = graph
        self.organizations: list[dict] = []
        self.contacts: dict[str, list[dict]] = {}  # org_id -> contacts
        self.episodes: dict[str, list[dict]] = {}
        self.entities: dict[str, list[dict]] = {}
        self.commitments: dict[str, list[dict]] = {}
        self.decisions: dict[str, list[dict]] = {}
        self.risks: dict[str, list[dict]] = {}
        self.tasks: dict[str, list[dict]] = {}
        self.raw_messages: dict[str, list[dict]] = {}
        self.threads: dict[str, list[dict]] = {}
        self.communication_events: dict[str, list[dict]] = {}

    def _uid(self) -> str:
        """Generate a unique ID."""
        return str(uuid.uuid4())

    def _random_date(self, days_back: int = 90, days_forward: int = 30) -> datetime:
        """Generate a random date within range."""
        delta = random.randint(-days_back, days_forward)
        return datetime.utcnow() + timedelta(days=delta)

    def _random_past_date(self, days_back: int = 90) -> datetime:
        """Generate a random past date."""
        delta = random.randint(1, days_back)
        return datetime.utcnow() - timedelta(days=delta)

    def _random_future_date(self, days_forward: int = 60) -> datetime:
        """Generate a random future date."""
        delta = random.randint(1, days_forward)
        return datetime.utcnow() + timedelta(days=delta)

    # =========================================================================
    # Data Generation
    # =========================================================================

    def generate_organizations(self, count: int = 2) -> list[dict]:
        """Generate organization data."""
        orgs = []
        for i in range(count):
            org_id = self._uid()
            org = {
                "id": org_id,
                "name": f"Organization {i + 1}",
                "createdAt": datetime.utcnow().isoformat(),
            }
            orgs.append(org)
        self.organizations = orgs
        return orgs

    def generate_contacts(self, org_id: str, count: int = 50) -> list[dict]:
        """Generate contact data for an organization."""
        contacts = []
        used_emails = set()

        for _ in range(count):
            first_name = random.choice(FIRST_NAMES)
            last_name = random.choice(LAST_NAMES)
            company, domain, industry = random.choice(COMPANIES)

            # Ensure unique email
            base_email = f"{first_name.lower()}.{last_name.lower()}@{domain}"
            email = base_email
            counter = 1
            while email in used_emails:
                email = f"{first_name.lower()}.{last_name.lower()}{counter}@{domain}"
                counter += 1
            used_emails.add(email)

            contact = {
                "id": self._uid(),
                "organizationId": org_id,
                "email": email,
                "name": f"{first_name} {last_name}",
                "displayName": f"{first_name} {last_name}",
                "company": company,
                "title": random.choice(TITLES),
                "industry": industry,
                "lifecycleStage": random.choice([
                    "lead", "prospect", "opportunity", "customer", "partner"
                ]),
                "roleType": random.choice([
                    "decision_maker", "influencer", "champion", "end_user", "evaluator"
                ]),
                "seniorityLevel": random.choice([
                    "ic", "manager", "senior_manager", "director", "vp", "c_level"
                ]),
                "healthScore": round(random.uniform(0.3, 1.0), 2),
                "engagementScore": round(random.uniform(0.2, 1.0), 2),
                "sentimentScore": round(random.uniform(-0.3, 0.8), 2),
                "isVip": random.random() < 0.15,
                "interactionCount": random.randint(5, 200),
                "lastInteraction": self._random_past_date(30).isoformat(),
                "createdAt": self._random_past_date(180).isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
            }
            contacts.append(contact)

        self.contacts[org_id] = contacts
        return contacts

    def generate_communication_relationships(self, org_id: str) -> list[dict]:
        """Generate realistic communication relationships between contacts."""
        contacts = self.contacts.get(org_id, [])
        if len(contacts) < 2:
            return []

        relationships = []

        # Group contacts by company for more realistic communication patterns
        by_company: dict[str, list[dict]] = {}
        for c in contacts:
            company = c.get("company", "Unknown")
            if company not in by_company:
                by_company[company] = []
            by_company[company].append(c)

        # Intra-company communication (high frequency)
        for company_contacts in by_company.values():
            if len(company_contacts) < 2:
                continue
            for i, c1 in enumerate(company_contacts):
                for c2 in company_contacts[i + 1:]:
                    if random.random() < 0.7:  # 70% chance of communication
                        relationships.append({
                            "from_id": c1["id"],
                            "to_id": c2["id"],
                            "count": random.randint(10, 100),
                            "lastAt": self._random_past_date(14).isoformat(),
                            "sentimentAvg": round(random.uniform(0.2, 0.8), 2),
                            "channels": random.sample(["email", "slack", "calendar"], k=random.randint(1, 3)),
                        })

        # Inter-company communication (lower frequency)
        companies = list(by_company.keys())
        for _ in range(len(contacts) * 2):  # Create cross-company links
            if len(companies) < 2:
                break
            comp1, comp2 = random.sample(companies, 2)
            if by_company[comp1] and by_company[comp2]:
                c1 = random.choice(by_company[comp1])
                c2 = random.choice(by_company[comp2])
                if random.random() < 0.4:  # 40% chance
                    relationships.append({
                        "from_id": c1["id"],
                        "to_id": c2["id"],
                        "count": random.randint(1, 30),
                        "lastAt": self._random_past_date(30).isoformat(),
                        "sentimentAvg": round(random.uniform(0.0, 0.7), 2),
                        "channels": random.sample(["email", "calendar"], k=random.randint(1, 2)),
                    })

        return relationships

    def generate_episodes(self, org_id: str, count: int = 100) -> list[dict]:
        """Generate episode data (temporal memory snapshots)."""
        contacts = self.contacts.get(org_id, [])
        episodes = []

        source_types = ["email", "slack", "calendar", "notion"]

        for _ in range(count):
            participants = random.sample(contacts, k=min(random.randint(2, 5), len(contacts)))
            topic = random.choice(TOPICS)
            ref_time = self._random_past_date(60)

            episode = {
                "id": self._uid(),
                "organizationId": org_id,
                "name": f"Discussion about {topic}",
                "content": f"Team discussion regarding {topic}. Participants shared updates and next steps were identified.",
                "summary": f"Meeting about {topic} with key decisions made.",
                "sourceType": random.choice(source_types),
                "sourceId": self._uid(),
                "referenceTime": ref_time.isoformat(),
                "recordedAt": (ref_time + timedelta(minutes=random.randint(1, 60))).isoformat(),
                "validFrom": ref_time.isoformat(),
                "participants": [p["id"] for p in participants],
                "confidence": round(random.uniform(0.7, 1.0), 2),
                "createdAt": ref_time.isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
            }
            episodes.append(episode)

        self.episodes[org_id] = episodes
        return episodes

    def generate_entities(self, org_id: str, count: int = 40) -> list[dict]:
        """Generate entity data (semantic memory)."""
        entities = []
        entity_names = [
            "Project Alpha", "Project Beta", "Project Gamma", "Initiative X",
            "Platform Modernization", "Customer Portal", "Analytics Dashboard",
            "Mobile App v2", "API Gateway", "Data Pipeline", "ML Platform",
            "Security Framework", "DevOps Automation", "Cloud Migration",
            "Integration Hub", "Reporting System", "Notification Service",
            "Authentication System", "Payment Gateway", "Search Infrastructure",
        ] + TOPICS

        for i in range(count):
            name = entity_names[i % len(entity_names)]
            if i >= len(entity_names):
                name = f"{name} {i // len(entity_names) + 1}"

            first_seen = self._random_past_date(180)
            entity = {
                "id": self._uid(),
                "organizationId": org_id,
                "name": name,
                "entityType": random.choice(ENTITY_TYPES + ["topic", "project"]),
                "summary": f"Key initiative focused on {name.lower()}",
                "firstSeen": first_seen.isoformat(),
                "lastSeen": self._random_past_date(7).isoformat(),
                "relevanceScore": round(random.uniform(0.4, 1.0), 2),
                "accessCount": random.randint(1, 50),
                "confidence": round(random.uniform(0.6, 1.0), 2),
                "createdAt": first_seen.isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
            }
            entities.append(entity)

        self.entities[org_id] = entities
        return entities

    def generate_commitments(self, org_id: str, count: int = 60) -> list[dict]:
        """Generate commitment data."""
        contacts = self.contacts.get(org_id, [])
        commitments = []

        for _ in range(count):
            template, direction, priority = random.choice(COMMITMENT_TEMPLATES)
            title = template.format(
                date=self._random_future_date(30).strftime("%B %d"),
                quarter=random.randint(1, 4),
            )

            debtor = random.choice(contacts)
            creditor = random.choice([c for c in contacts if c["id"] != debtor["id"]] or contacts)

            due_date = self._random_date(-10, 45)
            status = "pending"
            if due_date < datetime.utcnow():
                status = random.choice(["completed", "overdue", "cancelled"])
            elif random.random() < 0.3:
                status = "in_progress"

            commitment = {
                "id": self._uid(),
                "organizationId": org_id,
                "title": title,
                "description": f"Commitment regarding: {title}",
                "direction": direction,
                "status": status,
                "priority": priority,
                "debtorContactId": debtor["id"],
                "creditorContactId": creditor["id"],
                "dueDate": due_date.isoformat(),
                "dueDateConfidence": round(random.uniform(0.5, 1.0), 2),
                "confidence": round(random.uniform(0.6, 1.0), 2),
                "confidenceTier": "high" if random.random() > 0.3 else random.choice(["medium", "low"]),
                "createdAt": self._random_past_date(60).isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
            }
            commitments.append(commitment)

        self.commitments[org_id] = commitments
        return commitments

    def generate_decisions(self, org_id: str, count: int = 40) -> list[dict]:
        """Generate decision data."""
        contacts = self.contacts.get(org_id, [])
        entities = self.entities.get(org_id, [])
        decisions = []

        vendors = ["Acme", "TechCorp", "DataSys", "CloudFirst", "SecureTech"]
        technologies = ["React", "Python", "Kubernetes", "PostgreSQL", "Redis", "GraphQL"]
        features = ["real-time sync", "offline mode", "SSO integration", "advanced analytics"]

        for _ in range(count):
            template, status = random.choice(DECISION_TEMPLATES)
            title = template.format(
                vendor=random.choice(vendors),
                project=random.choice([e["name"] for e in entities] if entities else ["Main"]),
                technology=random.choice(technologies),
                category=random.choice(["database", "frontend", "infrastructure", "security"]),
                quarter=random.randint(1, 4),
                date=self._random_future_date(60).strftime("%B %d"),
                weeks=random.randint(2, 8),
                name=random.choice(contacts)["name"] if contacts else "TBD",
                feature=random.choice(features),
                other_feature=random.choice(features),
                count=random.randint(2, 10),
                discount=random.randint(10, 30),
                topic=random.choice(TOPICS),
            )

            owner = random.choice(contacts) if contacts else None
            participants = random.sample(contacts, k=min(random.randint(2, 5), len(contacts)))

            decision = {
                "id": self._uid(),
                "organizationId": org_id,
                "title": title,
                "statement": title,
                "rationale": f"After careful evaluation, this decision was made to optimize {random.choice(['efficiency', 'cost', 'performance', 'scalability', 'security'])}.",
                "ownerContactId": owner["id"] if owner else None,
                "participantContactIds": [p["id"] for p in participants],
                "status": status,
                "confidence": round(random.uniform(0.6, 1.0), 2),
                "confidenceTier": "high" if random.random() > 0.3 else random.choice(["medium", "low"]),
                "createdAt": self._random_past_date(90).isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
            }
            decisions.append(decision)

        self.decisions[org_id] = decisions
        return decisions

    def generate_risks(self, org_id: str, count: int = 25) -> list[dict]:
        """Generate risk data."""
        contacts = self.contacts.get(org_id, [])
        risks = []

        for _ in range(count):
            template, severity, risk_type = random.choice(RISK_TEMPLATES)
            title = template.format(
                percent=random.randint(10, 50),
                weeks=random.randint(1, 8),
                name=random.choice(contacts)["name"] if contacts else "Key Stakeholder",
                competitor=random.choice(["CompetitorA", "CompetitorB", "BigTech Inc"]),
                score=random.randint(20, 50),
                vendor=random.choice(["CloudVendor", "DataProvider", "SaaS Partner"]),
            )

            risk = {
                "id": self._uid(),
                "organizationId": org_id,
                "title": title,
                "severity": severity,
                "riskType": risk_type,
                "suggestedAction": f"Recommend immediate review and mitigation planning for {risk_type} risk.",
                "confidence": round(random.uniform(0.5, 0.95), 2),
                "confidenceTier": random.choice(["high", "medium"]),
                "createdAt": self._random_past_date(45).isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
            }
            risks.append(risk)

        self.risks[org_id] = risks
        return risks

    def generate_tasks(self, org_id: str, count: int = 50) -> list[dict]:
        """Generate task data."""
        contacts = self.contacts.get(org_id, [])
        tasks = []

        for _ in range(count):
            title = random.choice(TASK_TEMPLATES)
            assignee = random.choice(contacts) if contacts else None

            due_date = self._random_date(-5, 30)
            status = "pending"
            if due_date < datetime.utcnow():
                status = random.choice(["completed", "overdue"])
            elif random.random() < 0.4:
                status = "in_progress"

            task = {
                "id": self._uid(),
                "organizationId": org_id,
                "title": title,
                "description": f"Task: {title}",
                "status": status,
                "priority": random.choice(["low", "medium", "high", "urgent"]),
                "assigneeContactId": assignee["id"] if assignee else None,
                "dueDate": due_date.isoformat(),
                "confidence": round(random.uniform(0.7, 1.0), 2),
                "confidenceTier": random.choice(["high", "medium"]),
                "createdAt": self._random_past_date(30).isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
            }
            tasks.append(task)

        self.tasks[org_id] = tasks
        return tasks

    def generate_raw_messages(self, org_id: str, count: int = 150) -> list[dict]:
        """Generate raw message data for full-text search."""
        contacts = self.contacts.get(org_id, [])
        if len(contacts) < 2:
            return []

        messages = []
        threads_map: dict[str, list] = {}  # thread_id -> messages

        for _ in range(count):
            sender = random.choice(contacts)
            recipients = random.sample(
                [c for c in contacts if c["id"] != sender["id"]],
                k=min(random.randint(1, 4), len(contacts) - 1)
            )

            if not recipients:
                continue

            template = random.choice(MESSAGE_TEMPLATES)
            topic = random.choice(TOPICS)
            sent_at = self._random_past_date(60)

            content = template.format(
                recipient=recipients[0]["name"].split()[0],
                sender=sender["name"].split()[0],
                topic=topic,
                update1=f"Completed {random.choice(['initial review', 'requirements gathering', 'stakeholder alignment'])}",
                update2=f"Started {random.choice(['implementation', 'testing', 'documentation'])} phase",
                update3=f"Next milestone: {random.choice(['demo', 'review meeting', 'go-live'])}",
                action1=f"Finalize {random.choice(['requirements', 'design', 'timeline'])}",
                action2=f"Schedule {random.choice(['kickoff', 'review', 'training'])} meeting",
                action3=f"Share {random.choice(['documentation', 'access credentials', 'test results'])}",
                document=random.choice(["proposal", "contract", "specification", "timeline"]),
                date=self._random_future_date(14).strftime("%B %d"),
                project=random.choice(["Alpha", "Beta", "Main", "Platform"]),
                achievement=random.choice(["the initial setup", "phase 1", "core features"]),
                next_phase=random.choice(["integration testing", "user acceptance", "deployment"]),
                milestone=random.choice(["MVP", "beta", "production"]),
                concern=random.choice([
                    "we might need additional resources",
                    "there's a dependency on the vendor",
                    "timeline seems tight"
                ]),
                proposal=f"We propose to {random.choice(['implement', 'adopt', 'migrate to'])} {random.choice(['the new system', 'cloud infrastructure', 'automated testing'])}.",
                benefit1=random.choice(["reduce costs by 30%", "improve efficiency", "scale better"]),
                benefit2=random.choice(["maintain security", "ensure compliance", "improve UX"]),
                timeline=random.choice(["4-6 weeks", "2-3 months", "Q2"]),
                budget=random.randint(50, 500) * 1000,
                question=f"Should we proceed with {random.choice(['option A', 'the current plan', 'the proposed changes'])}?",
                option_a=random.choice(["Proceed as planned", "Increase scope", "Fast-track"]),
                option_b=random.choice(["Delay by 2 weeks", "Reduce scope", "Add resources"]),
                option_c=random.choice(["Cancel and reassess", "Pilot first", "Get more quotes"]),
                recommended=random.choice(["A", "B"]),
                rationale=random.choice([
                    "it balances risk and reward",
                    "it aligns with our Q2 goals",
                    "stakeholders prefer this approach"
                ]),
            )

            # Assign to thread
            thread_id = self._uid() if random.random() > 0.6 else (
                random.choice(list(threads_map.keys())) if threads_map else self._uid()
            )

            if thread_id not in threads_map:
                threads_map[thread_id] = []

            message = {
                "id": self._uid(),
                "organizationId": org_id,
                "content": content,
                "subject": f"Re: {topic}" if threads_map.get(thread_id) else topic,
                "sourceType": random.choice(["email", "slack"]),
                "sourceId": self._uid(),
                "senderContactId": sender["id"],
                "senderEmail": sender["email"],
                "senderName": sender["name"],
                "recipientContactIds": [r["id"] for r in recipients],
                "recipientEmails": [r["email"] for r in recipients],
                "threadId": thread_id,
                "sentAt": sent_at.isoformat(),
                "isProcessed": True,
                "createdAt": sent_at.isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
            }
            messages.append(message)
            threads_map[thread_id].append(message)

        self.raw_messages[org_id] = messages

        # Generate thread contexts
        thread_contexts = []
        for thread_id, thread_messages in threads_map.items():
            first_msg = min(thread_messages, key=lambda m: m["sentAt"])
            last_msg = max(thread_messages, key=lambda m: m["sentAt"])

            all_participants = set()
            for msg in thread_messages:
                all_participants.add(msg["senderContactId"])
                all_participants.update(msg["recipientContactIds"])

            thread_context = {
                "id": self._uid(),
                "organizationId": org_id,
                "threadId": thread_id,
                "sourceType": first_msg["sourceType"],
                "subject": first_msg["subject"].replace("Re: ", ""),
                "summary": f"Discussion thread about {first_msg['subject'].replace('Re: ', '')} with {len(all_participants)} participants.",
                "participantContactIds": list(all_participants),
                "participantCount": len(all_participants),
                "initiatorContactId": first_msg["senderContactId"],
                "messageCount": len(thread_messages),
                "firstMessageAt": first_msg["sentAt"],
                "lastMessageAt": last_msg["sentAt"],
                "status": random.choice(["active", "stale"]),
                "urgencyScore": round(random.uniform(0.2, 0.9), 2),
                "priority": random.choice(["low", "medium", "high"]),
                "createdAt": first_msg["sentAt"],
                "updatedAt": datetime.utcnow().isoformat(),
            }
            thread_contexts.append(thread_context)

        self.threads[org_id] = thread_contexts
        return messages

    def generate_communication_events(self, org_id: str, count: int = 200) -> list[dict]:
        """Generate communication event data for pattern tracking."""
        contacts = self.contacts.get(org_id, [])
        if len(contacts) < 2:
            return []

        events = []
        event_types = [
            "email_sent", "email_received", "slack_message",
            "meeting_scheduled", "meeting_attended", "call",
        ]

        for _ in range(count):
            from_contact = random.choice(contacts)
            to_contacts = random.sample(
                [c for c in contacts if c["id"] != from_contact["id"]],
                k=min(random.randint(1, 3), len(contacts) - 1)
            )

            if not to_contacts:
                continue

            event = {
                "id": self._uid(),
                "organizationId": org_id,
                "eventType": random.choice(event_types),
                "fromContactId": from_contact["id"],
                "toContactIds": [c["id"] for c in to_contacts],
                "sourceType": random.choice(["email", "slack", "calendar"]),
                "occurredAt": self._random_past_date(90).isoformat(),
                "channel": random.choice(["email", "slack", "calendar"]),
                "sentimentScore": round(random.uniform(-0.3, 0.8), 2),
                "sentimentLabel": random.choice(["positive", "neutral", "negative"]),
                "messageLength": random.randint(50, 2000),
                "createdAt": datetime.utcnow().isoformat(),
                "updatedAt": datetime.utcnow().isoformat(),
            }
            events.append(event)

        self.communication_events[org_id] = events
        return events

    # =========================================================================
    # Database Operations
    # =========================================================================

    async def drop_graph(self) -> None:
        """Drop all data from the graph."""
        logger.info("Dropping all graph data...")
        try:
            # Delete all nodes and relationships
            await self.graph.query("MATCH (n) DETACH DELETE n")
            logger.info("Graph data dropped successfully")
        except Exception as e:
            logger.error("Failed to drop graph", error=str(e))
            raise

    async def seed_contacts(self, org_id: str) -> int:
        """Seed contact nodes."""
        contacts = self.contacts.get(org_id, [])
        count = 0

        for contact in contacts:
            try:
                props = self.graph._dict_to_cypher(contact)
                await self.graph.query(f"CREATE (c:Contact {props})")
                count += 1
            except Exception as e:
                logger.warning("Failed to create contact", contact_id=contact["id"], error=str(e))

        return count

    async def seed_communication_relationships(self, org_id: str) -> int:
        """Seed COMMUNICATES_WITH relationships between contacts."""
        relationships = self.generate_communication_relationships(org_id)
        count = 0

        for rel in relationships:
            try:
                channels_str = str(rel["channels"]).replace("'", '"')
                await self.graph.query(
                    f"""
                    MATCH (a:Contact {{id: '{rel["from_id"]}'}})
                    MATCH (b:Contact {{id: '{rel["to_id"]}'}})
                    CREATE (a)-[r:COMMUNICATES_WITH {{
                        count: {rel["count"]},
                        lastAt: '{rel["lastAt"]}',
                        sentimentAvg: {rel["sentimentAvg"]},
                        channels: {channels_str}
                    }}]->(b)
                    """
                )
                count += 1
            except Exception as e:
                logger.warning("Failed to create relationship", error=str(e))

        return count

    async def seed_episodes(self, org_id: str) -> int:
        """Seed episode nodes."""
        episodes = self.episodes.get(org_id, [])
        count = 0

        for episode in episodes:
            try:
                # Convert participants list to string
                ep_copy = episode.copy()
                ep_copy["participants"] = str(episode["participants"]).replace("'", '"')
                props = self.graph._dict_to_cypher(ep_copy)
                await self.graph.query(f"CREATE (e:Episode {props})")
                count += 1
            except Exception as e:
                logger.warning("Failed to create episode", episode_id=episode["id"], error=str(e))

        return count

    async def seed_entities(self, org_id: str) -> int:
        """Seed entity nodes."""
        entities = self.entities.get(org_id, [])
        count = 0

        for entity in entities:
            try:
                props = self.graph._dict_to_cypher(entity)
                await self.graph.query(f"CREATE (e:Entity {props})")
                count += 1
            except Exception as e:
                logger.warning("Failed to create entity", entity_id=entity["id"], error=str(e))

        return count

    async def seed_commitments(self, org_id: str) -> int:
        """Seed commitment nodes and relationships."""
        commitments = self.commitments.get(org_id, [])
        count = 0

        for commitment in commitments:
            try:
                props = self.graph._dict_to_cypher(commitment)
                await self.graph.query(f"CREATE (c:Commitment {props})")

                # Link to debtor/creditor contacts
                if commitment.get("debtorContactId"):
                    await self.graph.query(f"""
                        MATCH (c:Commitment {{id: '{commitment["id"]}'}})
                        MATCH (contact:Contact {{id: '{commitment["debtorContactId"]}'}})
                        CREATE (c)-[:OWNED_BY]->(contact)
                    """)
                if commitment.get("creditorContactId"):
                    await self.graph.query(f"""
                        MATCH (c:Commitment {{id: '{commitment["id"]}'}})
                        MATCH (contact:Contact {{id: '{commitment["creditorContactId"]}'}})
                        CREATE (c)-[:OWED_TO]->(contact)
                    """)

                count += 1
            except Exception as e:
                logger.warning("Failed to create commitment", commitment_id=commitment["id"], error=str(e))

        return count

    async def seed_decisions(self, org_id: str) -> int:
        """Seed decision nodes and relationships."""
        decisions = self.decisions.get(org_id, [])
        count = 0

        for decision in decisions:
            try:
                dec_copy = decision.copy()
                dec_copy["participantContactIds"] = str(decision["participantContactIds"]).replace("'", '"')
                props = self.graph._dict_to_cypher(dec_copy)
                await self.graph.query(f"CREATE (d:Decision {props})")

                # Link to owner
                if decision.get("ownerContactId"):
                    await self.graph.query(f"""
                        MATCH (d:Decision {{id: '{decision["id"]}'}})
                        MATCH (contact:Contact {{id: '{decision["ownerContactId"]}'}})
                        CREATE (d)-[:OWNED_BY]->(contact)
                    """)

                count += 1
            except Exception as e:
                logger.warning("Failed to create decision", decision_id=decision["id"], error=str(e))

        return count

    async def seed_risks(self, org_id: str) -> int:
        """Seed risk nodes."""
        risks = self.risks.get(org_id, [])
        count = 0

        for risk in risks:
            try:
                props = self.graph._dict_to_cypher(risk)
                await self.graph.query(f"CREATE (r:Risk {props})")
                count += 1
            except Exception as e:
                logger.warning("Failed to create risk", risk_id=risk["id"], error=str(e))

        return count

    async def seed_tasks(self, org_id: str) -> int:
        """Seed task nodes and relationships."""
        tasks = self.tasks.get(org_id, [])
        count = 0

        for task in tasks:
            try:
                props = self.graph._dict_to_cypher(task)
                await self.graph.query(f"CREATE (t:Task {props})")

                # Link to assignee
                if task.get("assigneeContactId"):
                    await self.graph.query(f"""
                        MATCH (t:Task {{id: '{task["id"]}'}})
                        MATCH (contact:Contact {{id: '{task["assigneeContactId"]}'}})
                        CREATE (t)-[:ASSIGNED_TO]->(contact)
                    """)

                count += 1
            except Exception as e:
                logger.warning("Failed to create task", task_id=task["id"], error=str(e))

        return count

    async def seed_raw_messages(self, org_id: str) -> int:
        """Seed raw message nodes."""
        messages = self.raw_messages.get(org_id, [])
        count = 0

        for msg in messages:
            try:
                msg_copy = msg.copy()
                msg_copy["recipientContactIds"] = str(msg["recipientContactIds"]).replace("'", '"')
                msg_copy["recipientEmails"] = str(msg["recipientEmails"]).replace("'", '"')
                # Escape content for Cypher
                msg_copy["content"] = msg["content"].replace("'", "\\'").replace("\n", "\\n")
                props = self.graph._dict_to_cypher(msg_copy)
                await self.graph.query(f"CREATE (m:RawMessage {props})")

                # Link to sender
                if msg.get("senderContactId"):
                    await self.graph.query(f"""
                        MATCH (m:RawMessage {{id: '{msg["id"]}'}})
                        MATCH (contact:Contact {{id: '{msg["senderContactId"]}'}})
                        CREATE (m)-[:SENT_BY]->(contact)
                    """)

                count += 1
            except Exception as e:
                logger.warning("Failed to create raw message", message_id=msg["id"], error=str(e))

        return count

    async def seed_threads(self, org_id: str) -> int:
        """Seed thread context nodes."""
        threads = self.threads.get(org_id, [])
        count = 0

        for thread in threads:
            try:
                thread_copy = thread.copy()
                thread_copy["participantContactIds"] = str(thread["participantContactIds"]).replace("'", '"')
                props = self.graph._dict_to_cypher(thread_copy)
                await self.graph.query(f"CREATE (t:ThreadContext {props})")

                # Link messages to thread
                await self.graph.query(f"""
                    MATCH (t:ThreadContext {{threadId: '{thread["threadId"]}'}})
                    MATCH (m:RawMessage {{threadId: '{thread["threadId"]}'}})
                    CREATE (m)-[:IN_THREAD]->(t)
                """)

                count += 1
            except Exception as e:
                logger.warning("Failed to create thread", thread_id=thread["id"], error=str(e))

        return count

    async def seed_communication_events(self, org_id: str) -> int:
        """Seed communication event nodes."""
        events = self.communication_events.get(org_id, [])
        count = 0

        for event in events:
            try:
                event_copy = event.copy()
                event_copy["toContactIds"] = str(event["toContactIds"]).replace("'", '"')
                props = self.graph._dict_to_cypher(event_copy)
                await self.graph.query(f"CREATE (e:CommunicationEvent {props})")
                count += 1
            except Exception as e:
                logger.warning("Failed to create communication event", event_id=event["id"], error=str(e))

        return count

    async def create_cross_links(self, org_id: str) -> int:
        """Create intelligence cross-links (IMPACTS, THREATENS, FULFILLS)."""
        count = 0
        decisions = self.decisions.get(org_id, [])
        commitments = self.commitments.get(org_id, [])
        risks = self.risks.get(org_id, [])
        tasks = self.tasks.get(org_id, [])

        # Decision IMPACTS Commitment
        for decision in random.sample(decisions, k=min(len(decisions) // 2, 20)):
            target = random.choice(commitments) if commitments else None
            if target:
                try:
                    await self.graph.query(f"""
                        MATCH (d:Decision {{id: '{decision["id"]}'}})
                        MATCH (c:Commitment {{id: '{target["id"]}'}})
                        CREATE (d)-[:IMPACTS {{impactScore: {round(random.uniform(0.3, 1.0), 2)}}}]->(c)
                    """)
                    count += 1
                except Exception:
                    pass

        # Risk THREATENS Decision/Commitment
        for risk in risks:
            if random.random() < 0.5 and decisions:
                target = random.choice(decisions)
                try:
                    await self.graph.query(f"""
                        MATCH (r:Risk {{id: '{risk["id"]}'}})
                        MATCH (d:Decision {{id: '{target["id"]}'}})
                        CREATE (r)-[:THREATENS {{severity: '{risk["severity"]}'}}]->(d)
                    """)
                    count += 1
                except Exception:
                    pass
            elif commitments:
                target = random.choice(commitments)
                try:
                    await self.graph.query(f"""
                        MATCH (r:Risk {{id: '{risk["id"]}'}})
                        MATCH (c:Commitment {{id: '{target["id"]}'}})
                        CREATE (r)-[:THREATENS {{severity: '{risk["severity"]}'}}]->(c)
                    """)
                    count += 1
                except Exception:
                    pass

        # Task FULFILLS Commitment
        for task in random.sample(tasks, k=min(len(tasks) // 2, 25)):
            target = random.choice(commitments) if commitments else None
            if target:
                try:
                    await self.graph.query(f"""
                        MATCH (t:Task {{id: '{task["id"]}'}})
                        MATCH (c:Commitment {{id: '{target["id"]}'}})
                        CREATE (t)-[:FULFILLS {{completionPercentage: {random.randint(0, 100)}}}]->(c)
                    """)
                    count += 1
                except Exception:
                    pass

        return count

    async def run_analytics(self, org_id: str) -> None:
        """Run graph analytics and persist results."""
        from src.graph.client import GraphAnalyticsEngine

        logger.info("Running graph analytics...", org_id=org_id)

        engine = GraphAnalyticsEngine(self.graph)

        # Compute analytics
        pagerank = await engine.compute_pagerank(org_id)
        betweenness = await engine.compute_betweenness_centrality(org_id)
        communities = await engine.detect_communities(org_id)

        # Persist results
        updated = await engine.persist_analytics(org_id, pagerank, betweenness, communities)

        logger.info(
            "Analytics completed",
            org_id=org_id,
            contacts_updated=updated,
            communities_found=len(set(communities.values())),
        )


# =============================================================================
# Main Execution
# =============================================================================


async def main(
    org_count: int = 2,
    contacts_per_org: int = 50,
    episodes_per_org: int = 100,
    entities_per_org: int = 40,
    commitments_per_org: int = 60,
    decisions_per_org: int = 40,
    risks_per_org: int = 25,
    tasks_per_org: int = 50,
    messages_per_org: int = 150,
    events_per_org: int = 200,
):
    """Main seeding function."""
    from src.graph.client import get_graph_client, close_graph_client

    logger.info("=" * 60)
    logger.info("FalkorDB Graph Seeder")
    logger.info("=" * 60)

    # Connect to graph
    graph = await get_graph_client()
    seeder = GraphSeeder(graph)

    # Drop existing data
    await seeder.drop_graph()

    # Generate and seed data for each organization
    orgs = seeder.generate_organizations(org_count)

    total_stats = {
        "organizations": len(orgs),
        "contacts": 0,
        "relationships": 0,
        "episodes": 0,
        "entities": 0,
        "commitments": 0,
        "decisions": 0,
        "risks": 0,
        "tasks": 0,
        "raw_messages": 0,
        "threads": 0,
        "communication_events": 0,
        "cross_links": 0,
    }

    for org in orgs:
        org_id = org["id"]
        logger.info(f"Seeding organization: {org['name']} ({org_id})")

        # Generate data
        seeder.generate_contacts(org_id, contacts_per_org)
        seeder.generate_episodes(org_id, episodes_per_org)
        seeder.generate_entities(org_id, entities_per_org)
        seeder.generate_commitments(org_id, commitments_per_org)
        seeder.generate_decisions(org_id, decisions_per_org)
        seeder.generate_risks(org_id, risks_per_org)
        seeder.generate_tasks(org_id, tasks_per_org)
        seeder.generate_raw_messages(org_id, messages_per_org)
        seeder.generate_communication_events(org_id, events_per_org)

        # Seed to database
        total_stats["contacts"] += await seeder.seed_contacts(org_id)
        logger.info(f"  - Contacts: {len(seeder.contacts[org_id])}")

        total_stats["relationships"] += await seeder.seed_communication_relationships(org_id)
        logger.info(f"  - Communication relationships created")

        total_stats["episodes"] += await seeder.seed_episodes(org_id)
        logger.info(f"  - Episodes: {len(seeder.episodes[org_id])}")

        total_stats["entities"] += await seeder.seed_entities(org_id)
        logger.info(f"  - Entities: {len(seeder.entities[org_id])}")

        total_stats["commitments"] += await seeder.seed_commitments(org_id)
        logger.info(f"  - Commitments: {len(seeder.commitments[org_id])}")

        total_stats["decisions"] += await seeder.seed_decisions(org_id)
        logger.info(f"  - Decisions: {len(seeder.decisions[org_id])}")

        total_stats["risks"] += await seeder.seed_risks(org_id)
        logger.info(f"  - Risks: {len(seeder.risks[org_id])}")

        total_stats["tasks"] += await seeder.seed_tasks(org_id)
        logger.info(f"  - Tasks: {len(seeder.tasks[org_id])}")

        total_stats["raw_messages"] += await seeder.seed_raw_messages(org_id)
        logger.info(f"  - Raw messages: {len(seeder.raw_messages[org_id])}")

        total_stats["threads"] += await seeder.seed_threads(org_id)
        logger.info(f"  - Threads: {len(seeder.threads[org_id])}")

        total_stats["communication_events"] += await seeder.seed_communication_events(org_id)
        logger.info(f"  - Communication events: {len(seeder.communication_events[org_id])}")

        total_stats["cross_links"] += await seeder.create_cross_links(org_id)
        logger.info(f"  - Cross-links created")

        # Run analytics
        await seeder.run_analytics(org_id)

    # Print summary
    logger.info("=" * 60)
    logger.info("Seeding Complete!")
    logger.info("=" * 60)
    for key, value in total_stats.items():
        logger.info(f"  {key}: {value}")

    # Print organization IDs for testing
    logger.info("")
    logger.info("Organization IDs for testing:")
    for org in orgs:
        logger.info(f"  - {org['name']}: {org['id']}")

    # Close connection
    await close_graph_client()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Seed FalkorDB with test data")
    parser.add_argument("--org-count", type=int, default=2, help="Number of organizations")
    parser.add_argument("--contacts-per-org", type=int, default=50, help="Contacts per org")
    parser.add_argument("--episodes-per-org", type=int, default=100, help="Episodes per org")
    parser.add_argument("--entities-per-org", type=int, default=40, help="Entities per org")
    parser.add_argument("--commitments-per-org", type=int, default=60, help="Commitments per org")
    parser.add_argument("--decisions-per-org", type=int, default=40, help="Decisions per org")
    parser.add_argument("--risks-per-org", type=int, default=25, help="Risks per org")
    parser.add_argument("--tasks-per-org", type=int, default=50, help="Tasks per org")
    parser.add_argument("--messages-per-org", type=int, default=150, help="Raw messages per org")
    parser.add_argument("--events-per-org", type=int, default=200, help="Communication events per org")

    args = parser.parse_args()

    asyncio.run(main(
        org_count=args.org_count,
        contacts_per_org=args.contacts_per_org,
        episodes_per_org=args.episodes_per_org,
        entities_per_org=args.entities_per_org,
        commitments_per_org=args.commitments_per_org,
        decisions_per_org=args.decisions_per_org,
        risks_per_org=args.risks_per_org,
        tasks_per_org=args.tasks_per_org,
        messages_per_org=args.messages_per_org,
        events_per_org=args.events_per_org,
    ))
