-- ============================================================
--  MÓDULO Distância & Combustível (Cobli) — schema
--  Execute no Supabase: SQL Editor → New query → cole tudo → Run
--  Roda independente do schema principal. Pode rodar várias vezes
--  com segurança (todos os comandos são idempotentes).
-- ============================================================

-- Cache local de veículos vindos da Cobli
CREATE TABLE IF NOT EXISTS cobli_vehicles (
  cobli_id       TEXT PRIMARY KEY,
  placa          TEXT,
  modelo         TEXT,
  grupo          TEXT,             -- nome do grupo / frota na Cobli
  atualizado_em  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cobli_vehicles_grupo ON cobli_vehicles(grupo);

-- Distância mensal por veículo (uma linha por veículo/mês)
CREATE TABLE IF NOT EXISTS cobli_distance (
  cobli_id       TEXT NOT NULL,
  ano_mes        CHAR(7) NOT NULL,   -- formato 'YYYY-MM' (ex: '2026-03')
  km             NUMERIC(12,2) DEFAULT 0,
  atualizado_em  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cobli_id, ano_mes)
);
CREATE INDEX IF NOT EXISTS idx_cobli_distance_mes ON cobli_distance(ano_mes);

-- Transações de combustível (uma linha por transação) — LEGADO
-- Mantido por compatibilidade. O sync atual usa cobli_fuel_mensal (abaixo).
CREATE TABLE IF NOT EXISTS cobli_fuel (
  transaction_id  TEXT PRIMARY KEY,
  cobli_id        TEXT,
  data            DATE,
  litros          NUMERIC(10,3),
  valor_brl       NUMERIC(12,2),
  atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cobli_fuel_vehicle_data ON cobli_fuel(cobli_id, data);

-- Combustível agregado mensal por veículo — vem do relatório oficial da Cobli
-- (endpoint /herbie-1.1/fuel/transactions/report). Bate com o dashboard deles.
CREATE TABLE IF NOT EXISTS cobli_fuel_mensal (
  cobli_id       TEXT NOT NULL,
  ano_mes        CHAR(7) NOT NULL,           -- 'YYYY-MM'
  placa          TEXT,
  gasto_brl      NUMERIC(12,2) DEFAULT 0,    -- "Gasto total no período (R$)"
  litros         NUMERIC(12,3) DEFAULT 0,    -- "Quantidade consumida (L)"
  km_cobli       NUMERIC(12,2) DEFAULT 0,    -- "Quilômetros rodados - Cobli (km)"
  custo_km       NUMERIC(10,4) DEFAULT 0,    -- "Custo por km rodado - Cobli (R$/km)"
  custo_litro    NUMERIC(10,4) DEFAULT 0,    -- "Custo por litro (R$/L)"
  consumo_km_l   NUMERIC(10,4) DEFAULT 0,    -- "Consumo calculado - Cobli (km/L)"
  combustivel    TEXT,                       -- ETANOL, GASOLINA, DIESEL etc
  atualizado_em  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cobli_id, ano_mes)
);
CREATE INDEX IF NOT EXISTS idx_cobli_fuel_mensal_mes ON cobli_fuel_mensal(ano_mes);

-- Override administrativo: grupo Cobli → região "amigável"
-- Quando não houver linha aqui, a região efetiva é o próprio nome do grupo.
CREATE TABLE IF NOT EXISTS cobli_regiao_override (
  grupo          TEXT PRIMARY KEY,
  regiao         TEXT NOT NULL,
  atualizado_em  TIMESTAMPTZ DEFAULT NOW()
);
