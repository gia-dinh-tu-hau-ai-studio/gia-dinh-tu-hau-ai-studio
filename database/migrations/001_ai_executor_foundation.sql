BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS intake_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_status text NOT NULL CHECK (validation_status IN ('PASSED', 'FAIL')),
  normalized_contract jsonb NOT NULL,
  forwarded_to_ai_music_factory_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_executor_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name text NOT NULL,
  job_name text NOT NULL,
  external_job_id text,
  status text NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'COMPLETED', 'FAILED')),
  payload jsonb NOT NULL,
  result jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_executor_jobs_status_idx
  ON ai_executor_jobs (status, created_at);

COMMIT;
