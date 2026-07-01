// controllers/recorrencia.js — Indicador de Recorrência de Manutenção / Veículos Críticos.
// Cruza ORDENS (custo + nº de entradas na oficina), MANUTENCOES (dias parado /
// indisponibilidade) e VEICULO_KM_HISTORICO (km rodado) para pontuar, de 0 a 100,
// quais veículos são candidatos à substituição.
//
// Score = 30% recorrência + 30% custo(12m) + 20% km + 20% indisponibilidade,
// cada dimensão normalizada pelo pior caso da frota. Faixas: <40 baixo, 40-69
// atenção, 70+ substituição.

const supabase = require('../supabase')

const PAGE = 1000
const DIA  = 86400000

function normPlaca(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Busca todas as linhas de uma tabela (contorna o teto de 1000 do PostgREST).
async function fetchAll(table, columns, apply) {
  let from = 0, all = []
  for (;;) {
    // order('id') garante paginação estável (sem pular/duplicar entre páginas)
    let q = supabase.from(table).select(columns).order('id', { ascending: true }).range(from, from + PAGE - 1)
    if (apply) q = apply(q)
    const { data, error } = await q
    if (error) {
      // tabela opcional (ex.: veiculo_km_historico) pode não existir → trata como vazia
      if (/does not exist|relation|schema cache/i.test(error.message)) return []
      throw error
    }
    all = all.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return all
}

// data ISO (YYYY-MM-DD) N meses/dias atrás, como string comparável
function isoMenosMeses(base, meses) {
  const d = new Date(base.getTime())
  d.setMonth(d.getMonth() - meses)
  return d.toISOString().slice(0, 10)
}
function isoMenosDias(base, dias) {
  return new Date(base.getTime() - dias * DIA).toISOString().slice(0, 10)
}

const KM_INVALIDO = 999999

// GET /api/dashboard/recorrencia?km_limite=&custo_limite=
async function recorrencia(req, res) {
  try {
    const kmLimite    = parseInt(req.query.km_limite, 10)    || 0 // 0 = alerta desligado
    const custoLimite = parseFloat(req.query.custo_limite)   || 0

    const hoje  = new Date()
    const hojeS = hoje.toISOString().slice(0, 10)
    const c3m   = isoMenosMeses(hoje, 3)
    const c6m   = isoMenosMeses(hoje, 6)
    const c12m  = isoMenosMeses(hoje, 12)
    const c24m  = isoMenosMeses(hoje, 24)
    const c90   = isoMenosDias(hoje, 90)
    const c180  = isoMenosDias(hoje, 180)

    // ── 1) Veículos ────────────────────────────────────────────────────────────
    const veiculos = await fetchAll('veiculos', 'id, placa, localidade, km_atual')
    const veiPorId    = new Map()
    const veiPorPlaca = new Map()
    const acc = new Map() // veiculo_id -> agregados
    for (const v of veiculos) {
      veiPorId.set(v.id, v)
      veiPorPlaca.set(normPlaca(v.placa), v)
      acc.set(v.id, {
        veiculo_id: v.id, placa: v.placa, localidade: v.localidade || '',
        km_atual: v.km_atual != null ? Number(v.km_atual) : null,
        visitas: new Map(),                 // visitKey -> data (min) — "entradas na oficina"
        custo_total: 0, custo_12m: 0, custo_24m: 0,
        dias_oficina_12m: 0,
        km_ini: null                        // {km, data} 1º registro de km
      })
    }

    // ── 2) Ordens (paginado) — custo e nº de entradas ─────────────────────────
    // Uma "entrada na oficina" = uma OS distinta (num_ordem); itens sem num_ordem
    // agrupam por data. Ordens canceladas não contam.
    const ordens = await fetchAll('ordens', 'veiculo_id, num_ordem, data_ordem, valor_total, status',
      q => q.neq('status', 'Cancelado'))
    for (const o of ordens) {
      if (!o.veiculo_id) continue
      const a = acc.get(o.veiculo_id)
      if (!a) continue
      const data = o.data_ordem ? String(o.data_ordem).slice(0, 10) : null
      const val  = Number(o.valor_total || 0)
      a.custo_total += val
      if (data && data >= c12m) a.custo_12m += val
      if (data && data >= c24m) a.custo_24m += val
      const vk = (o.num_ordem && String(o.num_ordem).trim()) ? 'N:' + String(o.num_ordem).trim() : 'D:' + (data || '?')
      const prev = a.visitas.get(vk)
      if (!prev || (data && data < prev)) a.visitas.set(vk, data)
    }

    // ── 3) Manutenções (por placa) — dias de indisponibilidade nos últimos 12m ─
    const manut = await fetchAll('manutencoes', 'placa, data_entrada, data_saida, status')
    for (const m of manut) {
      if (!m.data_entrada || m.status === 'Cancelado') continue
      const v = veiPorPlaca.get(normPlaca(m.placa))
      if (!v) continue
      const a = acc.get(v.id)
      const entrada = new Date(String(m.data_entrada).slice(0, 10) + 'T00:00:00')
      const saida   = m.data_saida ? new Date(String(m.data_saida).slice(0, 10) + 'T00:00:00') : hoje
      if (isNaN(entrada)) continue
      const ini = entrada.toISOString().slice(0, 10)
      // considera só o que caiu na janela de 12m (aproximação por data de entrada)
      if (ini < c12m) continue
      const dias = Math.max(0, Math.round((saida - entrada) / DIA))
      a.dias_oficina_12m += dias
    }

    // ── 4) Histórico de km — km rodado 12m e 1º registro ──────────────────────
    const hist = await fetchAll('veiculo_km_historico', 'veiculo_id, km, data_leitura')
    const histPorVeic = new Map()
    for (const h of hist) {
      if (!h.veiculo_id || h.km == null || Number(h.km) >= KM_INVALIDO) continue
      if (!histPorVeic.has(h.veiculo_id)) histPorVeic.set(h.veiculo_id, [])
      histPorVeic.get(h.veiculo_id).push({ km: Number(h.km), data: String(h.data_leitura || '').slice(0, 10) })
    }

    // ── 5) Consolida por veículo ──────────────────────────────────────────────
    const lista = []
    for (const a of acc.values()) {
      let manut_3m = 0, manut_6m = 0, manut_12m = 0, manut_90d = 0, manut_180d = 0
      for (const data of a.visitas.values()) {
        if (!data) continue
        if (data >= c3m)  manut_3m++
        if (data >= c6m)  manut_6m++
        if (data >= c12m) manut_12m++
        if (data >= c90)  manut_90d++
        if (data >= c180) manut_180d++
      }
      const manut_total = a.visitas.size

      // km rodado 12m + 1º registro
      let km_rodado_12m = null, km_ini = null
      const hs = histPorVeic.get(a.veiculo_id)
      if (hs && hs.length) {
        const ord = hs.slice().sort((x, y) => (x.data < y.data ? -1 : 1))
        km_ini = { km: ord[0].km, data: ord[0].data }
        const jan = ord.filter(h => h.data >= c12m).map(h => h.km)
        if (jan.length >= 2) km_rodado_12m = Math.max(...jan) - Math.min(...jan)
      }
      const custo_km = (km_rodado_12m && km_rodado_12m > 0) ? a.custo_12m / km_rodado_12m : null

      const pct_indisp_12m = Math.min(100, (a.dias_oficina_12m / 365) * 100)

      lista.push({
        veiculo_id: a.veiculo_id, placa: a.placa, localidade: a.localidade,
        km_atual: a.km_atual,
        manut_3m, manut_6m, manut_12m, manut_total, manut_90d, manut_180d,
        recorrencia_12m: Number((manut_12m / 12).toFixed(2)),
        custo_12m: Number(a.custo_12m.toFixed(2)),
        custo_24m: Number(a.custo_24m.toFixed(2)),
        custo_total: Number(a.custo_total.toFixed(2)),
        km_rodado_12m,
        custo_km: custo_km != null ? Number(custo_km.toFixed(2)) : null,
        dias_oficina_12m: a.dias_oficina_12m,
        pct_indisp_12m: Number(pct_indisp_12m.toFixed(1)),
        km_ini
      })
    }

    // ── 6) Score (normalizado pelo pior caso da frota) ────────────────────────
    const maxRec    = Math.max(1, ...lista.map(v => v.manut_12m))
    const maxCusto  = Math.max(1, ...lista.map(v => v.custo_12m))
    const maxKm     = Math.max(1, ...lista.map(v => v.km_atual || 0))
    const maxIndisp = Math.max(1, ...lista.map(v => v.dias_oficina_12m))

    for (const v of lista) {
      const nRec    = v.manut_12m / maxRec
      const nCusto  = v.custo_12m / maxCusto
      const nKm     = (v.km_atual || 0) / maxKm
      const nIndisp = v.dias_oficina_12m / maxIndisp
      v.score = Math.round(100 * (0.30 * nRec + 0.30 * nCusto + 0.20 * nKm + 0.20 * nIndisp))
      v.faixa = v.score >= 70 ? 'substituicao' : (v.score >= 40 ? 'atencao' : 'baixo')

      // alertas
      const al = []
      if (v.manut_90d  > 3) al.push(`Mais de 3 manutenções em 90 dias (${v.manut_90d})`)
      if (v.manut_180d > 6) al.push(`Mais de 6 manutenções em 180 dias (${v.manut_180d})`)
      if (kmLimite    > 0 && (v.km_atual || 0) > kmLimite) al.push(`Km acima do limite (${(v.km_atual||0).toLocaleString('pt-BR')} km)`)
      if (custoLimite > 0 && v.custo_12m > custoLimite)    al.push(`Custo 12m acima do limite (R$ ${v.custo_12m.toLocaleString('pt-BR')})`)
      v.alertas = al
    }

    lista.sort((a, b) => b.score - a.score || b.custo_12m - a.custo_12m)

    const totais = {
      veiculos:        lista.length,
      substituicao:    lista.filter(v => v.faixa === 'substituicao').length,
      atencao:         lista.filter(v => v.faixa === 'atencao').length,
      baixo:           lista.filter(v => v.faixa === 'baixo').length,
      com_alerta:      lista.filter(v => v.alertas.length > 0).length,
      custo_12m_frota: Number(lista.reduce((s, v) => s + v.custo_12m, 0).toFixed(2))
    }

    res.json({
      gerado_em: hojeS,
      parametros: { km_limite: kmLimite, custo_limite: custoLimite },
      totais,
      veiculos: lista
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = { recorrencia }
