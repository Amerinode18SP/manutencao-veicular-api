-- ============================================================
-- Fornecedores — Fase 1: cadastro completo + homologação
-- Rodar no SQL Editor do Supabase.
-- Tudo idempotente (IF NOT EXISTS), seguro pra re-executar.
-- ============================================================

-- Dados básicos extras
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS nome_fantasia          TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS inscricao_estadual     TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS contato_principal      TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS telefone               TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS whatsapp               TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS email                  TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS local_atende           TEXT;

-- Classificação (lista de tipos de serviço)
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS tipos_servico          TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Homologação
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS homologado             BOOLEAN DEFAULT FALSE;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS data_homologacao       DATE;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS responsavel_homologacao TEXT;

-- Endereço
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS cep         TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS rua         TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS numero      TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS complemento TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS bairro      TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS cidade      TEXT;
ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS estado      TEXT;   -- UF (2 letras)

-- Indices pra filtros mais rapidos
CREATE INDEX IF NOT EXISTS idx_fornecedores_homologado ON fornecedores(homologado);
CREATE INDEX IF NOT EXISTS idx_fornecedores_cidade     ON fornecedores(cidade);
CREATE INDEX IF NOT EXISTS idx_fornecedores_tipos_serv ON fornecedores USING GIN (tipos_servico);
