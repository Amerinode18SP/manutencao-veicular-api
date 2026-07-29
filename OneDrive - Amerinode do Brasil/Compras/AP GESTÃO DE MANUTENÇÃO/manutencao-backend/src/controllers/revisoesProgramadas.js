// controllers/revisoesProgramadas.js — agendamento de revisões (manual ou planilha).
//
// Antes só existia UMA data por veículo (`veiculos.proxima_revisao`), sem tipo nem
// serviço. Aqui cada veículo pode ter várias revisões agendadas, cada uma com
// TIPO (Preventiva/Corretiva/...) e SERVIÇO (troca de pneu, alinhamento...).
//
// `veiculos.proxima_revisao` continua sincronizada com a revisão PENDENTE mais
// próxima de cada veículo — assim dashboard, relatórios e exports antigos seguem
// funcionando sem alteração.

const supabase = require('../supabase')

const TIPOS = ['Preventiva', 'Corretiva', 'Preditiva', 'Segurança']
const STATUS = ['Pendente', 'Concluída', 'Cancelada']

// Sugestões que aparecem no autocomplete do campo Serviço. É só sugestão:
// o operador pode digitar qualquer texto.
const SERVICOS_SUGERIDOS = [
  'Revisão preventiva', 'Troca de óleo e filtro', 'Troca de pneu',
  'Alinhamento e balanceamento', 'Rodízio de pneus', 'Troca de pastilha de freio',
  'Troca de disco de freio', 'Revisão de suspensão', 'Troca de correia dentada',
  'Troca de bateria', 'Troca de filtro de ar', 'Troca de filtro de combustível',
  'Troca de amortecedores', 'Revisão elétrica', 'Higienização do ar-condicionado',
  'Troca de fluido de freio', 'Troca de velas', 'Revisão de embreagem'
]

const normPlaca = p => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

function tipoValido(t) {
  const v = String(t || '').trim()
  const achou = TIPOS.find(x => x.toLowerCase() === v.toLowerCase())
  return achou || null
}

// Confere se a data existe de verdade no calendário: "2026-13-31" e "2026-02-30"
// têm o formato certo mas não são datas — sem isto o erro só apareceria no banco,
// como um 500 incompreensível no meio do import.
function dataReal(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return null
  const [a, mes, dia] = [+m[1], +m[2], +m[3]]
  const d = new Date(Date.UTC(a, mes - 1, dia))
  const ok = d.getUTCFullYear() === a && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
  return ok ? iso : null
}

