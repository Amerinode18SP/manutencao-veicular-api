-- ─────────────────────────────────────────────────────────────────────────────
-- Padronização da tabela MANUTENÇÕES (localidade, modelo, supervisor, oficina).
-- Rodar manualmente no Supabase → SQL Editor (idempotente).
-- Pedido da Luciana em 28/09/2026, depois de padronizar o cadastro de veículos.
--
-- POR QUE EXISTE UM SCRIPT SÓ PARA ESTA TABELA: manutencoes guarda a própria
-- cópia de localidade/modelo/supervisor, digitada no registro da manutenção.
-- Padronizar só `veiculos` deixou o painel Situação Atual mostrando "JAGUARE"
-- enquanto o cadastro já dizia "JAGUARÉ" — mesma frota, duas grafias na tela.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Cidades escritas de dois jeitos ──────────────────────────────────────
UPDATE manutencoes SET localidade = 'JAGUARÉ', updated_at = NOW()
 WHERE TRIM(localidade) IN ('JAGUARE', 'Jaguare', 'Jaguaré', 'JGE', 'jge');

UPDATE manutencoes SET localidade = 'JUNDIAÍ', updated_at = NOW()
 WHERE TRIM(localidade) IN ('JUNDIAI', 'Jundiai', 'Jundiaí');

UPDATE manutencoes SET localidade = 'RIBEIRÃO PRETO', updated_at = NOW()
 WHERE TRIM(localidade) IN ('RIBEIRAO PRETO', 'Ribeirao Preto', 'Ribeirão Preto');

UPDATE manutencoes SET localidade = 'SJ DO RIO PRETO', updated_at = NOW()
 WHERE TRIM(localidade) IN ('SJ RIO PRETO', 'SAO JOSE DO RIO PRETO', 'SÃO JOSÉ DO RIO PRETO');

-- ── 2) Modelo: mesmo padrão curto do cadastro de veículos ───────────────────
UPDATE manutencoes SET modelo = 'VOYAGE',  updated_at = NOW() WHERE UPPER(TRIM(modelo)) LIKE 'VOYAGE%';
UPDATE manutencoes SET modelo = 'KWID',    updated_at = NOW() WHERE UPPER(TRIM(modelo)) LIKE '%KWID%';
UPDATE manutencoes SET modelo = 'FIORINO', updated_at = NOW() WHERE UPPER(TRIM(modelo)) LIKE '%FIORINO%';
UPDATE manutencoes SET modelo = 'HB20',    updated_at = NOW() WHERE UPPER(TRIM(modelo)) LIKE '%HB20%';
UPDATE manutencoes SET modelo = 'LEAF',    updated_at = NOW() WHERE UPPER(TRIM(modelo)) LIKE '%LEAF%';
UPDATE manutencoes SET modelo = 'SAVEIRO', updated_at = NOW() WHERE UPPER(TRIM(modelo)) LIKE '%SAVEIRO%';
UPDATE manutencoes SET modelo = 'DOBLO',   updated_at = NOW() WHERE UPPER(TRIM(modelo)) LIKE '%DOBLO%';
UPDATE manutencoes SET modelo = 'MOBI',    updated_at = NOW() WHERE UPPER(TRIM(modelo)) LIKE '%MOBI%';
UPDATE manutencoes SET modelo = 'IVECO',   updated_at = NOW() WHERE UPPER(TRIM(modelo)) LIKE '%IVECO%';

-- ── 3) "&amp;" que veio junto da planilha importada ─────────────────────────
-- É o código HTML do "&" gravado como texto: aparece literalmente na tela como
-- "ANTONIOLI &amp; ANTONIOLI". Não é defeito do formulário (conferido em
-- 28/09/2026) — veio no arquivo de origem.
UPDATE manutencoes SET oficina = REPLACE(oficina, '&amp;', '&'), updated_at = NOW()
 WHERE oficina LIKE '%&amp;%';

-- ── 4) Caixa alta geral, para não divergir de novo ──────────────────────────
-- Mesma regra que o servidor passou a aplicar ao gravar (28/09/2026).
-- Vazio continua vazio: não inventa dado.
UPDATE manutencoes SET localidade = UPPER(TRIM(localidade)), updated_at = NOW()
 WHERE COALESCE(TRIM(localidade),'') <> '' AND localidade <> UPPER(TRIM(localidade));
UPDATE manutencoes SET supervisor = UPPER(TRIM(supervisor)), updated_at = NOW()
 WHERE COALESCE(TRIM(supervisor),'') <> '' AND supervisor <> UPPER(TRIM(supervisor));
UPDATE manutencoes SET modelo = UPPER(TRIM(modelo)), updated_at = NOW()
 WHERE COALESCE(TRIM(modelo),'') <> '' AND modelo <> UPPER(TRIM(modelo));
UPDATE manutencoes SET oficina = UPPER(TRIM(oficina)), updated_at = NOW()
 WHERE COALESCE(TRIM(oficina),'') <> '' AND oficina <> UPPER(TRIM(oficina));

-- ⚠️ O QUE ESTE SCRIPT NÃO FAZ, DE PROPÓSITO: juntar oficinas com nomes
--    diferentes. "BRAVUS" e "Bravus/Felipe Fernandes" provavelmente são a mesma,
--    e "MECANITECH" e "MECANITECH OFICINA" também — mas provavelmente não basta:
--    juntar duas oficinas que na verdade são distintas embaralha histórico de
--    gasto e de garantia, e ninguém percebe depois. Isso fica para a Luciana
--    decidir caso a caso.

-- ── Conferência ─────────────────────────────────────────────────────────────
-- SELECT localidade, COUNT(*) FROM manutencoes GROUP BY localidade ORDER BY 1;
-- SELECT oficina,    COUNT(*) FROM manutencoes GROUP BY oficina    ORDER BY 1;
