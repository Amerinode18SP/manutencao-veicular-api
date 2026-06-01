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

function applyFilters(vehicles, { regiao, modelo, placa }) {
  return vehicles.filter(v => {
    if (regiao && v.regiao_efetiva !== regiao) return false
    if (modelo && v.modelo !== modelo) return false
    if (placa && v.placa !== placa) return false
    return true
  })
}

function safeIn(ids) { return ids.length ? ids : ['__none__'] }

// Resolve a janela de datas a partir de query string flexível.
// Aceita: ?ano=YYYY, ?ano=todos, ?meses=1,2,3 (precisa de ano),
// e cai pra ?periodo=mes|tri|sem|ano se nada vier.
function queryToRange(q = {}) {
  if (q.ano === 'todos') {
    return { start_date: '2020-01-01', end_date: new Date().toISOString().slice(0, 10), months: null }
  }
  if (q.ano) {
    const y = Number(q.ano)
    if (q.meses) {
      const months = String(q.meses).split(',').map(s => Number(s.trim()))
        .filter(n => n >= 1 && n <= 12).sort((a, b) => a - b)
      if (months.length) {
        const mn = months[0], mx = months[months.length - 1]
        const lastDay = new Date(y, mx, 0).getDate()
        const monthList = months.map(m => `${y}-${String(m).padStart(2, '0')}`)
        return {
          start_date: `${y}-${String(mn).padStart(2, '0')}-01`,
          end_date: `${y}-${String(mx).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
          months: monthList,
        }
      }
    }
    return { start_date: `${y}-01-01`, end_date: `${y}-12-31`, months: null }
  }
  return { ...periodToRange(q.periodo || 'mes'), months: null }
}

// Filtra os meses retornados pelo banco caso a query tenha lista explícita.
function inSelectedMonths(ano_mes, monthList) {
  if (!monthList) return true
  return monthList.includes(ano_mes)
}

// ── handlers ─────────────────────────────────────────────────────────────
async function resumo(req, res, next) {
  try {
    const { regiao, modelo, placa } = req.query
    const { start_date, end_date, months } = queryToRange(req.query)
    const vehicles = applyFilters(await loadVehiclesEnriched(), { regiao, modelo, placa })
    const ids = vehicles.map(v => v.cobli_id)

    const [{ data: dist }, { data: fuel }] = await Promise.all([
      supabase.from('cobli_distance').select('cobli_id, ano_mes, km')
        .gte('ano_mes', start_date.slice(0, 7)).lte('ano_mes', end_date.slice(0, 7))
        .in('cobli_id', safeIn(ids)),
      supabase.from('cobli_fuel').select('cobli_id, data, valor_brl, litros')
        .gte('data', start_date).lte('data', end_date)
        .in('cobli_id', safeIn(ids)),
    ])

    const distFiltered = (dist || []).filter(r => inSelectedMonths(r.ano_mes, months))
    const fuelFiltered = (fuel || []).filter(r => inSelectedMonths(String(r.data || '').slice(0, 7), months))

    const km    = distFiltered.reduce((s, r) => s + Number(r.km || 0), 0)
    const gasto = fuelFiltered.reduce((s, r) => s + Number(r.valor_brl || 0), 0)
    const veiculosAtivos = new Set(distFiltered.filter(r => Number(r.km || 0) > 0).map(r => r.cobli_id)).size

    // Granularidade: por ano quando "Todos", por mês caso contrário
    const byYear = req.query.ano === 'todos'
    const bucketKey = (ym) => byYear ? ym.slice(0, 4) : ym
    const buckets = new Map()
    for (const r of distFiltered) {
      const k = bucketKey(r.ano_mes)
      const b = buckets.get(k) || { mes: k, km: 0, rs: 0 }
      b.km += Number(r.km || 0); buckets.set(k, b)
    }
    for (const r of fuelFiltered) {
      const ym = String(r.data || '').slice(0, 7); if (!ym) continue
      const k = bucketKey(ym)
      const b = buckets.get(k) || { mes: k, km: 0, rs: 0 }
      b.rs += Number(r.valor_brl || 0); buckets.set(k, b)
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
    const { regiao, modelo, placa } = req.query
    const { start_date, end_date, months } = queryToRange(req.query)
    const vehicles = applyFilters(await loadVehiclesEnriched(), { regiao, modelo, placa })
    const vMap = new Map(vehicles.map(v => [v.cobli_id, v]))
    const ids = vehicles.map(v => v.cobli_id)

    const [{ data: dist }, { data: fuel }] = await Promise.all([
      supabase.from('cobli_distance').select('cobli_id, ano_mes, km')
        .gte('ano_mes', start_date.slice(0, 7)).lte('ano_mes', end_date.slice(0, 7))
        .in('cobli_id', safeIn(ids)),
      supabase.from('cobli_fuel').select('cobli_id, data, valor_brl')
        .gte('data', start_date).lte('data', end_date)
        .in('cobli_id', safeIn(ids)),
    ])

    const agg = new Map()
    for (const r of (dist || [])) {
      if (!inSelectedMonths(r.ano_mes, months)) continue
      const a = agg.get(r.cobli_id) || { km: 0, rs: 0 }; a.km += Number(r.km || 0); agg.set(r.cobli_id, a)
    }
    for (const r of (fuel || [])) {
      if (!inSelectedMonths(String(r.data || '').slice(0, 7), months)) continue
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
    const { regiao, modelo, placa, limiar = 20 } = req.query
    const { start_date, end_date, months } = queryToRange(req.query)
    const vehicles = applyFilters(await loadVehiclesEnriched(), { regiao, modelo, placa })
    const vMap = new Map(vehicles.map(v => [v.cobli_id, v]))
    const ids = vehicles.map(v => v.cobli_id)

    const [{ data: dist }, { data: fuel }] = await Promise.all([
      supabase.from('cobli_distance').select('cobli_id, ano_mes, km')
        .gte('ano_mes', start_date.slice(0, 7)).lte('ano_mes', end_date.slice(0, 7))
        .in('cobli_id', safeIn(ids)),
      supabase.from('cobli_fuel').select('cobli_id, data, valor_brl')
        .gte('data', start_date).lte('data', end_date)
        .in('cobli_id', safeIn(ids)),
    ])

    const perVehicle = new Map()
    for (const r of (dist || [])) {
      if (!inSelectedMonths(r.ano_mes, months)) continue
      const a = perVehicle.get(r.cobli_id) || { km: 0, rs: 0 }; a.km += Number(r.km || 0); perVehicle.set(r.cobli_id, a)
    }
    for (const r of (fuel || [])) {
      if (!inSelectedMonths(String(r.data || '').slice(0, 7), months)) continue
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

// Lista de placas + modelos disponíveis para popular os dropdowns do frontend.
async function placas(req, res, next) {
  try {
    const { regiao, modelo } = req.query
    const enriched = applyFilters(await loadVehiclesEnriched(), { regiao, modelo })
    const lista = [...new Set(enriched.map(v => v.placa).filter(Boolean))].sort()
    res.json(lista)
  } catch (e) { next(e) }
}

async function modelos(req, res, next) {
  try {
    const { regiao } = req.query
    const enriched = applyFilters(await loadVehiclesEnriched(), { regiao })
    const lista = [...new Set(enriched.map(v => v.modelo).filter(Boolean))].sort()
    res.json(lista)
  } catch (e) { next(e) }
}

// Recomendações de rodízio: identifica pares (alto km, baixo km) no mesmo grupo
// para sugerir trocas e balancear desgaste — evita descarte prematuro.
async function rodizio(req, res, next) {
  try {
    const { regiao, modelo } = req.query
    const { start_date, end_date, months } = queryToRange(req.query)
    const vehicles = applyFilters(await loadVehiclesEnriched(), { regiao, modelo })
    const vMap = new Map(vehicles.map(v => [v.cobli_id, v]))
    const ids = vehicles.map(v => v.cobli_id)

    const { data: dist } = await supabase.from('cobli_distance').select('cobli_id, ano_mes, km')
      .gte('ano_mes', start_date.slice(0, 7)).lte('ano_mes', end_date.slice(0, 7))
      .in('cobli_id', safeIn(ids))

    // km total por veículo no período
    const kmPorVeic = new Map()
    for (const r of (dist || [])) {
      if (!inSelectedMonths(r.ano_mes, months)) continue
      kmPorVeic.set(r.cobli_id, (kmPorVeic.get(r.cobli_id) || 0) + Number(r.km || 0))
    }

    // agrupar por região efetiva
    const porGrupo = new Map()
    for (const v of vehicles) {
      const g = v.regiao_efetiva || '—'
      if (!porGrupo.has(g)) porGrupo.set(g, [])
      porGrupo.get(g).push({ ...v, km: kmPorVeic.get(v.cobli_id) || 0 })
    }

    const sugestoes = []
    for (const [grupo, lista] of porGrupo) {
      if (lista.length < 2) continue
      const total = lista.reduce((s, v) => s + v.km, 0)
      const media = total / lista.length
      if (media <= 0) continue

      const altos = lista.filter(v => v.km > media * 1.5).sort((a, b) => b.km - a.km)
      const baixos = lista.filter(v => v.km < media * 0.5 && v.km >= 0).sort((a, b) => a.km - b.km)

      const pares = Math.min(altos.length, baixos.length)
      for (let i = 0; i < pares; i++) {
        const alto = altos[i], baixo = baixos[i]
        sugestoes.push({
          grupo,
          alto:  { placa: alto.placa,  modelo: alto.modelo,  km: alto.km,  desvio: Math.round(((alto.km - media)  / media) * 100) },
          baixo: { placa: baixo.placa, modelo: baixo.modelo, km: baixo.km, desvio: Math.round(((baixo.km - media) / media) * 100) },
          media_grupo: media,
        })
      }
    }
    sugestoes.sort((a, b) => b.alto.desvio - a.alto.desvio)
    res.json(sugestoes)
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

// Gera a lista de YYYY-MM entre start_date e end_date (inclusive).
function monthsInRange(start_date, end_date) {
  const months = []
  let [y, m] = start_date.slice(0, 7).split('-').map(Number)
  const [ey, em] = end_date.slice(0, 7).split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return months
}

// Para um YYYY-MM, retorna { start, end } do mês inteiro (último dia correto).
function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate() // dia 0 do mês seguinte = último do atual
  return { start: `${ym}-01`, end: `${ym}-${String(last).padStart(2, '0')}` }
}

// Sync manual: chama a Cobli e popula o Supabase.
// Body aceita { periodo: 'mes|tri|sem|ano' } ou { ano: 2025 } (ano inteiro).
async function sync(req, res) {
  const counts = { veiculos: 0, distancia: 0, combustivel: 0 }
  const erros = []
  try {
    const body = req.body || {}
    let start_date, end_date
    if (body.ano) {
      const y = Number(body.ano)
      const today = new Date().toISOString().slice(0, 10)
      start_date = `${y}-01-01`
      // não pedir futuro — se ano corrente, encerra hoje
      end_date = `${y}-12-31` > today ? today : `${y}-12-31`
    } else {
      const r = periodToRange(body.periodo || 'mes')
      start_date = r.start_date; end_date = r.end_date
    }
    const months = monthsInRange(start_date, end_date)

    // (1) Veículos via /public/v1/vehicles (paginado)
    const allVehicles = []
    try {
      let page = 1
      while (page <= 50) {
        const resp = await cobli.getVehiclesPage({ page, limit: 200 })
        const items = (resp && resp.data) || []
        if (!items.length) break
        for (const v of items) {
          allVehicles.push({
            cobli_id: String(v.id),
            placa:    v.license_plate || null,
            modelo:   [v.brand, v.model].filter(Boolean).join(' ') || v.model || null,
            grupo:    (v.groups && v.groups[0] && v.groups[0].name) || null,
          })
        }
        if (!resp.pagination || !resp.pagination.next) break
        page++
      }
      if (allVehicles.length) {
        // upsert em lotes pra evitar payload muito grande
        for (let i = 0; i < allVehicles.length; i += 500) {
          const batch = allVehicles.slice(i, i + 500)
          await supabase.from('cobli_vehicles').upsert(
            batch.map(v => ({ ...v, atualizado_em: new Date().toISOString() })),
            { onConflict: 'cobli_id' },
          )
        }
      }
      counts.veiculos = allVehicles.length
    } catch (e) {
      console.error('[cobli sync] veiculos:', e.message)
      erros.push({ etapa: 'veiculos', detalhe: e.message })
    }

    const ids = allVehicles.map(v => v.cobli_id)

    // (2) Distância — por mês (pra ter granularidade mensal no gráfico)
    if (ids.length) {
      try {
        for (const ym of months) {
          const { start, end } = monthBounds(ym)
          // ajustar fim se for o mês corrente — não pedir futuro
          const realEnd = end > end_date ? end_date : end
          for (let i = 0; i < ids.length; i += 2000) {
            const chunk = ids.slice(i, i + 2000)
            let page = 1
            while (page <= 50) {
              const resp = await cobli.getDistanceDriven({ start_date: start, end_date: realEnd, vehicle_ids: chunk, page })
              const items = (resp && resp.data) || []
              if (!items.length) break
              const rows = items.map(it => ({
                cobli_id: String(it.vehicle_id),
                ano_mes: ym,
                km: Number(it.distance_driven_in_km || 0),
                atualizado_em: new Date().toISOString(),
              })).filter(r => r.cobli_id && r.cobli_id !== 'undefined')
              if (rows.length) {
                await supabase.from('cobli_distance').upsert(rows, { onConflict: 'cobli_id,ano_mes' })
                counts.distancia += rows.length
              }
              if (!resp.pagination || !resp.pagination.next) break
              page++
            }
          }
        }
      } catch (e) {
        console.error('[cobli sync] distancia:', e.message)
        erros.push({ etapa: 'distancia', detalhe: e.message })
      }
    }

    // (3) Combustível — por mês, com period=YYYY-MM e limit=200
    try {
      for (const ym of months) {
        let page = 1
        while (page <= 100) {
          const resp = await cobli.getFuelTransactions({ period: ym, page, limit: 200 })
          const items = (resp && resp.data) || []
          if (!items.length) break
          const rows = items.map(t => ({
            transaction_id: String(t.id),
            cobli_id:       String((t.vehicle && t.vehicle.id) || ''),
            data:           String(t.transaction_time || '').slice(0, 10) || null,
            litros:         Number(t.quantity_in_liters || 0),
            valor_brl:      Number(t.total_cost || 0),
            atualizado_em:  new Date().toISOString(),
          })).filter(r => r.transaction_id && r.transaction_id !== 'undefined' && r.data)
          if (rows.length) {
            for (let i = 0; i < rows.length; i += 500) {
              const batch = rows.slice(i, i + 500)
              await supabase.from('cobli_fuel').upsert(batch, { onConflict: 'transaction_id' })
            }
            counts.combustivel += rows.length
          }
          if (!resp.pagination || !resp.pagination.next) break
          page++
        }
      }
    } catch (e) {
      console.error('[cobli sync] combustivel:', e.message)
      erros.push({ etapa: 'combustivel', detalhe: e.message })
    }

    res.json({
      ok: erros.length === 0,
      periodo: { start_date, end_date, months },
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
    // FINAL: amostra real de combustível mês passado, size<=200
    { label: 'fuel:period=2026-05 limit=10',   method: 'GET', path: '/public/v1/fuel/transactions?period=2026-05&limit=10', sampleLen: 3000 },
    { label: 'fuel:period=2026-05 page_size=10', method: 'GET', path: '/public/v1/fuel/transactions?period=2026-05&page_size=10', sampleLen: 3000 },
    { label: 'fuel:period=2026-05 per_page=10',  method: 'GET', path: '/public/v1/fuel/transactions?period=2026-05&per_page=10', sampleLen: 3000 },
    { label: 'fuel:period=2026-05 pageSize=10',  method: 'GET', path: '/public/v1/fuel/transactions?period=2026-05&pageSize=10', sampleLen: 3000 },
    { label: 'fuel:period=2026-05 size=200',     method: 'GET', path: '/public/v1/fuel/transactions?period=2026-05&size=200', sampleLen: 3000 },
    { label: 'fuel:period=2026-05 only',         method: 'GET', path: '/public/v1/fuel/transactions?period=2026-05', sampleLen: 3000 },
    { label: 'distance:public/v1 sample',              method: 'POST', path: '/public/v1/vehicles/report/distance-driven', body: { start_date: '2026-05-01', end_date: '2026-05-31', vehicle_ids: ['04d94ae4-8eaa-4497-bc63-17d664db8091'] }, sampleLen: 2000 },
    // NOVO: endpoint de RELATÓRIO de transações (provavelmente o que o dashboard usa)
    { label: 'fuel:report May2026 CSV',  method: 'GET', path: `/herbie-1.1/fuel/transactions/report?begin=${new Date('2026-05-01T00:00:00-03:00').getTime()}&end=${new Date('2026-05-31T23:59:59-03:00').getTime()}&tz=America/Sao_Paulo`, accept: 'text/csv', sampleLen: 5000 },
    { label: 'fuel:report Apr2025 CSV',  method: 'GET', path: `/herbie-1.1/fuel/transactions/report?begin=${new Date('2025-04-01T00:00:00-03:00').getTime()}&end=${new Date('2025-04-30T23:59:59-03:00').getTime()}&tz=America/Sao_Paulo`, accept: 'text/csv', sampleLen: 2000 },
  ]

  const results = []
  for (const c of candidates) {
    try {
      const r = await fetch(COBLI_BASE + c.path, {
        method: c.method,
        headers: { 'cobli-api-key': token, 'Accept': c.accept || 'application/json', 'Content-Type': 'application/json' },
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

module.exports = { resumo, top, modelo, placas, modelos, rodizio, regioes, salvarRegiao, sync, probe }
