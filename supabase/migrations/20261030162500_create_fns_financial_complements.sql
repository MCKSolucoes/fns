CREATE TABLE IF NOT EXISTS public.fns_financial_complements (
  action_key text PRIMARY KEY
    CHECK (char_length(action_key) BETWEEN 1 AND 256),
  observations text NOT NULL DEFAULT '',
  review_status text NOT NULL DEFAULT ''
    CHECK (review_status IN (
      '',
      'Não iniciada',
      'Em conferência',
      'Conferida',
      'Pendente de esclarecimento'
    )),
  review_responsible text NOT NULL DEFAULT '',
  internal_reference text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  legacy_updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS fns_financial_complements_updated_at_idx
  ON public.fns_financial_complements (updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_fns_financial_complement_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := COALESCE(NEW.legacy_updated_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fns_financial_complements_set_timestamps
  ON public.fns_financial_complements;
CREATE TRIGGER fns_financial_complements_set_timestamps
  BEFORE INSERT OR UPDATE ON public.fns_financial_complements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_fns_financial_complement_timestamps();

ALTER TABLE public.fns_financial_complements ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
