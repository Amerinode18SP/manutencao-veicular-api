-- ─────────────────────────────────────────────────────────────────────────────
-- Revisão: marcação "providência tomada" (já autorizado e oficina avisada).
-- Rodar manualmente no Supabase → SQL Editor (idempotente).
-- Pedido da Luciana em 04/11/2026.
--
-- POR QUÊ: as revisões VENCIDAS passaram a entrar no alerta por e-mail e a
-- repetir uma vez por semana enquanto não forem resolvidas. Sem um jeito de
-- dizer "esta aqui já está encaminhada", o aviso semanal cobraria de novo o que
-- já foi autorizado — e alarme que cobra o que já foi feito ensina a ignorar o
-- alarme. Marcando a providência, o veículo sai do e-mail e continua na tela,
-- com selo próprio e a observação explicando o que ficou combinado.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE revisoes_programadas ADD COLUMN IF NOT EXISTS providencia    BOOLEAN DEFAULT FALSE;
-- Quando foi marcada. Sem a data não dá para saber se a autorização é de ontem
-- ou de dois meses atrás, e um carro sumiria do aviso para sempre.
ALTER TABLE revisoes_programadas ADD COLUMN IF NOT EXISTS providencia_em TIMESTAMPTZ;

UPDATE revisoes_programadas SET providencia = FALSE WHERE providencia IS NULL;

-- ── Conferência ─────────────────────────────────────────────────────────────
-- SELECT placa, servico, data_prevista, providencia, providencia_em, observacao
--   FROM revisoes_programadas WHERE status = 'Pendente' ORDER BY data_prevista;
