-- ─────────────────────────────────────────────────────────────────────────────
-- Histórico de quilometragem dos veículos
-- Rodar manualmente no Supabase → SQL Editor (idempotente, pode rodar de novo).
-- Alimentado pelo import de km (aba Revisões) e pelo futuro sync online TicketLog.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS veiculo_km_historico (
  id           BIGSERIAL PRIMARY KEY,
  veiculo_id   UUID NOT NULL REFERENCES veiculos(id) ON DELETE CASCADE,
  placa        TEXT,
  km           INTEGER NOT NULL,
  data_leitura DATE,
  origem       TEXT DEFAULT 'import',   -- 'import' | 'sync' | 'manual'
  criado_em    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (veiculo_id, data_leitura, km)  -- idempotência: re-importar o mesmo relatório não duplica
);

CREATE INDEX IF NOT EXISTS idx_km_hist_veiculo
  ON veiculo_km_historico(veiculo_id, data_leitura);

-- ─────────────────────────────────────────────────────────────────────────────
-- PARTE B (sync online TicketLog) — rodar só quando for implementar o sync.
-- Guarda a sessão do portal (renovada pelo admin a cada ~90 dias) e o estado do sync.
-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS ticketlog_sessao TEXT;
-- ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS ticketlog_sessao_expira_em TIMESTAMPTZ;
-- ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS km_sync_ultima_execucao TIMESTAMPTZ;
-- ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS km_sync_ultimo_status TEXT;
