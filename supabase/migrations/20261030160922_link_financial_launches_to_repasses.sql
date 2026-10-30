-- Bootstrap the existing FNS import persistence schema without dropping data.
CREATE TABLE IF NOT EXISTS public.fns_importacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'em_andamento'
    CHECK (status IN ('em_andamento', 'concluida', 'parcial', 'falhou')),
  records_found integer NOT NULL DEFAULT 0 CHECK (records_found >= 0),
  records_imported integer NOT NULL DEFAULT 0 CHECK (records_imported >= 0),
  records_updated integer NOT NULL DEFAULT 0 CHECK (records_updated >= 0),
  records_ignored integer NOT NULL DEFAULT 0 CHECK (records_ignored >= 0),
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Existing installations may use a non-UUID primary key; match its real type.
DO $$
DECLARE
  import_id_type text;
  import_id_type_oid oid;
  repasse_import_id_type oid;
  repasse_id_type text;
  launch_repasse_id_type oid;
  repasse_id_type_oid oid;
BEGIN
  SELECT format_type(attribute.atttypid, attribute.atttypmod), attribute.atttypid
  INTO import_id_type, import_id_type_oid
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.fns_importacoes'::regclass
    AND attribute.attname = 'id'
    AND NOT attribute.attisdropped;

  IF import_id_type IS NULL THEN
    RAISE EXCEPTION 'A coluna public.fns_importacoes.id não foi encontrada.';
  END IF;

  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS public.fns_repasses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_key text NOT NULL,
      import_id %s NOT NULL,
      reference_year integer NOT NULL,
      reference_month integer CHECK (reference_month BETWEEN 1 AND 12),
      municipality_uf text NOT NULL,
      municipality_name text NOT NULL,
      municipality_ibge text NOT NULL,
      beneficiary_name text,
      beneficiary_cnpj text NOT NULL,
      transfer_identifier text NOT NULL,
      query_type text,
      gross_amount numeric(18, 2),
      discount_amount numeric(18, 2),
      net_amount numeric(18, 2),
      source_data jsonb NOT NULL,
      source_endpoint text NOT NULL,
      consulted_at timestamptz NOT NULL,
      imported_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  $ddl$, import_id_type);

  SELECT atttypid
  INTO repasse_import_id_type
  FROM pg_attribute
  WHERE attrelid = 'public.fns_repasses'::regclass
    AND attname = 'import_id'
    AND NOT attisdropped;

  IF repasse_import_id_type IS NULL THEN
    EXECUTE format(
      'ALTER TABLE public.fns_repasses ADD COLUMN import_id %s',
      import_id_type
    );
    repasse_import_id_type := import_id_type_oid;
  END IF;

  IF repasse_import_id_type <> import_id_type_oid THEN
    RAISE EXCEPTION 'O tipo de fns_repasses.import_id difere do tipo de fns_importacoes.id.';
  END IF;

  SELECT format_type(attribute.atttypid, attribute.atttypmod), attribute.atttypid
  INTO repasse_id_type, repasse_id_type_oid
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.fns_repasses'::regclass
    AND attribute.attname = 'id'
    AND NOT attribute.attisdropped;

  IF repasse_id_type IS NULL THEN
    RAISE EXCEPTION 'A coluna public.fns_repasses.id não foi encontrada.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fns_repasses_import_id_fkey'
      AND conrelid = 'public.fns_repasses'::regclass
  ) THEN
    ALTER TABLE public.fns_repasses
      ADD CONSTRAINT fns_repasses_import_id_fkey
      FOREIGN KEY (import_id)
      REFERENCES public.fns_importacoes (id);
  END IF;

  -- Create the launch table with the exact type used by fns_repasses.id.
  EXECUTE format($ddl$
    CREATE TABLE IF NOT EXISTS public.fns_financial_launches (
      action_key text PRIMARY KEY
        CHECK (action_key ~ '^[a-fA-F0-9]{64}$'),
      repasse_id %s,
      status text NOT NULL
        CHECK (status IN ('Pendente', 'Em análise', 'Conferido', 'Lançado')),
      amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
      launch_date date,
      document_number varchar(120) NOT NULL DEFAULT '',
      account_reference varchar(160) NOT NULL DEFAULT '',
      responsible varchar(120) NOT NULL DEFAULT '',
      observations varchar(2000) NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      legacy_created_at timestamptz,
      legacy_updated_at timestamptz
    )
  $ddl$, repasse_id_type);

  SELECT atttypid
  INTO launch_repasse_id_type
  FROM pg_attribute
  WHERE attrelid = 'public.fns_financial_launches'::regclass
    AND attname = 'repasse_id'
    AND NOT attisdropped;

  IF launch_repasse_id_type IS NULL THEN
    EXECUTE format(
      'ALTER TABLE public.fns_financial_launches ADD COLUMN repasse_id %s',
      repasse_id_type
    );
  ELSIF launch_repasse_id_type <> repasse_id_type_oid THEN
    RAISE EXCEPTION 'O tipo de fns_financial_launches.repasse_id difere do tipo de fns_repasses.id.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fns_financial_launches_repasse_id_fkey'
      AND conrelid = 'public.fns_financial_launches'::regclass
  ) THEN
    ALTER TABLE public.fns_financial_launches
      ADD CONSTRAINT fns_financial_launches_repasse_id_fkey
      FOREIGN KEY (repasse_id)
      REFERENCES public.fns_repasses (id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- Unique indexes support the backend's ON CONFLICT upserts and stable draft key.
CREATE UNIQUE INDEX IF NOT EXISTS fns_repasses_id_uidx
  ON public.fns_repasses (id);
CREATE UNIQUE INDEX IF NOT EXISTS fns_repasses_source_key_uidx
  ON public.fns_repasses (source_key);
CREATE UNIQUE INDEX IF NOT EXISTS fns_importacoes_id_uidx
  ON public.fns_importacoes (id);
CREATE UNIQUE INDEX IF NOT EXISTS fns_financial_launches_action_key_uidx
  ON public.fns_financial_launches (action_key);

CREATE INDEX IF NOT EXISTS fns_repasses_import_id_idx
  ON public.fns_repasses (import_id);
CREATE INDEX IF NOT EXISTS fns_repasses_reference_period_idx
  ON public.fns_repasses (reference_year, reference_month);
CREATE INDEX IF NOT EXISTS fns_repasses_municipality_uf_idx
  ON public.fns_repasses (municipality_ibge, municipality_uf);
CREATE INDEX IF NOT EXISTS fns_repasses_beneficiary_cnpj_idx
  ON public.fns_repasses (beneficiary_cnpj);
CREATE INDEX IF NOT EXISTS fns_repasses_transfer_identifier_idx
  ON public.fns_repasses (transfer_identifier);
CREATE INDEX IF NOT EXISTS fns_repasses_imported_at_idx
  ON public.fns_repasses (imported_at DESC);
CREATE INDEX IF NOT EXISTS fns_importacoes_started_at_idx
  ON public.fns_importacoes (started_at DESC);
CREATE INDEX IF NOT EXISTS fns_financial_launches_repasse_id_idx
  ON public.fns_financial_launches (repasse_id);

CREATE OR REPLACE FUNCTION public.set_fns_financial_launch_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.legacy_created_at, NEW.created_at, now());
  END IF;
  NEW.updated_at := COALESCE(NEW.legacy_updated_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fns_financial_launches_set_timestamps
  ON public.fns_financial_launches;
CREATE TRIGGER fns_financial_launches_set_timestamps
  BEFORE INSERT OR UPDATE ON public.fns_financial_launches
  FOR EACH ROW
  EXECUTE FUNCTION public.set_fns_financial_launch_timestamps();

-- No public policies are added. The backend must use its configured access mode.
ALTER TABLE public.fns_importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fns_repasses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fns_financial_launches ENABLE ROW LEVEL SECURITY;
