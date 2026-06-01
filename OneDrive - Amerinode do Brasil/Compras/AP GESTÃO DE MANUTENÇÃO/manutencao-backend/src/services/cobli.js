// Cliente HTTP para a API da Cobli (base /public/v1).
// Autenticação: header 'cobli-api-key: <token>'. Token vem do Railway.

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

// GET /public/v1/vehicles — paginado via pagination.next
function getVehiclesPage({ page = 1, limit = 200 } = {}) {
  return call('GET', '/public/v1/vehicles', { query: { page, limit } })
}

// GET /public/v1/groups — lista grupos com vehicle_ids
function getGroups() {
  return call('GET', '/public/v1/groups')
}

// POST /public/v1/vehicles/report/distance-driven
function getDistanceDriven({ start_date, end_date, vehicle_ids, page = 1, limit = 2000 }) {
  return call('POST', '/public/v1/vehicles/report/distance-driven', {
    body: { start_date, end_date, vehicle_ids, page, limit, timezone: 'America/Sao_Paulo' },
  })
}

// GET /public/v1/fuel/transactions?period=YYYY-MM&limit=200&page=N
function getFuelTransactions({ period, page = 1, limit = 200 }) {
  return call('GET', '/public/v1/fuel/transactions', { query: { period, page, limit } })
}

module.exports = { getVehiclesPage, getGroups, getDistanceDriven, getFuelTransactions }
