-- ─────────────────────────────────────────────────────────────────────────────
-- "Substituído por" — qual veículo entrou no lugar do que saiu da frota.
-- Rodar manualmente no Supabase → SQL Editor (idempotente).
-- Pedido da Luciana em 28/09/2026, para perda total e venda.
-- ─────────────────────────────────────────────────────────────────────────────

-- É uma LIGAÇÃO com o cadastro, e não dois campos de texto com placa e modelo.
-- Dois motivos:
--   1. placa digitada à mão volta a criar carro fantasma — foi exatamente o que
--      encheu o cadastro de QN0ZH31 e OS260107;
--   2. corrigir o modelo do substituto depois passa a valer aqui sozinho; com o
--      texto copiado, os dois envelhecem separados e ninguém percebe.
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS substituido_por_id UUID;

-- ON DELETE SET NULL: se o substituto for excluído algum dia, o veículo antigo
-- só perde a ligação — não some junto.
ALTER TABLE veiculos DROP CONSTRAINT IF EXISTS veiculos_substituido_por_fk;
ALTER TABLE veiculos ADD  CONSTRAINT veiculos_substituido_por_fk
  FOREIGN KEY (substituido_por_id) REFERENCES veiculos(id) ON DELETE SET NULL;

-- Ninguém substitui a si mesmo. Sem esta trava, um clique errado cria um
-- registro que se aponta e a tela mostra "substituído por ele mesmo".
ALTER TABLE veiculos DROP CONSTRAINT IF EXISTS veiculos_substituido_por_check;
ALTER TABLE veiculos ADD  CONSTRAINT veiculos_substituido_por_check
  CHECK (substituido_por_id IS NULL OR substituido_por_id <> id);

CREATE INDEX IF NOT EXISTS idx_veiculos_substituido_por ON veiculos(substituido_por_id);

-- ── Conferência ─────────────────────────────────────────────────────────────
-- SELECT v.placa AS saiu, v.motivo_baixa, s.placa AS entrou, s.modelo
--   FROM veiculos v LEFT JOIN veiculos s ON s.id = v.substituido_por_id
--  WHERE v.substituido_por_id IS NOT NULL;
