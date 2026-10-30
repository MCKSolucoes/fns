-- ==============================================================================
-- Schema Completo para o Módulo FNS (Fundo Nacional de Saúde) - MCK Soluções
-- ==============================================================================

-- 1. Tabela: fns_importacoes (Histórico de importações do FNS)
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

-- 2. Tabela: fns_repasses (Registros de repasses oficiais importados)
CREATE TABLE IF NOT EXISTS public.fns_repasses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL,
  import_id uuid NOT NULL REFERENCES public.fns_importacoes(id) ON DELETE CASCADE,
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
  source_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_endpoint text NOT NULL DEFAULT '',
  consulted_at timestamptz NOT NULL DEFAULT now(),
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Tabela: fns_financial_launches (Lançamentos financeiros de repasse)
CREATE TABLE IF NOT EXISTS public.fns_financial_launches (
  action_key text PRIMARY KEY,
  repasse_id uuid REFERENCES public.fns_repasses(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'Pendente'
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
);

-- 4. Tabela: fns_financial_complements (Complementos de conferência e observações)
CREATE TABLE IF NOT EXISTS public.fns_financial_complements (
  action_key text PRIMARY KEY,
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

-- 5. Tabela: deputados (Deputados e parlamentares autores de emendas)
CREATE TABLE IF NOT EXISTS public.deputados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  partido text,
  uf text,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Tabela: emendas_estaduais (Emendas parlamentares vinculadas ao município)
CREATE TABLE IF NOT EXISTS public.emendas_estaduais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text,
  uf text NOT NULL,
  identificacao text NOT NULL,
  valor numeric(18, 2) NOT NULL DEFAULT 0,
  objeto text NOT NULL DEFAULT '',
  observacoes text,
  deputado_id uuid REFERENCES public.deputados(id) ON DELETE SET NULL,
  legacy_created_at timestamptz,
  legacy_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 7. Tabela: baixas (Baixas e conciliações financeiras dos repasses)
CREATE TABLE IF NOT EXISTS public.baixas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text,
  repasse_id uuid REFERENCES public.fns_repasses(id) ON DELETE SET NULL,
  repasse_snapshot jsonb,
  transfer_identifier text NOT NULL,
  deputado_id uuid REFERENCES public.deputados(id) ON DELETE SET NULL,
  deputado_nome_snapshot text,
  emenda_id uuid REFERENCES public.emendas_estaduais(id) ON DELETE SET NULL,
  emenda_snapshot jsonb,
  beneficiary text NOT NULL,
  document text,
  paid_amount numeric(18, 2) NOT NULL DEFAULT 0,
  payment_date date,
  status text NOT NULL DEFAULT 'Pendente'
    CHECK (status IN ('Pendente', 'Em processamento', 'Pago', 'Pago parcialmente', 'Cancelado')),
  description text NOT NULL DEFAULT '',
  document_reference text,
  legacy_created_at timestamptz,
  legacy_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Tabela: baixa_historico (Trilha de auditoria das baixas)
CREATE TABLE IF NOT EXISTS public.baixa_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text,
  baixa_id uuid REFERENCES public.baixas(id) ON DELETE CASCADE,
  transfer_identifier text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL DEFAULT '',
  justification text,
  previous_values jsonb,
  new_values jsonb,
  repasse_snapshot jsonb,
  emenda_snapshot jsonb,
  deputado_nome_snapshot text,
  baixa_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 9. Tabela: fns_installment_reviews (Revisões e justificativas de parcelas)
CREATE TABLE IF NOT EXISTS public.fns_installment_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text,
  alert_key text NOT NULL,
  status text NOT NULL DEFAULT 'Pendente',
  justification text,
  alert_snapshot jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 10. Tabela: audit_logs (Auditoria geral de ações se não existir)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resource text NOT NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ==============================================================================
-- Índices para Performance e Integridade
-- ==============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS fns_repasses_source_key_uidx ON public.fns_repasses (source_key);
CREATE INDEX IF NOT EXISTS fns_repasses_import_id_idx ON public.fns_repasses (import_id);
CREATE INDEX IF NOT EXISTS fns_repasses_period_idx ON public.fns_repasses (reference_year, reference_month);
CREATE INDEX IF NOT EXISTS fns_repasses_ibge_idx ON public.fns_repasses (municipality_ibge, municipality_uf);
CREATE INDEX IF NOT EXISTS fns_repasses_cnpj_idx ON public.fns_repasses (beneficiary_cnpj);
CREATE INDEX IF NOT EXISTS fns_repasses_transfer_idx ON public.fns_repasses (transfer_identifier);

CREATE INDEX IF NOT EXISTS fns_financial_launches_repasse_idx ON public.fns_financial_launches (repasse_id);
CREATE INDEX IF NOT EXISTS fns_financial_complements_updated_idx ON public.fns_financial_complements (updated_at DESC);

CREATE INDEX IF NOT EXISTS baixas_repasse_id_idx ON public.baixas (repasse_id);
CREATE INDEX IF NOT EXISTS baixas_deputado_id_idx ON public.baixas (deputado_id);
CREATE INDEX IF NOT EXISTS baixas_emenda_id_idx ON public.baixas (emenda_id);
CREATE INDEX IF NOT EXISTS baixa_historico_baixa_id_idx ON public.baixa_historico (baixa_id);
CREATE INDEX IF NOT EXISTS emendas_deputado_id_idx ON public.emendas_estaduais (deputado_id);

-- ==============================================================================
-- Row Level Security (RLS) - Restrição para Gestores e Administradores
-- ==============================================================================

ALTER TABLE public.fns_importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fns_repasses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fns_financial_launches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fns_financial_complements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deputados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emendas_estaduais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.baixas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.baixa_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fns_installment_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper: Políticas unificadas para gestor e admin
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'fns_importacoes',
      'fns_repasses',
      'fns_financial_launches',
      'fns_financial_complements',
      'deputados',
      'emendas_estaduais',
      'baixas',
      'baixa_historico',
      'fns_installment_reviews',
      'audit_logs'
    ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Gestores e admins acesso FNS" ON public.%I;', tbl);
    EXECUTE format($p$
      CREATE POLICY "Gestores e admins acesso FNS"
      ON public.%I
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE profiles.id = auth.uid()
            AND LOWER(profiles.cargo) IN ('gestor', 'admin')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE profiles.id = auth.uid()
            AND LOWER(profiles.cargo) IN ('gestor', 'admin')
        )
      );
    $p$, tbl);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

