-- ─────────────────────────────────────────────────────────────────────────────
-- Envio AGENDADO da Situação Atual da Frota (semanal, quinzenal ou mensal).
-- Rodar manualmente no Supabase → SQL Editor (idempotente).
-- Pedido da Luciana em 28/09/2026.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sit_envio_ativo      BOOLEAN   DEFAULT FALSE;
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sit_envio_emails     TEXT[]    DEFAULT '{}';
-- semanal | quinzenal | mensal
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sit_envio_frequencia TEXT      DEFAULT 'semanal';
-- 0=domingo … 6=sábado (semanal e quinzenal)
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sit_envio_dia_semana SMALLINT  DEFAULT 1;
-- 1..28 (mensal). Teto em 28 de propósito: 29, 30 e 31 não existem em todo mês,
-- e o envio simplesmente PULARIA fevereiro sem ninguém notar.
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sit_envio_dia_mes    SMALLINT  DEFAULT 1;
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sit_envio_hora       SMALLINT  DEFAULT 8;
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sit_envio_excel      BOOLEAN   DEFAULT TRUE;
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sit_envio_pdf        BOOLEAN   DEFAULT TRUE;

-- ⚠️ ESTA COLUNA É A TRAVA CONTRA ENVIO REPETIDO. O agendador acorda de 20 em 20
--    minutos; quem impede o mesmo relatório de sair três vezes na mesma manhã é
--    ela, NÃO o relógio. Sem isso, um processo reiniciado (ou dois tiques dentro
--    da mesma hora) manda o e-mail de novo, e a direção recebe duplicado.
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sit_envio_ultimo_em  TIMESTAMPTZ;
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sit_envio_ultimo_status  TEXT;
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS sit_envio_ultimo_detalhe TEXT;

UPDATE config_sistema SET sit_envio_ativo = FALSE WHERE sit_envio_ativo IS NULL;

-- ── Conferência ─────────────────────────────────────────────────────────────
-- SELECT sit_envio_ativo, sit_envio_frequencia, sit_envio_dia_semana,
--        sit_envio_dia_mes, sit_envio_hora, sit_envio_emails,
--        sit_envio_ultimo_em, sit_envio_ultimo_status
--   FROM config_sistema WHERE id = 1;
