// Cliente HTTP para a API da Cobli.
// Autenticação: header 'cobli-api-key: <token>'  (NÃO usa Bearer).
// Token vem do Railway via process.env.COBLI_API_TOKEN — nunca commite.

const COBLI_BASE = 'https://api.cobli.co'

function getToken() {
  const t = process.env.COBLI_API_TOKEN
  if (!t) throw new Error('COBLI_API_TOKEN não configurado (defina no Railway)')
  return t
}

async function call(method, path, { body, query } = {}) {
  const url = new URL(COBLI_BASE + path)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v)
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      'cobli-api-key': getToken(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) {
    const err = new Error(`Cobli ${method} ${path} → ${res.status}: ${String(text).slice(0, 300)}`)
    err.status = res.status
    throw err
  }
  return data
}

// Associações de cartões de combustível — usamos para descobrir
// quais veículos existem e a qual grupo pertencem.
function getAssociations() {
  return call('GET', '/herbie-1.1/fuel/card/associations', { query: { fuelCardStatus: 'active' } })
}

// Distância percorrida — POST com body, paginado (limit max 2000).
function getDistanceDriven({ start_date, end_date, vehicle_ids, page = 1, limit = 2000 }) {
  return call('POST', '/public/v1/vehicles/report/distance-driven', {
    body: { start_date, end_date, vehicle_ids, page, limit, timezone: 'America/Sao_Paulo' },
  })
}

// Transações de combustível no período (paginado).
function getFuelTransactions({ start_date, end_date, page = 1, limit = 1000 } = {}) {
  return call('GET', '/herbie-1.1/fuel/transactions', { query: { start_date, end_date, page, limit } })
}

module.exports = { getAssociations, getDistanceDriven, getFuelTransactions }
