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

-- Transações de combustível (uma linha por transação)
CREATE TABLE IF NOT EXISTS cobli_fuel (
  transaction_id  TEXT PRIMARY KEY,
  cobli_id        TEXT,
  data            DATE,
  litros          NUMERIC(10,3),
  valor_brl       NUMERIC(12,2),
  atualizado_em   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cobli_fuel_vehicle_data ON cobli_fuel(cobli_id, data);

-- Override administrativo: grupo Cobli → região "amigável"
-- Quando não houver linha aqui, a região efetiva é o próprio nome do grupo.
CREATE TABLE IF NOT EXISTS cobli_regiao_override (
  grupo          TEXT PRIMARY KEY,
  regiao         TEXT NOT NULL,
  atualizado_em  TIMESTAMPTZ DEFAULT NOW()
);
