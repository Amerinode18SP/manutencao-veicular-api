-- ─────────────────────────────────────────────────────────────────────────────
-- Parte B — sync online do km via TicketLog (portal legado ColdFusion).
-- Guarda o COOKIE de sessão do portal (rotacionado pelo admin quando expira) e o
-- status da última sincronização, na linha única de config_sistema (id=1).
-- Rodar manualmente no Supabase → SQL Editor (idempotente). Projeto: pjasyczbgghatkbgnovs
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS ticketlog_sessao           TEXT;        -- cookie da sessão do portal (segredo; NUNCA exposto no GET /api/config)
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS ticketlog_sessao_expira_em TIMESTAMPTZ; -- estimativa/anotação de validade (informativo)
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS km_sync_ultima_execucao    TIMESTAMPTZ; -- quando o /api/km/sync rodou por último
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS km_sync_ultimo_status      TEXT;        -- ok | expirado | erro | sem_sessao
