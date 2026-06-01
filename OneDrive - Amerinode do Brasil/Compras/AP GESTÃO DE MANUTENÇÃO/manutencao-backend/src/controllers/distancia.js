// Controllers do módulo Distância & Combustível.
// Lê do Supabase (cache local) para responder rápido aos KPIs/Top10/Modelo.
// O sync (POST /api/distancia/sync) é o único caminho que chama a Cobli.

const supabase = require('../supabase')
const cobli    = require('../services/cobli')

// ── helpers ──────────────────────────────────────────────────────────────
function periodToRange(periodo) {
  const now = new Date()
  const end = now.toISOString().slice(0, 10)
  let start
  switch (periodo) {
    case 'tri': start = new Date(now.getFullYear(), now.getMonth() - 2, 1); break
    case 'sem': start = new Date(now.getFullYear(), now.getMonth() - 5, 1); break
    case 'ano': start = new Date(now.getFullYear(), 0, 1); break
    case 'mes':
    default:    start = new Date(now.getFullYear(), now.getMonth(), 1)
  }
  return { start_date: start.toISOString().slice(0, 10), end_date: end }
}

// pega o primeiro campo presente — a Cobli pode entregar nomes diferentes
function pick(obj, keys, fallback = null) {
  if (!obj) return fallback
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return fallback
}

function asArray(resp, extraKeys = []) {
  if (Array.isArray(resp)) return resp
  if (!resp || typeof resp !== 'object') return []
  for (const k of ['data', 'items', 'results', 'transactions', 'associations', ...extraKeys]) {
    if (Array.isArray(resp[k])) return resp[k]
  }
  return []
}

function normalizeVehicle(v) {
  return {
    cobli_id: String(pick(v, ['id', 'vehicle_id', 'vehicleId']) || ''),
    placa:    pick(v, ['plate', 'placa', 'license_plate']),
    modelo:   pick(v, ['model', 'modelo']),
    grupo:    pick(v, ['group', 'group_name', 'grupo', 'fleet', 'fleet_name']),
  }
}
function normalizeDistance(r) {
  return {
    cobli_id: String(pick(r, ['vehicle_id', 'id', 'vehicleId']) || ''),
    km:       Number(pick(r, ['distance_km', 'distance', 'km', 'total_km'], 0)) || 0,
  }
}
function normalizeFuel(t) {
  return {
    transaction_id: String(pick(t, ['id', 'transaction_id', 'transactionId']) || ''),
    cobli_id:       String(pick(t, ['vehicle_id', 'vehicleId', 'car_id'], '') || ''),
    data:           String(pick(t, ['date', 'datetime', 'transaction_date', 'occurred_at'], '') || '').slice(0, 10) || null,
    litros:         Number(pick(t, ['liters', 'litros', 'volume'], 0)) || 0,
    valor_brl:      Number(pick(t, ['value', 'amount', 'price', 'total', 'value_brl'], 0)) || 0,
  }
}

async function loadVehiclesEnriched() {
  const [{ data: vs }, { data: ov }] = await Promise.all([
    supabase.from('cobli_vehicles').select('*'),
    supabase.from('cobli_regiao_override').select('*'),
  ])
  const map = new Map((ov || []).map(o => [o.grupo, o.regiao]))
  return (vs || []).map(v => ({
    ...v,
    regiao_efetiva: map.get(v.grupo) || v.grupo || '—',
    regiao_personalizada: map.has(v.grupo),
  }))
}

function applyFilters(vehicles, { regiao, modelo }) {
  return vehicles.filter(v => {
    if (regiao && v.regiao_efetiva !== regiao) return false
    if (modelo && v.modelo !== modelo) return false
    return true
  })
}

function safeIn(ids) { return ids.length ? ids : ['__none__'] }

