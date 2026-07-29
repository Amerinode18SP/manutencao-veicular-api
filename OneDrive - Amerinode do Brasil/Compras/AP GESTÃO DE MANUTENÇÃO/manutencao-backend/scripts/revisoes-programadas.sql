-- ─────────────────────────────────────────────────────────────────────────────
-- Revisões programadas — agendamento manual ou por planilha, com TIPO de revisão
-- (Preventiva/Corretiva/...) e SERVIÇO (troca de pneu, alinhamento e balanceamento…).
--
-- Antes disto só existia UMA data por veículo (veiculos.proxima_revisao), sem tipo
-- nem serviço. Agora um veículo pode ter várias revisões agendadas.
-- `veiculos.proxima_revisao` continua sendo mantida pelo backend, sempre com a
-- data da revisão PENDENTE mais próxima, pra não quebrar o dashboard e relatórios.
--
-- Rodar manualmente no Supabase → SQL Editor (idempotente). Projeto: pjasyczbgghatkbgnovs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS revisoes_programadas (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  veiculo_id    UUID NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
  placa         TEXT,                                  -- desnormalizado: facilita planilha/relatório
  data_prevista DATE NOT NULL,
  km_previsto   INTEGER,                               -- opcional: km em que o serviço vence
  tipo          TEXT NOT NULL DEFAULT 'Preventiva',    -- Preventiva | Corretiva | Preditiva | Segurança
  servico       TEXT NOT NULL,                         -- Troca de pneu | Alinhamento e balanceamento | Troca de óleo | ...
  observacao    TEXT,
  status        TEXT NOT NULL DEFAULT 'Pendente',      -- Pendente | Concluída | Cancelada
  concluida_em  DATE,
  origem        TEXT DEFAULT 'Manual',                 -- Manual | Planilha | Migracao
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  -- idempotência: reimportar a mesma planilha não duplica agendamento
  CONSTRAINT revisoes_programadas_unica UNIQUE (veiculo_id, data_prevista, servico)
);

CREATE INDEX IF NOT EXISTS idx_rev_prog_pendentes ON revisoes_programadas(status, data_prevista);
CREATE INDEX IF NOT EXISTS idx_rev_prog_veiculo   ON revisoes_programadas(veiculo_id, data_prevista);

-- ── Migra o que já existe em veiculos.proxima_revisao ────────────────────────
-- Cada data solta vira uma revisão preventiva genérica, para nada se perder.
INSERT INTO revisoes_programadas (veiculo_id, placa, data_prevista, tipo, servico, origem)
SELECT id, placa, proxima_revisao, 'Preventiva', 'Revisão preventiva', 'Migracao'
  FROM veiculos
 WHERE proxima_revisao IS NOT NULL
ON CONFLICT (veiculo_id, data_prevista, servico) DO NOTHING;

-- ── Log de alertas: agora a chave inclui o SERVIÇO ───────────────────────────
-- Sem isso, duas revisões do mesmo veículo na mesma data (ex.: pneu + alinhamento)
-- colidiriam e só uma seria avisada.
ALTER TABLE alertas_revisao_log ADD COLUMN IF NOT EXISTS servico    TEXT NOT NULL DEFAULT '';
ALTER TABLE alertas_revisao_log ADD COLUMN IF NOT EXISTS revisao_id UUID;

-- Derruba a UNIQUE antiga (nome é gerado pelo Postgres, então busca pela definição)
DO $$
DECLARE nome text;
BEGIN
  SELECT conname INTO nome
    FROM pg_constraint
   WHERE conrelid = 'alertas_revisao_log'::regclass
     AND contype  = 'u'
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
       AND conname  = 'alertas_revisao_log_unico'
  ) THEN
    ALTER TABLE alertas_revisao_log
      ADD CONSTRAINT alertas_revisao_log_unico
      UNIQUE (veiculo_id, data_revisao, dias_antecedencia, servico);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
