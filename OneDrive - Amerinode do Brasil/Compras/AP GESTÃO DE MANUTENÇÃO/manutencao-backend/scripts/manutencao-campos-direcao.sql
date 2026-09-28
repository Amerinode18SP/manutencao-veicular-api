-- ─────────────────────────────────────────────────────────────────────────────
-- Campos pedidos pela direção (28/09/2026) para o painel Situação Atual.
-- Rodar manualmente no Supabase → SQL Editor (idempotente).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Qual carro alugado está substituindo ─────────────────────────────────
-- Hoje `veiculo_alugado` é só sim/não: o painel sabia dizer "3 alugados ativos"
-- e não sabia dizer QUAIS carros eram.
ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS placa_alugado VARCHAR(10);

-- ── 2) Previsão de devolução do alugado ─────────────────────────────────────
-- `data_devolucao` já existia, mas é a data EFETIVA — preenchida depois que
-- acontece. Não dava para cobrar prazo de nada, só registrar o passado.
ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS previsao_devolucao DATE;

-- ── 3) Serviço realizado ────────────────────────────────────────────────────
-- Antes o serviço era escrito nas observações, junto de qualquer outra anotação.
-- ⚠️ NÃO migramos observacoes para cá: nem toda observação é serviço, e mover em
--    massa transformaria recado ("aguardando peça do fornecedor") em serviço
--    executado. O histórico fica como está; a coluna nova vale daqui para frente
--    e a tela cai nas observações quando ela estiver vazia.
ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS servico_realizado TEXT;

-- ── 4) Em processo de seguro ────────────────────────────────────────────────
-- Marcação À PARTE, e não um status (decisão da Luciana): o seguro corre em
-- paralelo — o carro pode já ter voltado da oficina com o processo ainda aberto,
-- e um status só conseguiria contar uma das duas coisas.
-- Nasce FALSE, nunca NULL: NULL faria a contagem do painel ignorar a linha.
ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS em_seguro BOOLEAN DEFAULT FALSE;
UPDATE manutencoes SET em_seguro = FALSE WHERE em_seguro IS NULL;

CREATE INDEX IF NOT EXISTS idx_manutencoes_em_seguro ON manutencoes(em_seguro) WHERE em_seguro;

-- ── Conferência ─────────────────────────────────────────────────────────────
-- SELECT placa, placa_alugado, previsao_devolucao, em_seguro,
--        LEFT(COALESCE(servico_realizado, observacoes), 40) AS servico
--   FROM manutencoes ORDER BY data_entrada DESC LIMIT 20;