// ── handlers ─────────────────────────────────────────────────────────────
async function resumo(req, res, next) {
  try {
    const { periodo = 'mes', regiao, modelo } = req.query
    const { start_date, end_date } = periodToRange(periodo)
    const vehicles = applyFilters(await loadVehiclesEnriched(), { regiao, modelo })
    const ids = vehicles.map(v => v.cobli_id)

    const [{ data: dist }, { data: fuel }] = await Promise.all([
      supabase.from('cobli_distance').select('cobli_id, ano_mes, km')
        .gte('ano_mes', start_date.slice(0, 7)).lte('ano_mes', end_date.slice(0, 7))
        .in('cobli_id', safeIn(ids)),
      supabase.from('cobli_fuel').select('cobli_id, data, valor_brl, litros')
        .gte('data', start_date).lte('data', end_date)
        .in('cobli_id', safeIn(ids)),
    ])

    const km    = (dist || []).reduce((s, r) => s + Number(r.km || 0), 0)
    const gasto = (fuel || []).reduce((s, r) => s + Number(r.valor_brl || 0), 0)
    const veiculosAtivos = new Set((dist || []).filter(r => Number(r.km || 0) > 0).map(r => r.cobli_id)).size

    const buckets = new Map()
    for (const r of (dist || [])) {
      const b = buckets.get(r.ano_mes) || { mes: r.ano_mes, km: 0, rs: 0 }
      b.km += Number(r.km || 0); buckets.set(r.ano_mes, b)
    }
    for (const r of (fuel || [])) {
      const m = String(r.data || '').slice(0, 7); if (!m) continue
      const b = buckets.get(m) || { mes: m, km: 0, rs: 0 }
      b.rs += Number(r.valor_brl || 0); buckets.set(m, b)
    }
    const serie = [...buckets.values()].sort((a, b) => a.mes.localeCompare(b.mes))

    res.json({
      kpis: { km, gasto_rs: gasto, custo_km: km > 0 ? gasto / km : 0, veiculos: veiculosAtivos },
      serie,
    })
  } catch (e) { next(e) }
}

async function top(req, res, next) {
  try {
    const { periodo = 'mes', regiao, modelo } = req.query
    const { start_date, end_date } = periodToRange(periodo)
    const vehicles = applyFilters(await loadVehiclesEnriched(), { regiao, modelo })
    const vMap = new Map(vehicles.map(v => [v.cobli_id, v]))
    const ids = vehicles.map(v => v.cobli_id)

    const [{ data: dist }, { data: fuel }] = await Promise.all([
      supabase.from('cobli_distance').select('cobli_id, km')
        .gte('ano_mes', start_date.slice(0, 7)).lte('ano_mes', end_date.slice(0, 7))
        .in('cobli_id', safeIn(ids)),
      supabase.from('cobli_fuel').select('cobli_id, valor_brl')
        .gte('data', start_date).lte('data', end_date)
        .in('cobli_id', safeIn(ids)),
    ])

    const agg = new Map()
    for (const r of (dist || [])) {
      const a = agg.get(r.cobli_id) || { km: 0, rs: 0 }; a.km += Number(r.km || 0); agg.set(r.cobli_id, a)
    }
    for (const r of (fuel || [])) {
      const a = agg.get(r.cobli_id) || { km: 0, rs: 0 }; a.rs += Number(r.valor_brl || 0); agg.set(r.cobli_id, a)
    }

    const arr = [...agg.entries()]
      .map(([id, a]) => {
        const v = vMap.get(id) || {}
        return { placa: v.placa, modelo: v.modelo, regiao: v.regiao_efetiva, km: a.km, rs: a.rs }
      })
      .sort((a, b) => b.km - a.km)
      .slice(0, 10)

    res.json(arr)
  } catch (e) { next(e) }
}

async function modelo(req, res, next) {
  try {
    const { periodo = 'mes', regiao, modelo, limiar = 20 } = req.query
    const { start_date, end_date } = periodToRange(periodo)
    const vehicles = applyFilters(await loadVehiclesEnriched(), { regiao, modelo })
    const vMap = new Map(vehicles.map(v => [v.cobli_id, v]))
    const ids = vehicles.map(v => v.cobli_id)

    const [{ data: dist }, { data: fuel }] = await Promise.all([
      supabase.from('cobli_distance').select('cobli_id, km')
        .gte('ano_mes', start_date.slice(0, 7)).lte('ano_mes', end_date.slice(0, 7))
        .in('cobli_id', safeIn(ids)),
      supabase.from('cobli_fuel').select('cobli_id, valor_brl')
        .gte('data', start_date).lte('data', end_date)
        .in('cobli_id', safeIn(ids)),
    ])

    const perVehicle = new Map()
    for (const r of (dist || [])) {
      const a = perVehicle.get(r.cobli_id) || { km: 0, rs: 0 }; a.km += Number(r.km || 0); perVehicle.set(r.cobli_id, a)
    }
    for (const r of (fuel || [])) {
      const a = perVehicle.get(r.cobli_id) || { km: 0, rs: 0 }; a.rs += Number(r.valor_brl || 0); perVehicle.set(r.cobli_id, a)
    }

    const porModelo = new Map()
    for (const [id, a] of perVehicle) {
      const v = vMap.get(id); if (!v) continue
      const m = v.modelo || '—'
      const slot = porModelo.get(m) || { km: 0, rs: 0 }
      slot.km += a.km; slot.rs += a.rs
      porModelo.set(m, slot)
    }
    const mediaModelo = [...porModelo.entries()]
      .map(([modelo, a]) => ({ modelo, custo_km: a.km > 0 ? a.rs / a.km : 0 }))
      .filter(m => m.custo_km > 0)
      .sort((a, b) => b.custo_km - a.custo_km)

    const baseline = new Map(mediaModelo.map(m => [m.modelo, m.custo_km]))
    const alertas = []
    for (const [id, a] of perVehicle) {
      const v = vMap.get(id); if (!v || a.km <= 0) continue
      const custoKm = a.rs / a.km
      const base = baseline.get(v.modelo)
      if (!base || base <= 0) continue
      const desvio = ((custoKm - base) / base) * 100
      if (desvio >= Number(limiar)) {
        alertas.push({
          placa: v.placa, modelo: v.modelo, regiao: v.regiao_efetiva,
          custo_km: custoKm, desvio: Math.round(desvio),
          acao: desvio >= 40 ? 'troca' : 'manutencao',
        })
      }
    }
    alertas.sort((a, b) => b.desvio - a.desvio)
    res.json({ mediaModelo, alertas })
  } catch (e) { next(e) }
}

