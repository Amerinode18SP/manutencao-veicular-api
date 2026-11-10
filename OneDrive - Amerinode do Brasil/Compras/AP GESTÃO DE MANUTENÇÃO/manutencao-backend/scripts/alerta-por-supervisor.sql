-- ─────────────────────────────────────────────────────────────────────────────
-- Alerta de revisão dividido por supervisor, com gestores acompanhando tudo.
-- Rodar manualmente no Supabase → SQL Editor (idempotente).
-- Pedido da Luciana em 10/11/2026.
--
-- POR QUÊ: hoje sai UM e-mail com a frota inteira para os oito da lista. Cada
-- supervisor recebe os carros dos outros, e quem recebe cobrança que não é sua
-- aprende a ignorar o e-mail.
--
-- POR QUE POR SUPERVISOR, E NÃO POR LOCALIDADE: em 3 das 11 localidades há dois
-- supervisores diferentes (Jaguaré: Renato e Carlisson; Campinas: Walter e
-- Renato; Taubaté: Adilson e Walter). Dividir por cidade mandaria o carro do
-- Carlisson para o Renato. O supervisor está preenchido nas 22 revisões
-- pendentes, então o corte por pessoa funciona hoje.
-- ─────────────────────────────────────────────────────────────────────────────

-- Liga/desliga a divisão. FALSE mantém exatamente o comportamento de hoje:
-- um e-mail só, com tudo, para a lista geral.
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_dividir BOOLEAN DEFAULT FALSE;

-- Quem é cada supervisor: { "WALTER": "walter.junior@amerinode.com.br", ... }
-- A chave é o nome EXATAMENTE como está em veiculos.supervisor — é por ele que
-- o e-mail acha o dono do carro. Supervisor sem e-mail aqui não deixa de ser
-- avisado: os veículos dele continuam na cópia completa dos gestores.
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS alerta_revisao_supervisores JSONB DEFAULT '{}'::jsonb;

UPDATE config_sistema SET alerta_revisao_dividir = FALSE      WHERE alerta_revisao_dividir IS NULL;
UPDATE config_sistema SET alerta_revisao_supervisores = '{}'::jsonb WHERE alerta_revisao_supervisores IS NULL;

-- ── Conferência ─────────────────────────────────────────────────────────────
-- SELECT alerta_revisao_dividir, alerta_revisao_supervisores, alerta_revisao_emails
--   FROM config_sistema WHERE id = 1;
