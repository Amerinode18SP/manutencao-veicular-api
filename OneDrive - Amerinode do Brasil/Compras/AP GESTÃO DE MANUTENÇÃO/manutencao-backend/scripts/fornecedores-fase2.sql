-- ============================================================
-- Fornecedores — Fase 2: integração com Ordens de Compra
-- Adiciona tabela de config global do sistema (1 linha).
-- ============================================================

CREATE TABLE IF NOT EXISTS config_sistema (
  id INTEGER PRIMARY KEY DEFAULT 1,
  bloquear_fornecedor_nao_homologado BOOLEAN DEFAULT FALSE,
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT config_sistema_single_row CHECK (id = 1)
);

-- Garante que a linha existe (com defaults)
INSERT INTO config_sistema (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