async function regioes(req, res, next) {
  try {
    const [{ data: vs }, { data: ov }] = await Promise.all([
      supabase.from('cobli_vehicles').select('grupo'),
      supabase.from('cobli_regiao_override').select('*'),
    ])
    const map = new Map((ov || []).map(o => [o.grupo, o.regiao]))
    const grupos = [...new Set((vs || []).map(v => v.grupo).filter(Boolean))].sort()
    res.json(grupos.map(g => ({
      grupo: g,
      regiao_efetiva: map.get(g) || g,
      personalizado: map.has(g),
    })))
  } catch (e) { next(e) }
}

async function salvarRegiao(req, res, next) {
  try {
    const { grupo, regiao } = req.body || {}
    if (!grupo) return res.status(400).json({ error: 'grupo é obrigatório' })
    const r = (regiao || '').trim()
    if (r && r !== grupo) {
      await supabase.from('cobli_regiao_override')
        .upsert({ grupo, regiao: r, atualizado_em: new Date().toISOString() }, { onConflict: 'grupo' })
    } else {
      await supabase.from('cobli_regiao_override').delete().eq('grupo', grupo)
    }
    res.json({ ok: true })
  } catch (e) { next(e) }
}

// Sync manual: chama a Cobli e popula o Supabase.
// É o único caminho que efetivamente conversa com a Cobli.
async function sync(req, res) {
  const counts = { veiculos: 0, distancia: 0, combustivel: 0 }
  const erros = []
  try {
    const { periodo = 'mes' } = req.body || {}
    const { start_date, end_date } = periodToRange(periodo)
    const ano_mes = end_date.slice(0, 7)

    // (1) Veículos via associações de cartões
    const vehicleMap = new Map()
    try {
      const assoc = await cobli.getAssociations()
      const items = asArray(assoc, ['associations'])
      for (const a of items) {
        const v = a.vehicle || a.veiculo || a
        const norm = normalizeVehicle(v)
        if (!norm.grupo) norm.grupo = pick(a, ['group', 'group_name', 'grupo', 'fleet', 'fleet_name'])
        if (norm.cobli_id) vehicleMap.set(norm.cobli_id, norm)
      }
      const vehicles = [...vehicleMap.values()]
      if (vehicles.length) {
        await supabase.from('cobli_vehicles').upsert(
          vehicles.map(v => ({ ...v, atualizado_em: new Date().toISOString() })),
          { onConflict: 'cobli_id' },
        )
      }
      counts.veiculos = vehicles.length
    } catch (e) {
      console.error('[cobli sync] associações:', e.message)
      erros.push({ etapa: 'associacoes', detalhe: e.message })
    }

    // (2) Distância por veículo no período
    const allIds = [...vehicleMap.keys()]
    if (allIds.length) {
      try {
        for (let i = 0; i < allIds.length; i += 2000) {
          const chunk = allIds.slice(i, i + 2000)
          let page = 1
          while (page <= 50) {
            const resp = await cobli.getDistanceDriven({ start_date, end_date, vehicle_ids: chunk, page })
            const items = asArray(resp)
            if (!items.length) break
            const rows = items.map(it => {
              const n = normalizeDistance(it)
              return n.cobli_id ? { cobli_id: n.cobli_id, ano_mes, km: n.km, atualizado_em: new Date().toISOString() } : null
            }).filter(Boolean)
            if (rows.length) {
              await supabase.from('cobli_distance').upsert(rows, { onConflict: 'cobli_id,ano_mes' })
              counts.distancia += rows.length
            }
            if (items.length < 2000) break
            page++
          }
        }
      } catch (e) {
        console.error('[cobli sync] distância:', e.message)
        erros.push({ etapa: 'distancia', detalhe: e.message })
      }
    }

    // (3) Transações de combustível no período
    try {
      let page = 1
      while (page <= 50) {
        const resp = await cobli.getFuelTransactions({ start_date, end_date, page })
        const items = asArray(resp, ['transactions'])
        if (!items.length) break
        const rows = items.map(normalizeFuel).filter(r => r.transaction_id && r.data)
        if (rows.length) {
          await supabase.from('cobli_fuel').upsert(
            rows.map(r => ({ ...r, atualizado_em: new Date().toISOString() })),
            { onConflict: 'transaction_id' },
          )
          counts.combustivel += rows.length
        }
        if (items.length < 1000) break
        page++
      }
    } catch (e) {
      console.error('[cobli sync] combustível:', e.message)
      erros.push({ etapa: 'combustivel', detalhe: e.message })
    }

    res.json({
      ok: erros.length === 0,
      periodo: { start_date, end_date },
      counts,
      erros,
      atualizado_em: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[cobli sync] erro geral:', e)
    res.status(500).json({ ok: false, error: e.message, counts, erros })
  }
}

// Rota de sondagem temporária — testa várias URLs/params da Cobli e
// reporta status + amostra do corpo. Remover quando módulo estiver validado.
async function probe(req, res) {
  const COBLI_BASE = 'https://api.cobli.co'
  const token = process.env.COBLI_API_TOKEN
  if (!token) return res.status(500).json({ error: 'COBLI_API_TOKEN ausente' })

  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = today.slice(0, 7) + '-01'
  const monthShort = today.slice(0, 7) // YYYY-MM

  const candidates = [
    // veículos — sample maior pra ver grupo
    { label: 'vehicles:public/v1/vehicles?limit=2', method: 'GET', path: '/public/v1/vehicles?limit=2', sampleLen: 2000 },
    { label: 'vehicles:public/v1/vehicles/groups',  method: 'GET', path: '/public/v1/vehicles/groups' },
    { label: 'groups:public/v1/groups',             method: 'GET', path: '/public/v1/groups' },
    { label: 'fleets:public/v1/fleets',             method: 'GET', path: '/public/v1/fleets' },
    // combustível — muitas variantes
    { label: 'fuel:tx GET (sem param)',                method: 'GET', path: '/herbie-1.1/fuel/transactions' },
    { label: 'fuel:tx GET ?period=YYYYMM',             method: 'GET', path: `/herbie-1.1/fuel/transactions?period=${today.slice(0,4)}${today.slice(5,7)}` },
    { label: 'fuel:tx GET ?period=YYYY/MM',            method: 'GET', path: `/herbie-1.1/fuel/transactions?period=${today.slice(0,4)}%2F${today.slice(5,7)}` },
    { label: 'fuel:tx GET ?period=MM-YYYY',            method: 'GET', path: `/herbie-1.1/fuel/transactions?period=${today.slice(5,7)}-${today.slice(0,4)}` },
    { label: 'fuel:tx POST body period=YYYY-MM',       method: 'POST', path: '/herbie-1.1/fuel/transactions', body: { period: monthShort } },
    { label: 'fuel:tx GET ?Period=YYYY-MM (case)',     method: 'GET', path: `/herbie-1.1/fuel/transactions?Period=${monthShort}` },
    { label: 'fuel:tx GET /:period path YYYY-MM',      method: 'GET', path: `/herbie-1.1/fuel/transactions/${monthShort}` },
    { label: 'fuel:tx GET ?period[]=YYYY-MM',          method: 'GET', path: `/herbie-1.1/fuel/transactions?period%5B%5D=${monthShort}` },
    { label: 'fuel:tx public/v1?period=YYYY-MM',       method: 'GET', path: `/public/v1/fuel/transactions?period=${monthShort}` },
    // listagem alternativa de combustível?
    { label: 'fuel:report public/v1',                  method: 'GET', path: '/public/v1/fuel/report' },
    { label: 'fuel:report public/v1/transactions',     method: 'GET', path: '/public/v1/fuel/transactions' },
  ]

  const results = []
  for (const c of candidates) {
    try {
      const r = await fetch(COBLI_BASE + c.path, {
        method: c.method,
        headers: { 'cobli-api-key': token, 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: c.body ? JSON.stringify(c.body) : undefined,
      })
      const txt = await r.text()
      results.push({
        label: c.label, status: r.status, ok: r.ok,
        sample: txt.slice(0, c.sampleLen || 300),
      })
    } catch (e) {
      results.push({ label: c.label, status: 'fetch-error', error: e.message })
    }
  }
  res.json({ now: new Date().toISOString(), results })
}

module.exports = { resumo, top, modelo, regioes, salvarRegiao, sync, probe }