// "31/12/2026", "2026-12-31", serial do Excel → "2026-12-31" (ou null se inválida)
function parseData(valor) {
  if (valor === null || valor === undefined || valor === '') return null
  const s = String(valor).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dataReal(s)
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return dataReal(s.slice(0, 10))
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return dataReal(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`)
  if (/^\d{4,5}$/.test(s)) {                        // serial do Excel
    const d = new Date(Math.round((parseInt(s, 10) - 25569) * 86400 * 1000))
    if (!isNaN(d)) return d.toISOString().slice(0, 10)
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function parseKm(valor) {
  if (valor === null || valor === undefined || valor === '') return null
  const n = parseInt(String(valor).replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

// Erro "tabela ainda não criada" (SQL manual pendente) — o resto do sistema
// continua funcionando com a `veiculos.proxima_revisao` antiga.
const tabelaAusente = err =>
  /revisoes_programadas/.test(err.message || '') &&
  /(does not exist|schema cache|relation)/i.test(err.message || '')

// ── Sincroniza veiculos.proxima_revisao com a pendente mais próxima ──────────
async function sincronizarVeiculos(veiculoIds) {
  const ids = [...new Set((veiculoIds || []).filter(Boolean))]
  if (!ids.length) return
  try {
    const { data, error } = await supabase
      .from('revisoes_programadas')
      .select('veiculo_id, data_prevista')
      .in('veiculo_id', ids)
      .eq('status', 'Pendente')
      .order('data_prevista')
    if (error) throw error

    const menor = new Map()
    for (const r of (data || [])) {
      const d = String(r.data_prevista).slice(0, 10)
      if (!menor.has(r.veiculo_id) || d < menor.get(r.veiculo_id)) menor.set(r.veiculo_id, d)
    }
    for (const id of ids) {
      await supabase.from('veiculos')
        .update({ proxima_revisao: menor.get(id) || null, updated_at: new Date().toISOString() })
        .eq('id', id)
    }
  } catch (e) {
    console.warn('[revisoes] não sincronizou veiculos.proxima_revisao:', e.message)
  }
}

// ── Ponte com os caminhos antigos ────────────────────────────────────────────
// Cadastro/edição de veículo, cadastro/edição de OC e import de Excel gravam
// `veiculos.proxima_revisao` direto. Como a agenda virou a fonte do alerta por
// e-mail, toda data escrita por ali precisa existir também em
// `revisoes_programadas` — senão o aviso nunca sairia para aquela data.
// Silencioso de propósito: nunca quebra o fluxo principal.
async function garantirRevisaoDaData(veiculoId, placa, data) {
  try {
    const d = parseData(data)
    if (!veiculoId || !d) return
    const { data: existentes } = await supabase
      .from('revisoes_programadas')
      .select('id')
      .eq('veiculo_id', veiculoId)
      .eq('data_prevista', d)
      .limit(1)
    if (existentes && existentes.length) return   // já há algo agendado nessa data

    await supabase.from('revisoes_programadas').upsert([{
      veiculo_id: veiculoId,
      placa: placa ? String(placa).toUpperCase() : null,
      data_prevista: d,
      tipo: 'Preventiva',
      servico: 'Revisão preventiva',
      status: 'Pendente',
      origem: 'Manual',
      updated_at: new Date().toISOString()
    }], { onConflict: 'veiculo_id,data_prevista,servico', ignoreDuplicates: true })
  } catch (e) {
    console.warn('[revisoes] não espelhou proxima_revisao na agenda:', e.message)
  }
}

// mapa placa normalizada → { id, placa, localidade, km_atual }
// km_atual vem do cadastro (alimentado pelo sync/import TicketLog) — a tela mostra
// junto do km_previsto para dar contexto de quanto falta rodar.
async function mapaVeiculos() {
  const { data, error } = await supabase.from('veiculos').select('id, placa, localidade, km_atual')
  if (error) throw error
  const mapa = new Map()
  for (const v of (data || [])) mapa.set(normPlaca(v.placa), v)
  return mapa
}

// ── GET /api/revisoes ────────────────────────────────────────────────────────
// ?status=Pendente|Concluída|Cancelada|todas  &placa=  &dias=  (janela em dias)
async function listar(req, res) {
  try {
    let q = supabase.from('revisoes_programadas')
      .select('*')
      .order('data_prevista')

    const status = String(req.query.status || 'Pendente')
    if (status !== 'todas') q = q.eq('status', status)
    if (req.query.placa) q = q.eq('placa', String(req.query.placa).toUpperCase())
    if (req.query.dias) {
      const ate = new Date()
      ate.setDate(ate.getDate() + (parseInt(req.query.dias, 10) || 30))
      q = q.lte('data_prevista', ate.toISOString().slice(0, 10))
    }

    const { data, error } = await q
    if (error) throw error

    // anexa localidade e km atual do veículo (a tela mostra as duas)
    const veics = await mapaVeiculos()
    const porId = new Map([...veics.values()].map(v => [v.id, v]))
    res.json((data || []).map(r => {
      const v = porId.get(r.veiculo_id) || {}
      return { ...r, localidade: v.localidade || '', km_atual: v.km_atual != null ? v.km_atual : null }
    }))
  } catch (err) {
    if (tabelaAusente(err)) return res.json([])
    res.status(500).json({ error: err.message })
  }
}

// GET /api/revisoes/servicos — sugestões + o que já foi usado antes
async function listarServicos(_req, res) {
  try {
    const usados = new Set()
    try {
      const { data } = await supabase.from('revisoes_programadas').select('servico').limit(2000)
      for (const r of (data || [])) if (r.servico) usados.add(r.servico.trim())
    } catch { /* tabela ainda não criada */ }
    try {
      const { data } = await supabase.from('vida_util').select('item').limit(500)
      for (const r of (data || [])) if (r.item) usados.add(String(r.item).trim())
    } catch { /* vida_util opcional */ }
    const lista = [...new Set([...SERVICOS_SUGERIDOS, ...usados])]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    res.json({ tipos: TIPOS, servicos: lista })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// Valida + resolve a placa de um item vindo da tela ou da planilha.
// → { ok: true, linha } | { ok: false, motivo }
function prepararItem(item, veics) {
  const placaRaw = item.placa || ''
  const placa = normPlaca(placaRaw)
  if (!placa) return { ok: false, motivo: 'placa em branco' }

  const veic = veics.get(placa)
  if (!veic) return { ok: false, motivo: `placa ${placaRaw} não cadastrada em Veículos` }

  const data = parseData(item.data_prevista)
  if (!data) return { ok: false, motivo: `data inválida (${item.data_prevista || 'vazia'})` }

  const servico = String(item.servico || '').trim()
  if (!servico) return { ok: false, motivo: 'serviço em branco' }

  const tipo = tipoValido(item.tipo) || 'Preventiva'

  return {
    ok: true,
    linha: {
      veiculo_id: veic.id,
      placa: veic.placa,
      data_prevista: data,
      km_previsto: parseKm(item.km_previsto),
      tipo,
      servico,
      observacao: String(item.observacao || '').trim() || null,
      status: 'Pendente',
      origem: item.origem || 'Manual',
      updated_at: new Date().toISOString()
    }
  }
}

// ── POST /api/revisoes ───────────────────────────────────────────────────────
// Aceita um item só ou { itens: [...] } (usado pelo cadastro manual)
async function criar(req, res) {
  try {
    const brutos = Array.isArray(req.body.itens) ? req.body.itens : [req.body]
    const veics = await mapaVeiculos()
    const linhas = [], erros = []
    for (const b of brutos) {
      const r = prepararItem(b, veics)
      r.ok ? linhas.push(r.linha) : erros.push(r.motivo)
    }
    if (!linhas.length) return res.status(400).json({ error: erros.join('; ') || 'Nada para gravar.' })

    const { data, error } = await supabase.from('revisoes_programadas')
      .upsert(linhas, { onConflict: 'veiculo_id,data_prevista,servico' })
      .select()
    if (error) throw error

    await sincronizarVeiculos(linhas.map(l => l.veiculo_id))
    res.json({ gravadas: (data || []).length, erros, revisoes: data || [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── PUT /api/revisoes/:id ────────────────────────────────────────────────────
async function atualizar(req, res) {
  try {
    const payload = { updated_at: new Date().toISOString() }
    if ('data_prevista' in req.body) {
      const d = parseData(req.body.data_prevista)
      if (!d) return res.status(400).json({ error: 'Data inválida.' })
      payload.data_prevista = d
    }
    if ('tipo' in req.body) {
      const t = tipoValido(req.body.tipo)
      if (!t) return res.status(400).json({ error: `Tipo inválido. Use: ${TIPOS.join(', ')}.` })
      payload.tipo = t
    }
    if ('servico' in req.body) {
      const s = String(req.body.servico || '').trim()
      if (!s) return res.status(400).json({ error: 'Serviço não pode ficar em branco.' })
      payload.servico = s
    }
    if ('km_previsto' in req.body) payload.km_previsto = parseKm(req.body.km_previsto)
    if ('observacao' in req.body)  payload.observacao  = String(req.body.observacao || '').trim() || null
    if ('status' in req.body) {
      const st = STATUS.find(x => x.toLowerCase() === String(req.body.status || '').toLowerCase())
      if (!st) return res.status(400).json({ error: `Status inválido. Use: ${STATUS.join(', ')}.` })
      payload.status = st
      payload.concluida_em = st === 'Concluída' ? new Date().toISOString().slice(0, 10) : null
    }

    const { data, error } = await supabase.from('revisoes_programadas')
      .update(payload).eq('id', req.params.id).select().single()
    if (error) throw error
    await sincronizarVeiculos([data.veiculo_id])
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── POST /api/revisoes/:id/concluir ──────────────────────────────────────────
// Marca como concluída e, se vier { proxima_em_dias } ou { proxima_data },
// já agenda a próxima do mesmo serviço (ciclo de manutenção).
async function concluir(req, res) {
  try {
    const { data: atual, error: e1 } = await supabase
      .from('revisoes_programadas').select('*').eq('id', req.params.id).single()
    if (e1) throw e1

    const { error: e2 } = await supabase.from('revisoes_programadas').update({
      status: 'Concluída',
      concluida_em: parseData((req.body || {}).concluida_em) || new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString()
    }).eq('id', req.params.id)
    if (e2) throw e2

    let proxima = null
    const dias = parseInt((req.body || {}).proxima_em_dias, 10)
    const dataProx = parseData((req.body || {}).proxima_data)
    if (dataProx || (Number.isFinite(dias) && dias > 0)) {
      let d = dataProx
      if (!d) {
        const base = new Date(atual.data_prevista + 'T12:00:00Z')
        base.setUTCDate(base.getUTCDate() + dias)
        d = base.toISOString().slice(0, 10)
      }
      const { data, error } = await supabase.from('revisoes_programadas').upsert([{
        veiculo_id: atual.veiculo_id, placa: atual.placa, data_prevista: d,
        km_previsto: atual.km_previsto, tipo: atual.tipo, servico: atual.servico,
        observacao: atual.observacao, status: 'Pendente', origem: 'Manual',
        updated_at: new Date().toISOString()
      }], { onConflict: 'veiculo_id,data_prevista,servico' }).select()
      if (error) throw error
      proxima = (data || [])[0] || null
    }

    await sincronizarVeiculos([atual.veiculo_id])
    res.json({ concluida: true, proxima })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── DELETE /api/revisoes/:id ─────────────────────────────────────────────────
async function remover(req, res) {
  try {
    const { data, error } = await supabase.from('revisoes_programadas')
      .delete().eq('id', req.params.id).select().single()
    if (error) throw error
    await sincronizarVeiculos([data.veiculo_id])
    res.json({ removida: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── POST /api/revisoes/importar ──────────────────────────────────────────────
// body: { itens: [...], preview: true|false }
// preview=true só valida e devolve o que aconteceria (nada é gravado).
async function importar(req, res) {
  try {
    const brutos = Array.isArray(req.body.itens) ? req.body.itens : []
    if (!brutos.length) return res.status(400).json({ error: 'Planilha sem linhas válidas.' })

    const veics = await mapaVeiculos()
    const linhas = [], ignorados = []
    const vistas = new Set()

    brutos.forEach((b, i) => {
      const r = prepararItem({ ...b, origem: 'Planilha' }, veics)
      if (!r.ok) { ignorados.push({ linha: i + 2, placa: b.placa || '', motivo: r.motivo }); return }
      // duplicada dentro da própria planilha
      const chave = `${r.linha.veiculo_id}|${r.linha.data_prevista}|${r.linha.servico.toLowerCase()}`
      if (vistas.has(chave)) { ignorados.push({ linha: i + 2, placa: r.linha.placa, motivo: 'repetida na própria planilha' }); return }
      vistas.add(chave)
      linhas.push(r.linha)
    })

    if (req.body.preview) {
      return res.json({ preview: true, total: brutos.length, validos: linhas.length, itens: linhas, ignorados })
    }
    if (!linhas.length) return res.status(400).json({ error: 'Nenhuma linha válida para importar.', ignorados })

    const { data, error } = await supabase.from('revisoes_programadas')
      .upsert(linhas, { onConflict: 'veiculo_id,data_prevista,servico' })
      .select()
    if (error) throw error

    await sincronizarVeiculos(linhas.map(l => l.veiculo_id))
    res.json({ gravadas: (data || []).length, total: brutos.length, ignorados })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = {
  listar, listarServicos, criar, atualizar, concluir, remover, importar,
  TIPOS, SERVICOS_SUGERIDOS, sincronizarVeiculos, garantirRevisaoDaData
}
