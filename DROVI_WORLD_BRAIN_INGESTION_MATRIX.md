# DROVI World Brain Ingestion Matrix (Production)

**Date**: 2026-02-22
**Repository**: `/Users/jeremyscatigna/project-memory`
**Execution Home**: `/Users/jeremyscatigna/project-memory/drovi-intelligence`

This document answers:
- Which APIs/data feeds must be ingested
- Which sources require scraping infrastructure
- What platform additions are required for production-scale ingest and storage

---

## 1) Ingestion Design Rules

1. Prioritize **authoritative sources** before convenience feeds.
2. Every source gets: licensing class, SLA, reliability prior, replay strategy.
3. Emit canonical `observation` events regardless of source type.
4. If no stable API exists, onboard via governed crawl fabric.
5. Land all raw and normalized data in lakehouse for replay/training.

---

## 2) Source Tiers

- **Tier 0**: Authoritative must-have sources.
- **Tier 1**: Commercial premium feeds that materially improve latency/coverage.
- **Tier 2**: Open/public complementary sources.
- **Tier 3**: Experimental/OSINT and low-confidence enrichment.

---

## 3) Master API and Feed Catalog

## 3.1 Regulatory, Legal, and Policy (Tier 0 First)

| Priority | Source | Access | Why It Matters |
|---|---|---|---|
| Tier 0 | Federal Register API | API | Proposed/final rules; legal constraint change detection |
| Tier 0 | Regulations.gov API | API | Rulemaking dockets, comments, timelines |
| Tier 0 | Congress API | API | Bill/provision tracking and legislative trajectory |
| Tier 0 | govinfo API | API | Official publications, CFR/FR context, legal provenance |
| Tier 0 | SEC EDGAR Submissions/XBRL | API | Public company filings and disclosure deltas |
| Tier 0 | CourtListener API | API | Opinions/dockets for case-law signals |
| Tier 0 | OFAC sanctions datasets | Dataset/API | Sanctions and restricted-party exposure |
| Tier 1 | PACER/Commercial court feeds | Commercial/API | Broader docket depth and timeliness |
| Tier 2 | Agency enforcement pages (FTC/DOJ/CFPB/etc.) | RSS + Scrape | Enforcement actions where APIs are inconsistent |
| Tier 2 | State regulator bulletins | API + Scrape | State-level obligations and enforcement deltas |

## 3.2 Macro, Economic, and Public Finance

| Priority | Source | Access | Why It Matters |
|---|---|---|---|
| Tier 0 | FRED API | API | Macro indicators and regime context |
| Tier 0 | BLS Public Data API | API | Labor and inflation components |
| Tier 0 | BEA Data API | API | GDP and sector economics |
| Tier 0 | U.S. Treasury Fiscal Data API | API | Yield/fiscal/issuance context |
| Tier 1 | IMF Data API | API | Global macro comparables |
| Tier 1 | World Bank Data API | API | Global development/economic indicators |

## 3.3 Markets, Filings, and Corporate Events

| Priority | Source | Access | Why It Matters |
|---|---|---|---|
| Tier 0 | SEC filings (10-K, 10-Q, 8-K, DEF 14A) | API | Core disclosure and risk change events |
| Tier 1 | Premium market data feed(s) | Streaming API | Real-time market and microstructure signals |
| Tier 1 | Earnings transcript provider(s) | API | Management guidance, thesis drift inputs |
| Tier 1 | OpenFIGI API | API | Cross-identifier entity normalization |
| Tier 2 | Exchange corporate actions feeds | API | Splits/dividends/issuer events |
| Tier 2 | Open corporate registry APIs | API | Entity existence and ownership changes |

## 3.4 Research, Science, and Medical

| Priority | Source | Access | Why It Matters |
|---|---|---|---|
| Tier 0 | PubMed E-utilities | API | Biomedical literature updates |
| Tier 0 | ClinicalTrials.gov API v2 | API | Trial status/results signals |
| Tier 0 | openFDA APIs | API | Safety labels/adverse event and regulatory changes |
| Tier 0 | Crossref REST API | API | DOI metadata and citation links |
| Tier 0 | OpenAlex API | API | Structured scholarly graph |
| Tier 1 | Semantic Scholar API | API | Citation graph and relevance enrichment |
| Tier 2 | arXiv feed/API | Feed/API | Early research signals |
| Tier 2 | Europe PMC APIs | API | Additional biomedical research coverage |

## 3.5 Cyber, Incident, and Operational Threat Signals

| Priority | Source | Access | Why It Matters |
|---|---|---|---|
| Tier 0 | NVD CVE API | API | Vulnerability intelligence |
| Tier 0 | CISA KEV catalog | Feed/Dataset | Actively exploited vulnerabilities |
| Tier 1 | Vendor status pages | API + Scrape | Third-party outage/supply risk |
| Tier 2 | CERT/sector advisories | RSS + Scrape | Sector-specific risk indicators |

