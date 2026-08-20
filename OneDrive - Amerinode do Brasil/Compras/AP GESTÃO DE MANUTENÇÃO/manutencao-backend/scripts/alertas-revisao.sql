-- ─────────────────────────────────────────────────────────────────────────────
-- Alertas de revisão por e-mail — configuração do OPERADOR (nada fixo no código)
-- Rodar manualmente no Supabase → SQL Editor (idempotente). Projeto: pjasyczbgghatkbgnovs
-- Depois de rodar: NOTIFY pgrst, 'reload schema';
-- ─────────────────────────────────────────────────────────────────────────────

-- config_sistema é a linha única (id=1) de config global. Criada aqui se faltar.
CREATE TABLE IF NOT EXISTS config_sistema (
  id INTEGER PRIMARY KEY DEFAULT 1,
  bloquear_fornecedor_nao_homologado BOOLEAN DEFAULT FALSE,
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT config_sistema_single_row CHECK (id = 1)
);
INSERT INTO config_sistema (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Parâmetros ajustáveis pela tela (aba Próximas Revisões → 🔔 Alertas) ──────
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_ativo            BOOLEAN     DEFAULT FALSE;      -- liga/desliga o disparo automático
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_emails           TEXT[]      DEFAULT '{}';       -- quem recebe (lista editável)
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_dias             INTEGER[]   DEFAULT '{10,7}';   -- antecedências: 10 e 7 dias antes (editável)
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_incluir_vencidas BOOLEAN     DEFAULT TRUE;       -- avisa também as revisões já vencidas
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_hora             SMALLINT    DEFAULT 8;          -- hora do disparo (0-23, horário de Brasília)
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_assunto          TEXT;                           -- assunto customizado (aceita {n} e {data})
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_mensagem         TEXT;                           -- recado livre que aparece no corpo, acima da tabela
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_ultima_execucao  TIMESTAMPTZ;                    -- quando rodou por último
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_ultimo_status    TEXT;                           -- ok | sem_pendencias | sem_destinatarios | desativado | erro
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_ultimo_detalhe   TEXT;                           -- mensagem legível do último disparo

-- ── Avisos TÉCNICOS da integração (sessão TicketLog caiu) ────────────────────
-- Lista SEPARADA de propósito: o alerta de revisão vai para o time todo, mas o
-- aviso técnico só interessa a quem administra a integração. Vazio = ninguém recebe.
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_tecnico_emails           TEXT[]      DEFAULT '{}';

-- ── Log de envios: evita mandar o MESMO aviso duas vezes ─────────────────────
-- Uma linha por (veículo, data da revisão, antecedência). dias_antecedencia = -1
-- representa o aviso de revisão VENCIDA.
CREATE TABLE IF NOT EXISTS alertas_revisao_log (
  id                BIGSERIAL PRIMARY KEY,
  veiculo_id        UUID REFERENCES veiculos(id) ON DELETE CASCADE,
  placa             TEXT,
  data_revisao      DATE,
  dias_antecedencia INTEGER NOT NULL,
  destinatarios     TEXT[],
  enviado_em        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (veiculo_id, data_revisao, dias_antecedencia)
);

CREATE INDEX IF NOT EXISTS idx_alertas_revisao_log_envio
  ON alertas_revisao_log(enviado_em DESC);

-- PostgREST costuma não enxergar colunas novas na hora:
NOTIFY pgrst, 'reload schema';
