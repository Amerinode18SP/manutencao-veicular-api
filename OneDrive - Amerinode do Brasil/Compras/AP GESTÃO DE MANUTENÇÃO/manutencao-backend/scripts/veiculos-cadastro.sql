-- ─────────────────────────────────────────────────────────────────────────────
-- Cadastro de Veículos — campos novos + preenchimento do que o sistema já sabe.
-- Rodar manualmente no Supabase → SQL Editor (idempotente: pode rodar de novo).
-- Pedido da Luciana em 28/09/2026.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Campos novos ─────────────────────────────────────────────────────────
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS modelo     VARCHAR(100);
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS supervisor VARCHAR(100);
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS renavam    VARCHAR(20);
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS chassi     VARCHAR(30);
-- ⚠️ ativo NASCE TRUE. Nascendo NULL, o veículo já cadastrado sumiria das
--    Próximas Revisões no instante em que este script rodasse — some o alerta,
--    sem erro nenhum na tela. (observacao já existia na tabela.)
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS ativo      BOOLEAN DEFAULT TRUE;
UPDATE veiculos SET ativo = TRUE WHERE ativo IS NULL;

-- Renavam e chassi são identificadores ÚNICOS do veículo: dois cadastros com o
-- mesmo número é erro de digitação, e sem esta trava ele passa despercebido.
-- O índice ignora vazios (a maioria vai ficar em branco no começo).
CREATE UNIQUE INDEX IF NOT EXISTS ux_veiculos_renavam
  ON veiculos (renavam) WHERE renavam IS NOT NULL AND renavam <> '';
CREATE UNIQUE INDEX IF NOT EXISTS ux_veiculos_chassi
  ON veiculos (chassi)  WHERE chassi  IS NOT NULL AND chassi  <> '';

-- ── 2) Traz as placas que o sistema já conhece e não estão no cadastro ──────
-- Fonte: histórico de manutenções (tem modelo, localidade e supervisor).
-- A localidade é NOT NULL na tabela, por isso o COALESCE com '—'.
INSERT INTO veiculos (placa, localidade, modelo, supervisor, ativo)
SELECT DISTINCT ON (UPPER(TRIM(m.placa)))
       UPPER(TRIM(m.placa)),
       COALESCE(NULLIF(TRIM(m.localidade), ''), '—'),
       NULLIF(TRIM(m.modelo), ''),
       NULLIF(TRIM(m.supervisor), ''),
       TRUE
  FROM manutencoes m
 WHERE COALESCE(TRIM(m.placa), '') <> ''
   AND NOT EXISTS (SELECT 1 FROM veiculos v WHERE UPPER(TRIM(v.placa)) = UPPER(TRIM(m.placa)))
 ORDER BY UPPER(TRIM(m.placa)), m.data_entrada DESC;

-- ── 3) Completa modelo/supervisor de quem já estava cadastrado ──────────────
-- Usa a manutenção MAIS RECENTE de cada placa. Só preenche o que está vazio:
-- nunca sobrescreve o que alguém digitou à mão.
WITH ult AS (
  SELECT DISTINCT ON (UPPER(TRIM(placa)))
         UPPER(TRIM(placa)) AS placa,
         NULLIF(TRIM(modelo), '')     AS modelo,
         NULLIF(TRIM(supervisor), '') AS supervisor,
         NULLIF(TRIM(localidade), '') AS localidade
    FROM manutencoes
   WHERE COALESCE(TRIM(placa), '') <> ''
   ORDER BY UPPER(TRIM(placa)), data_entrada DESC
)
UPDATE veiculos v
   SET modelo     = COALESCE(NULLIF(TRIM(v.modelo), ''),     ult.modelo),
       supervisor = COALESCE(NULLIF(TRIM(v.supervisor), ''), ult.supervisor),
       localidade = CASE WHEN COALESCE(TRIM(v.localidade), '') IN ('', '—')
                         THEN COALESCE(ult.localidade, v.localidade) ELSE v.localidade END,
       updated_at = NOW()
  FROM ult
 WHERE UPPER(TRIM(v.placa)) = ult.placa;

-- ── 4) Modelo pelo Cobli, para quem ainda ficou sem ─────────────────────────
-- Roda depois do passo 3 de propósito: o histórico de manutenção é escrito por
-- gente, o Cobli é o nome de catálogo. Preferimos o que a equipe escreveu.
UPDATE veiculos v
   SET modelo = NULLIF(TRIM(c.modelo), ''), updated_at = NOW()
  FROM cobli_vehicles c
 WHERE UPPER(TRIM(v.placa)) = UPPER(TRIM(c.placa))
   AND COALESCE(TRIM(v.modelo), '') = ''
   AND COALESCE(TRIM(c.modelo), '') <> '';

-- ── Conferência ─────────────────────────────────────────────────────────────
-- SELECT COUNT(*) AS total,
--        COUNT(*) FILTER (WHERE ativo)                      AS ativos,
--        COUNT(*) FILTER (WHERE COALESCE(modelo,'')     <> '') AS com_modelo,
--        COUNT(*) FILTER (WHERE COALESCE(supervisor,'') <> '') AS com_supervisor,
--        COUNT(*) FILTER (WHERE COALESCE(renavam,'')    <> '') AS com_renavam,
--        COUNT(*) FILTER (WHERE COALESCE(chassi,'')     <> '') AS com_chassi
--   FROM veiculos;