## 3.6 Geopolitical, Logistics, and Global Events

| Priority | Source | Access | Why It Matters |
|---|---|---|---|
| Tier 1 | GDELT | API | Global event detection and narrative shifts |
| Tier 1 | ReliefWeb API | API | Crisis and humanitarian event context |
| Tier 2 | NOAA alert feeds/APIs | API | Extreme weather and disruption risk |
| Tier 2 | Trade/shipping and logistics feeds | Commercial/API | Supply chain and route disruption |

## 3.7 News and Media Intelligence

| Priority | Source | Access | Why It Matters |
|---|---|---|---|
| Tier 1 | World News API (`worldnewsapi.com`) | API | Structured global news retrieval with faster bootstrap for world-event ingestion |
| Tier 1 | Licensed enterprise news wires | Commercial/API | Low-latency trusted news backbone |
| Tier 2 | Curated RSS ecosystem | Feed | Breadth and niche vertical coverage |
| Tier 3 | Public web media long-tail | Scrape | Additional recall with lower trust prior |

## 3.8 Social, Developer, and Community Signals

| Priority | Source | Access | Why It Matters |
|---|---|---|---|
| Tier 2 | Reddit API | API | Community and sentiment shifts |
| Tier 2 | YouTube Data API | API | Influential media and transcript candidates |
| Tier 2 | GitHub Events/Repos APIs | API | OSS dependency and vulnerability exposure |
| Tier 3 | X API and similar | API | Fast-moving but noisy weak signals |

## 3.9 World News API Endpoint Usage Blueprint

Provider:
- docs: `https://worldnewsapi.com/docs/`
- base URL: `https://api.worldnewsapi.com`
- auth: `x-api-key` header (preferred in Drovi), query `api-key` fallback

| Endpoint | Role in Drovi | Primary Inputs | Pipeline Stage |
|---|---|---|---|
| `GET /search-news` | Exposure-driven targeted discovery | entities, time window, source-country, language, categories | discovery |
| `GET /top-news` | Rolling high-signal pulse by region | source-country, language, date | awareness |
| `GET /front-pages` | Source-level major headline clustering | source-country, language, date | awareness |
| `GET /retrieve-news` | Hydration of article IDs into full payloads | ids | enrichment |
| `GET /extract-news` | URL extraction fallback | url | enrichment |
| `GET /extract-news-links` | link expansion and crawl seeding | url | source expansion |
| `GET /search-news-sources` | source lookup/canonicalization | name | governance |
| `POST /suggest-news-source` | add missing publishers | source URL/feed URL | governance |
| `GET /feed.rss` | feed generation for websites without RSS | url | source expansion |
| `GET /geo-coordinates` | geospatial normalization | location string | normalization |

Operational controls:
- use quota headers for budget-aware scheduling (`X-API-Quota-Request`, `X-API-Quota-Used`, `X-API-Quota-Left`)
- enforce graceful degradation on `429` (backoff/retry) and `402` (quota escalation)
- maintain query checkpointing by window + offset for deterministic replay
- run dedupe between `search-news`, `top-news`, `front-pages`, and `retrieve-news` outputs

---

## 4) Sources That Require Scraping Infrastructure

Production scraping is required for:
- regulator pages without stable APIs
- enforcement press releases and legal notices
- state and local jurisdiction portals
- court PDFs/opinions with weak machine-readable structures
- vendor incident pages and status archives
- long-tail vertical publications

Required crawl modes:
- static HTTP fetch
- browser-render fetch (JS sites)
- PDF/scan extraction (OCR + table extraction)
- change-diff recrawl (not blind recrawl)

---

## 5) Ingestion Interfaces We Need in drovi-intelligence

- `src/connectors/world/` for API adapters
- `src/crawlers/` for frontier/scheduler/fetch/parse/diff pipeline
- `src/streaming/` topics for observation and crawl events
- `src/jobs/` worker fleet for normalization, entity linking, and materialization
- `src/lakehouse/` for bronze/silver/gold write paths

Core event contracts:
- `observation.raw.api.*`
- `observation.raw.web.*`
- `observation.normalized.*`
- `source.health.*`
- `crawl.audit.*`

---

## 6) Data Lakehouse Is Required (Not Optional)

A production world-brain needs a lakehouse for scale and replay.

Minimum architecture:
- Bronze raw zone: immutable source payloads + snapshots
- Silver normalized zone: canonical observations/entities/evidence links
- Gold feature zone: model-ready and decision-ready aggregates

Why Postgres+GraphDB alone is insufficient:
- historical replay at world scale
- multi-year training corpora
- backfills and schema evolution
- cost-efficient cold storage and audit retention

