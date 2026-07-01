-- ─────────────────────────────────────────────────────────────────────────────
-- Snapshot do último relatório "Últimas Quilometragens/Horas" do TicketLog.
-- Uma linha por PLACA do relatório (a leitura mais recente), independente de o
-- veículo estar cadastrado. Alimenta a subaba "Quilometragem" (Análise de Gastos),
-- que passa a mostrar exatamente as placas do relatório.
-- Rodar manualmente no Supabase → SQL Editor (idempotente).
-- IMPORTANTE: rodar no projeto CERTO (o do app de manutenção): pjasyczbgghatkbgnovs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS km_ticketlog (
  placa         TEXT PRIMARY KEY,
  km            INTEGER,
  data_leitura  DATE,
  hora          TEXT,
  status        TEXT,        -- ok | regressao | invalido | nao_encontrado (do último import)
  veiculo_id    UUID,        -- null se a placa não está cadastrada em veiculos
  importado_em  TIMESTAMPTZ DEFAULT now()
);
