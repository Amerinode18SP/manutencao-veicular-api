-- ─────────────────────────────────────────────────────────────────────────────
-- Padronização de LOCALIDADE e MODELO no cadastro de veículos.
-- Rodar manualmente no Supabase → SQL Editor (idempotente).
-- Decisões da Luciana em 28/09/2026:
--   • modelo: nome CURTO em maiúsculas (KWID, FIORINO, HB20);
--   • localidade "Alugado": NÃO mexer — ela corrige à mão, sabendo a cidade.
--
-- ⚠️ O script é uma LISTA EXPLÍCITA de trocas, e não uma regra automática.
--    Regra do tipo "tudo em maiúscula sem acento" também juntaria valores que
--    não deveriam ser juntados, e ninguém perceberia depois — aqui cada troca
--    está escrita, e o que não está na lista fica intocado.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Antes: guarde o retrato, para poder conferir/voltar ─────────────────────
-- Rode SOZINHO primeiro e salve o resultado:
--   SELECT placa, localidade, modelo FROM veiculos ORDER BY placa;

-- ── 1) LOCALIDADE ───────────────────────────────────────────────────────────
-- Mesma cidade escrita de jeitos diferentes. "JGE" é abreviação de Jaguaré.
UPDATE veiculos SET localidade = 'JAGUARÉ', updated_at = NOW()
 WHERE TRIM(localidade) IN ('JAGUARE', 'JGE', 'Jaguare', 'Jaguaré', 'jge');

UPDATE veiculos SET localidade = 'CAMPINAS', updated_at = NOW()
 WHERE TRIM(localidade) = 'Campinas';

UPDATE veiculos SET localidade = 'RIBEIRÃO PRETO', updated_at = NOW()
 WHERE TRIM(localidade) IN ('RIBEIRAO PRETO', 'Ribeirao Preto', 'Ribeirão Preto');

UPDATE veiculos SET localidade = 'SJ DO RIO PRETO', updated_at = NOW()
 WHERE TRIM(localidade) IN ('SJ RIO PRETO', 'SAO JOSE DO RIO PRETO', 'SÃO JOSÉ DO RIO PRETO');

-- Acento que faltava, para ficar igual a ARAÇATUBA / TAUBATÉ / JAGUARÉ.
UPDATE veiculos SET localidade = 'JUNDIAÍ', updated_at = NOW()
 WHERE TRIM(localidade) = 'JUNDIAI';

-- 'Alugado' fica como está, de propósito (decisão da Luciana): é status, não
-- cidade, e só ela sabe onde cada um desses carros está de fato.

-- ── 2) MODELO — nome curto em maiúsculas ────────────────────────────────────
UPDATE veiculos SET modelo = 'KWID', updated_at = NOW()
 WHERE UPPER(TRIM(modelo)) LIKE '%KWID%';

-- ⚠️ Furgão e Endurance viram os dois FIORINO: a distinção de versão SE PERDE
--    aqui (aceito por ela ao escolher o nome curto). Se um dia precisar separar
--    de novo, a versão ainda está no Cobli (cobli_vehicles.modelo).
UPDATE veiculos SET modelo = 'FIORINO', updated_at = NOW()
 WHERE UPPER(TRIM(modelo)) LIKE '%FIORINO%';

UPDATE veiculos SET modelo = 'HB20', updated_at = NOW()
 WHERE UPPER(TRIM(modelo)) LIKE '%HB20%';

UPDATE veiculos SET modelo = 'LEAF', updated_at = NOW()
 WHERE UPPER(TRIM(modelo)) LIKE '%LEAF%';

UPDATE veiculos SET modelo = 'VOYAGE', updated_at = NOW()
 WHERE UPPER(TRIM(modelo)) LIKE 'VOYAGE%';   -- pega VOYAGEM também

UPDATE veiculos SET modelo = 'SAVEIRO', updated_at = NOW()
 WHERE UPPER(TRIM(modelo)) LIKE '%SAVEIRO%';

UPDATE veiculos SET modelo = 'DOBLO', updated_at = NOW()
 WHERE UPPER(TRIM(modelo)) LIKE '%DOBLO%';

UPDATE veiculos SET modelo = 'MOBI', updated_at = NOW()
 WHERE UPPER(TRIM(modelo)) LIKE '%MOBI%';

UPDATE veiculos SET modelo = 'IVECO', updated_at = NOW()
 WHERE UPPER(TRIM(modelo)) LIKE '%IVECO%';

-- Sobra em maiúscula o que não caiu em nenhuma regra acima (evita 'Doblo' x 'DOBLO'
-- amanhã). Vazio continua vazio — não inventa modelo.
UPDATE veiculos SET modelo = UPPER(TRIM(modelo)), updated_at = NOW()
 WHERE COALESCE(TRIM(modelo), '') <> '' AND modelo <> UPPER(TRIM(modelo));

-- ⚠️ 'NISSAN' sozinho NÃO é tratado: é marca, não modelo, e não dá para saber
--    qual carro é. Fica visível na tela para alguém corrigir à mão.

-- ── Conferência ─────────────────────────────────────────────────────────────
-- SELECT localidade, COUNT(*) FROM veiculos GROUP BY localidade ORDER BY 1;
-- SELECT modelo,     COUNT(*) FROM veiculos GROUP BY modelo     ORDER BY 1;
