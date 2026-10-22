-- ─────────────────────────────────────────────────────────────────────────────
-- Alerta da sessão TicketLog: tolerar queda passageira e avisar quando voltar.
-- Rodar manualmente no Supabase → SQL Editor (idempotente).
-- Pedido da Luciana em 22/10/2026.
--
-- POR QUÊ: em 21/10 a sessão caiu por alguns minutos, o e-mail de alerta saiu, e
-- o sistema se reconectou sozinho na verificação seguinte — sem ninguém ser
-- avisado de que voltou. Alarme que dispara à toa e nunca diz "passou" ensina a
-- ignorar o alarme, e aí o dia em que for sério ninguém olha.
-- ─────────────────────────────────────────────────────────────────────────────

-- Quantas verificações seguidas falharam. Zera assim que a sessão volta.
-- O e-mail só sai a partir da SEGUNDA falha seguida (~30 min caído).
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS km_keepalive_falhas INTEGER DEFAULT 0;
UPDATE config_sistema SET km_keepalive_falhas = 0 WHERE km_keepalive_falhas IS NULL;

-- ── Conferência ─────────────────────────────────────────────────────────────
-- SELECT km_keepalive_em, km_keepalive_status, km_keepalive_falhas
--   FROM config_sistema WHERE id = 1;
