-- ---------------------------------------------------------------------------
-- Immutable audit log sink
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imperium_audit_event (
  id UUID PRIMARY KEY,
  stream_key TEXT NOT NULL,
  actor_user_id UUID REFERENCES imperium_user(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imperium_audit_event_stream_time
  ON imperium_audit_event(stream_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_imperium_audit_event_actor_time
  ON imperium_audit_event(actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION imperium_reject_audit_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'imperium_audit_event is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_imperium_audit_event_no_update ON imperium_audit_event;
CREATE TRIGGER trg_imperium_audit_event_no_update
  BEFORE UPDATE ON imperium_audit_event
  FOR EACH ROW
  EXECUTE FUNCTION imperium_reject_audit_event_mutation();

DROP TRIGGER IF EXISTS trg_imperium_audit_event_no_delete ON imperium_audit_event;
CREATE TRIGGER trg_imperium_audit_event_no_delete
  BEFORE DELETE ON imperium_audit_event
  FOR EACH ROW
  EXECUTE FUNCTION imperium_reject_audit_event_mutation();

-- ---------------------------------------------------------------------------
-- Dead-letter queue and replay tracking
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imperium_dead_letter_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_role TEXT NOT NULL,
  subject TEXT NOT NULL,
  payload JSONB NOT NULL,
  error_message TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  first_failed_at TIMESTAMPTZ NOT NULL,
  last_failed_at TIMESTAMPTZ NOT NULL,
  replayed_at TIMESTAMPTZ,
  replayed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('pending', 'replayed'))
);

CREATE INDEX IF NOT EXISTS idx_imperium_dead_letter_status_time
  ON imperium_dead_letter_event(status, last_failed_at DESC);

CREATE INDEX IF NOT EXISTS idx_imperium_dead_letter_role_time
  ON imperium_dead_letter_event(worker_role, last_failed_at DESC);

CREATE OR REPLACE FUNCTION imperium_set_dead_letter_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_imperium_dead_letter_updated_at ON imperium_dead_letter_event;
CREATE TRIGGER trg_imperium_dead_letter_updated_at
  BEFORE UPDATE ON imperium_dead_letter_event
  FOR EACH ROW
  EXECUTE FUNCTION imperium_set_dead_letter_updated_at();
