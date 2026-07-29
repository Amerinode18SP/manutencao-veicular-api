-- ─────────────────────────────────────────────────────────────────────────────
-- Revisões programadas — agendamento manual ou por planilha, com TIPO de revisão
-- (Preventiva/Corretiva/...) e SERVIÇO (troca de pneu, alinhamento e balanceamento).
--
-- Antes disto só existia UMA data por veículo (veiculos.proxima_revisao), sem tipo
-- nem serviço. Agora um veículo pode ter várias revisões agendadas.
-- veiculos.proxima_revisao continua sendo mantida pelo backend, sempre com a data
-- da revisão PENDENTE mais próxima, pra não quebrar dashboard e relatórios.
--
-- Rodar manualmente no Supabase → SQL Editor (idempotente). Projeto: pjasyczbgghatkbgnovs
--
-- IMPORTANTE: sem comentários no fim das linhas de dentro dos comandos — quando o
-- SQL é copiado e colado e uma quebra de linha se perde, o "--" comenta o resto e
-- o erro que aparece é confuso ("syntax error at or near ...").
-- ─────────────────────────────────────────────────────────────────────────────

-- PARTE 1 — tabela da agenda
CREATE TABLE IF NOT EXISTS revisoes_programadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  veiculo_id UUID NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
  placa TEXT,
  data_prevista DATE NOT NULL,
  km_previsto INTEGER,
  tipo TEXT NOT NULL DEFAULT 'Preventiva',
  servico TEXT NOT NULL,
  observacao TEXT,
  status TEXT NOT NULL DEFAULT 'Pendente',
  concluida_em DATE,
  origem TEXT DEFAULT 'Manual',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT revisoes_programadas_unica UNIQUE (veiculo_id, data_prevista, servico)
);

CREATE INDEX IF NOT EXISTS idx_rev_prog_pendentes ON revisoes_programadas(status, data_prevista);
CREATE INDEX IF NOT EXISTS idx_rev_prog_veiculo ON revisoes_programadas(veiculo_id, data_prevista);

-- PARTE 2 — migra as datas que já existem em veiculos.proxima_revisao
INSERT INTO revisoes_programadas (veiculo_id, placa, data_prevista, tipo, servico, origem)
SELECT id, placa, proxima_revisao, 'Preventiva', 'Revisão preventiva', 'Migracao'
  FROM veiculos
 WHERE proxima_revisao IS NOT NULL
ON CONFLICT (veiculo_id, data_prevista, servico) DO NOTHING;

-- PARTE 3 — log de alertas passa a deduplicar por SERVIÇO também
-- (pneu e alinhamento no mesmo dia são dois avisos, não um)
ALTER TABLE alertas_revisao_log ADD COLUMN IF NOT EXISTS servico TEXT NOT NULL DEFAULT '';
ALTER TABLE alertas_revisao_log ADD COLUMN IF NOT EXISTS revisao_id UUID;

-- Derruba a UNIQUE antiga procurando pela definição (o nome é gerado pelo Postgres)
DO $$
DECLARE nome text;
BEGIN
  SELECT conname INTO nome
    FROM pg_constraint
   WHERE conrelid = 'alertas_revisao_log'::regclass
     AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (veiculo_id, data_revisao, dias_antecedencia)';
  IF nome IS NOT NULL THEN
    EXECUTE format('ALTER TABLE alertas_revisao_log DROP CONSTRAINT %I', nome);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'alertas_revisao_log'::regclass
       AND conname = 'alertas_revisao_log_unico'
  ) THEN
    ALTER TABLE alertas_revisao_log
      ADD CONSTRAINT alertas_revisao_log_unico
      UNIQUE (veiculo_id, data_revisao, dias_antecedencia, servico);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
