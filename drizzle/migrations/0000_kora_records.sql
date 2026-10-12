CREATE TABLE public.kora_records (
  collection text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);
CREATE INDEX kora_records_collection_idx ON public.kora_records (collection);
CREATE TABLE public.kora_settings (
  workspace_id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.kora_records TO service_role;
GRANT ALL ON public.kora_settings TO service_role;
ALTER TABLE public.kora_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kora_settings ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.kora_records IS 'KORA: one row per record; collection = companies|sources|signals|articles|... ; data = JSON record (see src/server/store/records.ts). Server-only access.';