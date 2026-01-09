-- HNSW vector indexes for semantic search
-- These indexes enable fast approximate nearest neighbor search using cosine similarity

-- Message embedding vector index
CREATE INDEX IF NOT EXISTS message_embedding_vector_idx
ON message_embedding
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Thread embedding vector index
CREATE INDEX IF NOT EXISTS thread_embedding_vector_idx
ON thread_embedding
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Claim embedding vector index
CREATE INDEX IF NOT EXISTS claim_embedding_vector_idx
ON claim_embedding
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Query cache embedding vector index (for faster repeated queries)
CREATE INDEX IF NOT EXISTS query_embedding_cache_vector_idx
ON query_embedding_cache
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
