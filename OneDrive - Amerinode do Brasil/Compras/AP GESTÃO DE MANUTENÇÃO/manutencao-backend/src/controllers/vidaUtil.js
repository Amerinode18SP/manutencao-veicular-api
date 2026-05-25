const supabase = require('../supabase')

// Listar todos os itens (ordenado)
async function listar(req, res) {
  try {
    const { data, error } = await supabase
      .from('vida_util')
      .select('*')
      .order('ordem', { ascending: true })
      .order('item',  { ascending: true })
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// Criar novo item
async function criar(req, res) {
  try {
    const { item, vida_util, tipo, observacao } = req.body
    if (!item || !vida_util || !tipo) {
      return res.status(400).json({ error: 'item, vida_util e tipo são obrigatórios' })
    }
    // Pega a maior "ordem" atual e soma 1
    const { data: max } = await supabase
      .from('vida_util').select('ordem').order('ordem', { ascending: false }).limit(1).maybeSingle()
    const novaOrdem = (max?.ordem ?? -1) + 1
    const { data, error } = await supabase
      .from('vida_util')
      .insert({ item, vida_util, tipo, observacao: observacao || null, ordem: novaOrdem })
      .select().single()
    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// Atualizar item
async function atualizar(req, res) {
  try {
    const { item, vida_util, tipo, observacao, ordem } = req.body
    const update = { updated_at: new Date().toISOString() }
    if (item !== undefined)       update.item       = item
    if (vida_util !== undefined)  update.vida_util  = vida_util
    if (tipo !== undefined)       update.tipo       = tipo
    if (observacao !== undefined) update.observacao = observacao || null
    if (ordem !== undefined)      update.ordem      = ordem
    const { data, error } = await supabase
      .from('vida_util').update(update).eq('id', req.params.id).select().single()
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// Excluir item
async function excluir(req, res) {
  try {
    const { error } = await supabase.from('vida_util').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ message: 'Item excluído com sucesso' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// Substituir tudo (usado pela importação de XLSX)
async function substituirTudo(req, res) {
  try {
    const { itens } = req.body
    if (!Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: 'envie um array "itens" não-vazio' })
    }
    // Apaga tudo (em vez de truncate — assim respeita RLS se houver)
    const { error: delErr } = await supabase.from('vida_util').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (delErr) throw delErr
    // Reinsere com ordem sequencial
    const rows = itens.map((it, i) => ({
      item: String(it.item || '').trim(),
      vida_util: String(it.vida_util || '').trim(),
      tipo: String(it.tipo || 'Preventiva').trim(),
      observacao: it.observacao ? String(it.observacao).trim() : null,
      ordem: i
    })).filter(r => r.item && r.vida_util)
    if (rows.length === 0) return res.status(400).json({ error: 'nenhum item válido (item + vida_util obrigatórios)' })
    const { data, error } = await supabase.from('vida_util').insert(rows).select()
    if (error) throw error
    res.json({ message: 'Tabela substituída', total: data.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = { listar, criar, atualizar, excluir, substituirTudo }
