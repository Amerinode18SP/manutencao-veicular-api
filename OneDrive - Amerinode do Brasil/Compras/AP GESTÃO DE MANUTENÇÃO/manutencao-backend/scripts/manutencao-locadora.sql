-- ─────────────────────────────────────────────────────────────────────────────
-- Troca "placa do alugado" por LOCADORA.
-- Rodar manualmente no Supabase → SQL Editor (idempotente).
-- Decisão da Luciana em 28/09/2026.
--
-- POR QUÊ: a locadora troca a placa durante o contrato. Guardar a placa fazia o
-- registro nascer errado — no dia da troca, o painel passaria a apontar um carro
-- que não está mais ali, e ninguém iria perceber. A locadora é o que não muda
-- enquanto o contrato vigora.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS locadora VARCHAR(100);

-- Salva-vidas: se alguma placa tiver sido preenchida entre a criação do campo e
-- esta troca, o valor é levado para a locadora em vez de sumir.
-- (Conferido em 28/09/2026: nenhuma linha preenchida — a coluna nasceu hoje.)
UPDATE manutencoes
   SET locadora = placa_alugado
 WHERE COALESCE(TRIM(placa_alugado), '') <> ''
   AND COALESCE(TRIM(locadora), '') = '';

ALTER TABLE manutencoes DROP COLUMN IF EXISTS placa_alugado;

-- ── Conferência ─────────────────────────────────────────────────────────────
-- SELECT placa, locadora, previsao_devolucao, veiculo_alugado, veiculo_devolvido
--   FROM manutencoes WHERE veiculo_alugado AND NOT veiculo_devolvido;