---

## 7) Production Infrastructure Additions Needed

1. Kafka hardening
- broker scaling, partition strategy, tiered retention, DLQs

2. Schema and contract management
- schema registry and compatibility checks

3. Stream compute tier
- high-throughput transform/materialization workers

4. Lakehouse compute tier
- batch backfill and analytical/model workloads

5. Crawl fleet control plane
- autoscaling, fairness, per-domain budgets, legal policy enforcement

6. Data quality platform
- freshness, completeness, drift, and anomaly monitors

7. Cost governance
- per-source, per-tenant, per-pipeline cost attribution

8. DR and resilience
- cross-region replication and replay drills

---

## 8) MVP-to-Scale Source Rollout Sequence

### Wave 1 (Authoritative Core)
- SEC, Federal Register, Regulations.gov, Congress, govinfo
- FRED/BLS/BEA/Treasury
- PubMed/ClinicalTrials/openFDA
- NVD/CISA KEV

### Wave 2 (Commercial Advantage)
- premium market + transcript feeds
- premium legal and enterprise news feeds

### Wave 3 (Long Tail Expansion)
- state/local portals
- vendor incident and niche vertical sources
- social/community weak-signal channels

---

## 9) Readiness Checklist Before Enabling A New Source

- licensing approved
- auth and quota handling implemented
- credential provisioned in secret manager/env (example: `WORLD_NEWS_API_KEY`)
- source reliability baseline defined
- parser quality benchmarked
- evidence/provenance chain validated
- replay/backfill strategy tested
- cost budget attached
- SRE ownership assigned

---

## 10) Official API Documentation Links (Starter Set)

- SEC EDGAR APIs: [https://www.sec.gov/search-filings/edgar-application-programming-interfaces](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- Federal Register API: [https://www.federalregister.gov/developers/documentation/api/v1](https://www.federalregister.gov/developers/documentation/api/v1)
- Regulations.gov API: [https://open.gsa.gov/api/regulationsgov/](https://open.gsa.gov/api/regulationsgov/)
- Congress API: [https://api.congress.gov/](https://api.congress.gov/)
- govinfo API: [https://api.govinfo.gov/](https://api.govinfo.gov/)
- FRED API: [https://fred.stlouisfed.org/docs/api/fred/](https://fred.stlouisfed.org/docs/api/fred/)
- BLS API: [https://www.bls.gov/developers/](https://www.bls.gov/developers/)
- BEA API: [https://apps.bea.gov/API/docs/index.htm](https://apps.bea.gov/API/docs/index.htm)
- Treasury Fiscal Data API: [https://fiscaldata.treasury.gov/api-documentation/](https://fiscaldata.treasury.gov/api-documentation/)
- PubMed E-utilities: [https://www.ncbi.nlm.nih.gov/books/NBK25501/](https://www.ncbi.nlm.nih.gov/books/NBK25501/)
- ClinicalTrials.gov API: [https://clinicaltrials.gov/data-api/api](https://clinicaltrials.gov/data-api/api)
- openFDA APIs: [https://open.fda.gov/apis/](https://open.fda.gov/apis/)
- Crossref REST API: [https://www.crossref.org/documentation/retrieve-metadata/rest-api/](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- OpenAlex API: [https://docs.openalex.org/](https://docs.openalex.org/)
- Semantic Scholar API: [https://api.semanticscholar.org/api-docs/](https://api.semanticscholar.org/api-docs/)
- NVD CVE API: [https://nvd.nist.gov/developers/vulnerabilities](https://nvd.nist.gov/developers/vulnerabilities)
- CISA KEV Catalog: [https://www.cisa.gov/known-exploited-vulnerabilities-catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog)
- CourtListener API: [https://www.courtlistener.com/api/](https://www.courtlistener.com/api/)
- OFAC Sanctions List Service: [https://ofac.treasury.gov/sanctions-list-service](https://ofac.treasury.gov/sanctions-list-service)
- GDELT Project: [https://www.gdeltproject.org/](https://www.gdeltproject.org/)
- ReliefWeb API docs: [https://apidoc.reliefweb.int/](https://apidoc.reliefweb.int/)
- World News API docs: [https://worldnewsapi.com/docs/](https://worldnewsapi.com/docs/)
- World News API authentication: [https://worldnewsapi.com/docs/authentication/](https://worldnewsapi.com/docs/authentication/)
- World News API rate limits: [https://worldnewsapi.com/docs/rate-limiting/](https://worldnewsapi.com/docs/rate-limiting/)
- World News API search endpoint: [https://worldnewsapi.com/docs/search-news/](https://worldnewsapi.com/docs/search-news/)
- World News API top news endpoint: [https://worldnewsapi.com/docs/top-news/](https://worldnewsapi.com/docs/top-news/)
