const supabase = require('../supabase')

// Tenta operação; se Postgres reportar coluna ausente, refaz sem ela.
async function tentarSemColunaFaltante(payload, fn) {
  let r = await fn(payload)
  let p = payload
  while (r.error && /Could not find the '([^']+)' column/.test(r.error.message)) {
    const col = r.error.message.match(/Could not find the '([^']+)' column/)[1]
    if (!(col in p)) break
    p = { ...p }
    delete p[col]
    r = await fn(p)
  }
  return r
}

// ── Listar ordens (com filtros) ───────────────────────────────────────────────
async function listar(req, res) {
  try {
    const { status, categoria, placa, supervisor, origem, num_ordem, item,
            data_inicio, data_fim, page = 1, limit = 50 } = req.query

    let query = supabase
      .from('ordens')
      .select(`
        *,
        veiculo:veiculos(placa, localidade, km_atual, proxima_revisao),
        fornecedor:fornecedores(razao_social, cnpj)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (status)      query = query.eq('status', status)
    if (categoria)   query = query.eq('categoria', categoria)
    if (origem)      query = query.eq('origem', origem)
    if (placa)       query = query.ilike('veiculos.placa', `%${placa}%`)
    if (num_ordem)   query = query.ilike('num_ordem', `%${num_ordem}%`)
    if (item)        query = query.ilike('item', `%${item}%`)
    if (data_inicio) query = query.gte('data_ordem', data_inicio)
    if (data_fim)    query = query.lte('data_ordem', data_fim)

    const { data, error, count } = await query
    if (error) throw error

    res.json({ data, total: count, page: Number(page), limit: Number(limit) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Buscar ordem por ID ──────────────────────────────────────────────────────
async function buscarPorId(req, res) {
  try {
    const { data, error } = await supabase
      .from('ordens')
      .select(`*, veiculo:veiculos(*), fornecedor:fornecedores(*)`)
      .eq('id', req.params.id)
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Ordem não encontrada' })

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Criar ordem ──────────────────────────────────────────────────────────────
async function criar(req, res) {
  try {
    const {
      // veículo
      placa, localidade, km_atual, proxima_revisao, observacao_veiculo,
      // fornecedor
      fornecedor, cnpj, observacao_fornecedor,
      // ordem
      supervisor, num_ordem, link_ordem, nota_fiscal,
      data_ordem, categoria, item, valor_item, quantidade,
      observacao,
      status = 'Pendente', origem = 'Manual'
    } = req.body

    // 1. Upsert veículo
    const veiculoPayload = { placa: placa.toUpperCase(), localidade, km_atual, proxima_revisao }
    if (observacao_veiculo !== undefined) veiculoPayload.observacao = observacao_veiculo
    const { data: veiculoData, error: veiculoErr } = await tentarSemColunaFaltante(
      veiculoPayload,
      p => supabase.from('veiculos').upsert(p, { onConflict: 'placa' }).select().single()
    )
    if (veiculoErr) throw veiculoErr

    // 2. Upsert fornecedor
    const fornecedorPayload = { razao_social: fornecedor, cnpj: cnpj.replace(/\D/g, '') }
    if (observacao_fornecedor !== undefined) fornecedorPayload.observacao = observacao_fornecedor
    const { data: fornecedorData, error: fornecedorErr } = await tentarSemColunaFaltante(
      fornecedorPayload,
      p => supabase.from('fornecedores').upsert(p, { onConflict: 'cnpj' }).select().single()
    )
    if (fornecedorErr) throw fornecedorErr

    // 3. Inserir ordem
    const valor_total = (parseFloat(valor_item) || 0) * (parseInt(quantidade) || 1)

    const ordemPayload = {
      veiculo_id:    veiculoData.id,
      fornecedor_id: fornecedorData.id,
      supervisor, num_ordem, link_ordem, nota_fiscal,
      data_ordem, categoria, item,
      valor_item: parseFloat(valor_item) || 0,
      quantidade: parseInt(quantidade) || 1,
      valor_total,
      observacao: observacao || null,
      status, origem
    }
    const { data: ordemData, error: ordemErr } = await tentarSemColunaFaltante(
      ordemPayload,
      p => supabase.from('ordens').insert(p).select().single()
    )
    if (ordemErr) throw ordemErr

    res.status(201).json(ordemData)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Atualizar ordem ──────────────────────────────────────────────────────────
async function atualizar(req, res) {
  try {
    // Separar campos do veículo (prefixo _), fornecedor e campos da ordem
    const body = req.body
    const fornecedor             = body.fornecedor
    const cnpj                   = body.cnpj
    const observacao_fornecedor  = body.observacao_fornecedor
    const placa                  = body._placa       || body.placa
    const localidade             = body._localidade  || body.localidade
    const km_atual               = body._km_atual    !== undefined ? body._km_atual    : body.km_atual
    const proxima_revisao        = body._proxima_revisao !== undefined ? body._proxima_revisao : body.proxima_revisao
    const observacao_veiculo     = body.observacao_veiculo

    // Campos que vão para a tabela ordens (remover tudo que não é coluna de ordens)
    const camposOrdem = {}
    const colunasOrdem = ['supervisor','num_ordem','link_ordem','nota_fiscal','data_ordem','categoria','item','valor_item','quantidade','valor_total','status','origem','observacao']
    for (const col of colunasOrdem) {
      if (body[col] !== undefined) camposOrdem[col] = body[col]
    }

    if (camposOrdem.valor_item !== undefined || camposOrdem.quantidade !== undefined) {
      const vi = parseFloat(camposOrdem.valor_item) || 0
      const qt = parseInt(camposOrdem.quantidade)   || 1
      camposOrdem.valor_total = vi * qt
    }

    // Buscar a ordem com dados atuais de veículo e fornecedor (para detectar troca real)
    const { data: ordemAtual } = await supabase
      .from('ordens')
      .select('veiculo_id, fornecedor_id, veiculo:veiculos(placa), fornecedor:fornecedores(cnpj)')
      .eq('id', req.params.id).single()

    // ── Veículo ───────────────────────────────────────────────────────────────
    // Se a placa mudou (diferente da atual), faz UPSERT por placa e troca o
    // veiculo_id desta ordem (evita renomear veículo compartilhado por outras ordens).
    // Se a placa é a mesma (ou ausente), só atualiza dados do veículo existente.
    if (ordemAtual) {
      const placaAtual = (ordemAtual.veiculo?.placa || '').toUpperCase().trim()
      const placaNova  = placa ? placa.toUpperCase().trim() : null
      const trocouVeiculo = placaNova && placaNova !== placaAtual

      if (trocouVeiculo) {
        const veiculoPayload = { placa: placaNova }
        if (localidade)                       veiculoPayload.localidade = localidade
        if (km_atual !== undefined)           veiculoPayload.km_atual = km_atual
        if (proxima_revisao !== undefined)    veiculoPayload.proxima_revisao = proxima_revisao || null
        if (observacao_veiculo !== undefined) veiculoPayload.observacao = observacao_veiculo || null
        const { data: novoVeic, error: vErr } = await tentarSemColunaFaltante(
          veiculoPayload,
          p => supabase.from('veiculos').upsert(p, { onConflict: 'placa' }).select().single()
        )
        if (vErr) throw vErr
        camposOrdem.veiculo_id = novoVeic.id
      } else if (ordemAtual.veiculo_id) {
        const veiculoUpdate = { updated_at: new Date().toISOString() }
        if (localidade)                       veiculoUpdate.localidade = localidade
        if (km_atual !== undefined)           veiculoUpdate.km_atual = km_atual
        if (proxima_revisao !== undefined)    veiculoUpdate.proxima_revisao = proxima_revisao || null
        if (observacao_veiculo !== undefined) veiculoUpdate.observacao = observacao_veiculo || null
        if (Object.keys(veiculoUpdate).length > 1) {
          await tentarSemColunaFaltante(veiculoUpdate, p =>
            supabase.from('veiculos').update(p).eq('id', ordemAtual.veiculo_id)
          )
        }
      }

      // ── Fornecedor ─────────────────────────────────────────────────────────
      // Se o CNPJ mudou (diferente do atual), faz UPSERT por CNPJ e troca o
      // fornecedor_id desta ordem (evita renomear fornecedor compartilhado).
      // Se o CNPJ é o mesmo, só atualiza dados do fornecedor existente.
      const cnpjAtual = (ordemAtual.fornecedor?.cnpj || '').replace(/\D/g, '')
      const cnpjNovo  = cnpj ? cnpj.replace(/\D/g, '') : null
      const trocouFornecedor = cnpjNovo && cnpjNovo !== cnpjAtual

      if (trocouFornecedor) {
        const fornecedorPayload = { razao_social: fornecedor || '(sem nome)', cnpj: cnpjNovo }
        if (observacao_fornecedor !== undefined) fornecedorPayload.observacao = observacao_fornecedor || null
        const { data: novoForn, error: fErr } = await tentarSemColunaFaltante(
          fornecedorPayload,
          p => supabase.from('fornecedores').upsert(p, { onConflict: 'cnpj' }).select().single()
        )
        if (fErr) throw fErr
        camposOrdem.fornecedor_id = novoForn.id
      } else if (ordemAtual.fornecedor_id && (fornecedor || observacao_fornecedor !== undefined)) {
        const fornecedorUpdate = { updated_at: new Date().toISOString() }
        if (fornecedor) fornecedorUpdate.razao_social = fornecedor
        if (observacao_fornecedor !== undefined) fornecedorUpdate.observacao = observacao_fornecedor || null
        await tentarSemColunaFaltante(fornecedorUpdate, p =>
          supabase.from('fornecedores').update(p).eq('id', ordemAtual.fornecedor_id)
        )
      }
    }

    // Atualizar ordem (inclui possivelmente novos veiculo_id / fornecedor_id)
    const { data, error } = await tentarSemColunaFaltante(
      { ...camposOrdem, updated_at: new Date().toISOString() },
      p => supabase.from('ordens').update(p).eq('id', req.params.id).select().single()
    )

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Excluir ordem ────────────────────────────────────────────────────────────
async function excluir(req, res) {
  try {
    const { error } = await supabase
      .from('ordens')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ message: 'Ordem excluída com sucesso' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Atualizar só o status ────────────────────────────────────────────────────
async function atualizarStatus(req, res) {
  try {
    const { status } = req.body
    const statusValidos = ['Pendente', 'Em Preparação', 'Concluído', 'Cancelado']
    if (!statusValidos.includes(status))
      return res.status(400).json({ error: 'Status inválido' })

    const { data, error } = await supabase
      .from('ordens')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = { listar, buscarPorId, criar, atualizar, excluir, atualizarStatus }
