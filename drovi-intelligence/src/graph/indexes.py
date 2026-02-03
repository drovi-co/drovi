"""FalkorDB index statements (vector/fulltext helpers)."""

DEFAULT_FULLTEXT_INDEXES: list[str] = [
    "CALL db.idx.fulltext.createNodeIndex('UIO','canonicalTitle','canonicalDescription')",
    "CALL db.idx.fulltext.createNodeIndex('Commitment','title','description')",
    "CALL db.idx.fulltext.createNodeIndex('Decision','title','description')",
    "CALL db.idx.fulltext.createNodeIndex('Topic','title','description')",
    "CALL db.idx.fulltext.createNodeIndex('Project','title','description')",
    "CALL db.idx.fulltext.createNodeIndex('Contact','displayName','primaryEmail')",
    "CALL db.idx.fulltext.createNodeIndex('Message','text','subject')",
    "CALL db.idx.fulltext.createNodeIndex('TranscriptSegment','text')",
]

DEFAULT_VECTOR_INDEXES: list[str] = [
    "CREATE VECTOR INDEX FOR (n:UIO) ON (n.embedding) OPTIONS {dimension: 1536, similarityFunction: 'cosine'}",
    "CREATE VECTOR INDEX FOR (n:Message) ON (n.embedding) OPTIONS {dimension: 1536, similarityFunction: 'cosine'}",
    "CREATE VECTOR INDEX FOR (n:Commitment) ON (n.embedding) OPTIONS {dimension: 1536, similarityFunction: 'cosine'}",
    "CREATE VECTOR INDEX FOR (n:Decision) ON (n.embedding) OPTIONS {dimension: 1536, similarityFunction: 'cosine'}",
    "CREATE VECTOR INDEX FOR (n:Risk) ON (n.embedding) OPTIONS {dimension: 1536, similarityFunction: 'cosine'}",
    "CREATE VECTOR INDEX FOR (n:Task) ON (n.embedding) OPTIONS {dimension: 1536, similarityFunction: 'cosine'}",
    "CREATE VECTOR INDEX FOR (n:Claim) ON (n.embedding) OPTIONS {dimension: 1536, similarityFunction: 'cosine'}",
]
