-- ─────────────────────────────────────────────────────────────────────────────
-- PERDA TOTAL — encerrar a manutenção e dar baixa no veículo.
-- Rodar manualmente no Supabase → SQL Editor (idempotente).
-- Pedido da Luciana em 28/09/2026.
--
-- O PROBLEMA QUE ISTO RESOLVE: carro com perda total nunca "retorna". Sem um
-- jeito de encerrar, a manutenção dele ficava EM ABERTO para sempre no painel
-- Situação Atual — contando como veículo parado e inflando o "% da frota
-- parada" todo mês — e o veículo seguia ativo, entrando nas Próximas Revisões
-- de um carro que não existe mais.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Status novo na manutenção ────────────────────────────────────────────
-- Vai ao lado de Retornado e Cancelado. Ter status PRÓPRIO (em vez de usar
-- "Cancelado" com uma observação) é o que permite contar quantas perdas houve
-- no ano — com "Cancelado" some a diferença entre "cancelei o serviço" e "o
-- carro foi perdido".
ALTER TABLE manutencoes DROP CONSTRAINT IF EXISTS manutencoes_status_check;
ALTER TABLE manutencoes ADD  CONSTRAINT manutencoes_status_check
  CHECK (status IN ('Em Andamento','Retornado','Cancelado','Orçamento','Aprovado','Perda total'));

-- ── 2) Baixa no cadastro do veículo ─────────────────────────────────────────
-- motivo_baixa cobre também VENDIDO e DEVOLVIDO, que hoje não tinham onde ser
-- registrados e acabavam virando texto solto na observação.
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS motivo_baixa VARCHAR(30);
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS data_baixa   DATE;

ALTER TABLE veiculos DROP CONSTRAINT IF EXISTS veiculos_motivo_baixa_check;
ALTER TABLE veiculos ADD  CONSTRAINT veiculos_motivo_baixa_check
  CHECK (motivo_baixa IS NULL OR motivo_baixa IN ('Perda total','Vendido','Devolvido','Outro'));

-- ⚠️ NÃO existe trava no banco ligando motivo_baixa a ativo=false.
--    Quem garante que veículo com baixa fica inativo é o servidor (outros.js) —
--    de propósito: a coluna `ativo` já existia e pode ter sido preenchida antes
--    desta migração, e uma trava aqui faria falhar UPDATE de linha antiga que
--    nada tem a ver com baixa.

CREATE INDEX IF NOT EXISTS idx_veiculos_motivo_baixa ON veiculos(motivo_baixa);

-- ── Conferência ─────────────────────────────────────────────────────────────
-- SELECT status, COUNT(*) FROM manutencoes GROUP BY status ORDER BY 1;
-- SELECT motivo_baixa, COUNT(*) FROM veiculos GROUP BY motivo_baixa ORDER BY 1;
