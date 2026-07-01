const supabase = require('../supabase')

// Normaliza placa p/ casar independente de hífen/caixa (BRA-2025 == bra2025)
function normPlaca(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// dd/mm/yyyy -> yyyy-mm-dd
function dataIso(d) {
  const p = String(d || '').trim().split('/')
  if (p.length !== 3) return null
  const [dd, mm, yy] = p
  if (!yy || yy.length !== 4) return null
  return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

// Km em PT-BR ("208.232") -> 208232 (odômetro é inteiro; ponto é separador de milhar)
function parseKm(v) {
  const digits = String(v || '').replace(/\D/g, '')
  if (!digits) return null
  return parseInt(digits, 10)
}

// Chave ordenável (yyyymmddHHMM) pra achar a leitura mais recente
function chaveOrdem(iso, hora) {
  return (iso || '').replace(/-/g, '') + String(hora || '').replace(/\D/g, '').padEnd(4, '0')
}

const KM_INVALIDO = 999999 // placeholder digitado errado no posto/bomba

// Parseia o relatório "Últimas Quilometragens/Horas" (HTML disfarçado de .xls)
// e retorna a leitura de km MAIS RECENTE por placa. Quando a leitura mais recente
// é o placeholder 999.999 (erro digitado no posto), cai para a leitura VÁLIDA
// anterior mais recente da mesma placa ("penúltima com valor real"), se existir.
function parseRelatorio(buffer) {
  const text = buffer.toString('latin1')
  const rowRe  = /<tr class="Linha(?:Impar|Par)">([\s\S]*?)<\/tr>/g
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g
  const latest   = {} // leitura mais recente (qualquer valor)
  const latestOk = {} // leitura mais recente com km VÁLIDO (< 999.999)
  let m
  while ((m = rowRe.exec(text))) {
    const cells = []
    let c
    while ((c = cellRe.exec(m[1]))) {
      cells.push(c[1].replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, '').trim())
    }
    // colunas: [0]placa [1]tipo frota [2]data [3]hora [4]quilometragem ...
    if (cells.length < 5) continue
    const placa = cells[0].trim()
    const km    = parseKm(cells[4])
    if (!placa || km === null) continue // pula frota de horímetro / linhas sem km
    const iso  = dataIso(cells[2])
    const hora = cells[3].trim()
    const key  = chaveOrdem(iso, hora)
    const norm = normPlaca(placa)
    const rec  = { placa, norm, km, data_leitura: iso, hora, key }
    if (!latest[norm]   || key > latest[norm].key)                     latest[norm]   = rec
    if (km < KM_INVALIDO && (!latestOk[norm] || key > latestOk[norm].key)) latestOk[norm] = rec
  }
  return Object.keys(latest).map(norm => {
    const top = latest[norm]
    const ok  = latestOk[norm]
    // topo inválido mas existe leitura válida anterior → usa a válida
    if (top.km >= KM_INVALIDO && ok) return { ...ok, invalido_ignorado: true }
    return top
  })
}

// POST /api/km/preview — lê o arquivo, compara com o banco e devolve o preview (não grava)
async function preview(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' })

    const leituras = parseRelatorio(req.file.buffer)
    if (!leituras.length) {
      return res.status(400).json({
        error: 'Não encontrei linhas de quilometragem no arquivo. Confira se é o relatório "Últimas Quilometragens/Horas" baixado do portal TicketLog.'
      })
    }

    const { data: veiculos, error } = await supabase
      .from('veiculos')
      .select('id, placa, km_atual')
    if (error) throw error

    const porPlaca = {}
    for (const v of (veiculos || [])) porPlaca[normPlaca(v.placa)] = v

    const itens = leituras.map(l => {
      const v = porPlaca[l.norm]
      let status = 'ok'
      if (l.km >= KM_INVALIDO)                                status = 'invalido'
      else if (!v)                                           status = 'nao_encontrado'
      else if (v.km_atual != null && l.km < v.km_atual)      status = 'regressao'
      return {
        placa:        l.placa,
        veiculo_id:   v ? v.id : null,
        km_sistema:   v ? v.km_atual : null,
        km_novo:      l.km,
        diff:         (v && v.km_atual != null) ? l.km - v.km_atual : null,
        data_leitura: l.data_leitura,
        hora:         l.hora,
        status,
        invalido_ignorado: l.invalido_ignorado || false // caiu p/ leitura válida anterior (topo era 999.999)
      }
    }).sort((a, b) => a.placa.localeCompare(b.placa))

    res.json({
      total:          itens.length,
      ok:             itens.filter(i => i.status === 'ok').length,
      regressao:      itens.filter(i => i.status === 'regressao').length,
      invalido:       itens.filter(i => i.status === 'invalido').length,
      nao_encontrado: itens.filter(i => i.status === 'nao_encontrado').length,
      itens
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// Grava a km dos veículos e registra no histórico.
// Reutilizada pelo import manual (aplicar) e pelo futuro sync online.
// `atualizacoes`: [{ veiculo_id, km, data_leitura, placa? }]
async function gravarKm(atualizacoes, origem = 'import') {
  const lista = Array.isArray(atualizacoes) ? atualizacoes : []
  let atualizados = 0
  const erros = []

  for (const it of lista) {
    if (!it.veiculo_id || it.km == null) continue
    const km = parseInt(it.km, 10)
    const dataLeitura = it.data_leitura || null

    const payload = {
      km_atual:         km,
      km_atualizado_em: dataLeitura,
      updated_at:       new Date().toISOString()
    }
    // Resiliente: se a coluna km_atualizado_em ainda não existir no schema, refaz sem ela.
    let { error } = await supabase.from('veiculos').update(payload).eq('id', it.veiculo_id)
    if (error && /km_atualizado_em/.test(error.message)) {
      delete payload.km_atualizado_em
      ;({ error } = await supabase.from('veiculos').update(payload).eq('id', it.veiculo_id))
    }
    if (error) { erros.push({ veiculo_id: it.veiculo_id, erro: error.message }); continue }
    atualizados++

    // Histórico (append-only, idempotente). Não deve derrubar o update se a tabela
    // ainda não existir — só loga. UNIQUE(veiculo_id, data_leitura, km) evita duplicar.
    try {
      const { error: eh } = await supabase
        .from('veiculo_km_historico')
        .upsert(
          { veiculo_id: it.veiculo_id, placa: it.placa || null, km, data_leitura: dataLeitura, origem },
          { onConflict: 'veiculo_id,data_leitura,km', ignoreDuplicates: true }
        )
      if (eh) console.warn('[km-historico] ignorado:', eh.message)
    } catch (e) {
      console.warn('[km-historico] falhou:', e.message)
    }
  }

  return { atualizados, erros }
}

// Salva o snapshot completo do relatório (TODAS as placas, mesmo as não cadastradas)
// na tabela km_ticketlog — é o que alimenta a subaba Quilometragem.
// Resiliente: se a tabela ainda não existir, só loga (não quebra o import).
async function salvarSnapshotRelatorio(relatorio) {
  const lista = Array.isArray(relatorio) ? relatorio : []
  if (!lista.length) return
  const nowIso = new Date().toISOString()
  const rows = lista.filter(it => it && it.placa).map(it => {
    const kmRaw = it.km_novo != null ? it.km_novo : it.km
    return {
      placa:        String(it.placa).toUpperCase().trim(),
      km:           kmRaw != null ? parseInt(kmRaw, 10) : null,
      data_leitura: it.data_leitura || null,
      hora:         it.hora || null,
      status:       it.status || null,
      veiculo_id:   it.veiculo_id || null,
      importado_em: nowIso
    }
  })
  try {
    const { error } = await supabase.from('km_ticketlog').upsert(rows, { onConflict: 'placa' })
    if (error) console.warn('[km_ticketlog] ignorado:', error.message)
  } catch (e) {
    console.warn('[km_ticketlog] falhou:', e.message)
  }
}

// POST /api/km/aplicar — grava a km dos veículos selecionados (import manual)
// e persiste o snapshot do relatório inteiro (body.relatorio) para a subaba.
async function aplicar(req, res) {
  try {
    const lista     = Array.isArray(req.body && req.body.atualizacoes) ? req.body.atualizacoes : []
    const relatorio = req.body && req.body.relatorio
    const temRelatorio = Array.isArray(relatorio) && relatorio.length > 0
    if (!lista.length && !temRelatorio) return res.status(400).json({ error: 'Nada para atualizar.' })

    const { atualizados, erros } = await gravarKm(lista, 'manual')
    await salvarSnapshotRelatorio(relatorio)
    res.json({ atualizados, erros_count: erros.length, erros })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// GET /api/km/ticketlog — placas do último relatório importado, com localidade e flag de cadastro
async function listarTicketlog(req, res) {
  try {
    const { data: rows, error } = await supabase.from('km_ticketlog').select('*').order('placa')
    if (error) {
      // tabela ainda não criada → devolve vazio (subaba mostra "nenhum relatório importado")
      if (/km_ticketlog/i.test(error.message) || error.code === '42P01') return res.json([])
      throw error
    }

    const { data: veiculos } = await supabase.from('veiculos').select('id, placa, localidade')
    const locById = {}, veiPorPlaca = {}
    for (const v of (veiculos || [])) {
      locById[v.id] = v.localidade
      veiPorPlaca[normPlaca(v.placa)] = v
    }

    const out = (rows || []).map(r => {
      const v = r.veiculo_id ? { localidade: locById[r.veiculo_id] } : veiPorPlaca[normPlaca(r.placa)]
      return {
        placa:        r.placa,
        km:           r.km,
        data_leitura: r.data_leitura,
        hora:         r.hora,
        status:       r.status,
        importado_em: r.importado_em,
        cadastrada:   !!(r.veiculo_id || v),
        localidade:   v ? v.localidade : null
      }
    })
    res.json(out)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = { preview, aplicar, gravarKm, listarTicketlog, parseRelatorio }
