// ── services/relatorioSituacao.js ───────────────────────────────────────────
// Monta o Excel e o PDF da "Situação Atual da Frota".
//
// ⚠️ ESTE É O ÚNICO LUGAR QUE MONTA ESSE RELATÓRIO. O botão de baixar na tela, o
// envio manual por e-mail e o envio agendado passam todos por aqui. Antes o
// arquivo nascia no navegador, e o envio agendado — que roda sem tela — teria de
// montar outra versão: no dia em que uma mudasse, a outra seguiria com o formato
// velho e ninguém perceberia qual estava certa. (Decisão da Luciana, 28/09/2026.)

const XLSX = require('xlsx')
const { jsPDF } = require('jspdf')
require('jspdf-autotable')

const dataBR = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : ''
const nomeArquivo = ext => `situacao_atual_frota_${new Date().toISOString().slice(0, 10)}.${ext}`

// Serviços vindos das ordens de compra — é onde a descrição do que foi feito
// realmente está (ver lerCadastroEServicos no controller).
const servicosTexto = m => (m.ultimos_servicos || [])
  .map(s => `${s.item}${s.data ? ` (${dataBR(s.data)})` : ''}`).join('; ')

const rotuloStatus = s => (s === 'Em Andamento' ? 'Manutenção em andamento' : (s || '-'))
const rotuloAlugado = m => m.veiculo_alugado ? (m.veiculo_devolvido ? 'Devolvido' : 'Sim') : 'Não'

// ── EXCEL ───────────────────────────────────────────────────────────────────
function montarExcel(d) {
  const r = d.resumo || {}
  const stamp = new Date().toLocaleString('pt-BR')
  const wb = XLSX.utils.book_new()

  const wsRes = XLSX.utils.aoa_to_sheet([
    ['SITUAÇÃO ATUAL DA FROTA — manutenções em aberto'], [`Gerado em: ${stamp}`], [''],
    ['Indicador', 'Valor'],
    ['Frota ativa', r.frota_ativa != null ? r.frota_ativa : '—'],
    ['% da frota parada', r.percentual_parado != null ? r.percentual_parado + '%' : '—'],
    ['Sinistros pendentes', r.sinistros || 0],
    ['Manutenção em aberto', r.total || 0], ['Em atraso', r.atrasados || 0],
    ['Sem previsão', r.sem_previsao || 0],
    ['Em processo de seguro', r.em_seguro || 0],
    ['Alugados ativos', r.alugados_ativos || 0],
    ['   destes, cobrindo perda total', r.alugados_em_perda_total || 0],
    ['   sem locadora informada', r.alugados_sem_locadora || 0],
    ['   com devolução vencida', r.devolucoes_atrasadas || 0],
    ['Parados há mais de 30 dias', r.parados_mais_30 || 0],
    ['Média de dias parados', r.media_dias || 0], [''],
    ['Saíram da frota', 'Qtd'],
    ['Perda total', r.perda_total || 0], ['Vendidos', r.vendidos || 0], ['Devolvidos', r.devolvidos || 0], [''],
    ['Por etapa', 'Qtd'],
    ...Object.entries(r.por_status || {}).map(([s, q]) => [rotuloStatus(s), q]),
  ])
  wsRes['!cols'] = [{ wch: 32 }, { wch: 14 }]
  XLSX.utils.book_append_sheet(wb, wsRes, 'Resumo')

  const head = [['Placa', 'Modelo', 'Alugado', 'Locadora', 'Prev. devolução', 'Localidade', 'Supervisor',
    'Entrada', 'Dias parado', 'Previsão', 'Atraso (dias)', 'Tipo', 'Em seguro', 'Status', 'Oficina',
    'Nº OS', 'Últ. manutenção', 'Serviço realizado', 'Últimos Serviços (ordens)']]
  const rows = (d.itens || []).map(m => [
    m.placa, m.modelo || '', rotuloAlugado(m), m.locadora || '', m.previsao_devolucao || '',
    m.localidade || '', m.supervisor || '',
    m.data_entrada || '', m.dias_parado,
    m.previsao_retorno || 'SEM PREVISÃO',
    m.sem_previsao ? '' : (m.dias_atraso || 0),
    m.tipo_manutencao || '', m.em_seguro ? 'Sim' : 'Não', rotuloStatus(m.status), m.oficina || '', m.num_os || '',
    (m.ultima_manutencao && m.ultima_manutencao.data_saida) || '',
    (m.ultima_manutencao && m.ultima_manutencao.servico) || '',
    servicosTexto(m),
  ])
  const ws = XLSX.utils.aoa_to_sheet([...head, ...rows])
  ws['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 11 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 13 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 18 },
    { wch: 14 }, { wch: 14 }, { wch: 40 }, { wch: 52 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Manutenção em aberto')

  // Abas próprias: alugado e baixa são coisas diferentes, e empilhar numa só
  // obrigaria quem abre o arquivo a separar de novo na mão.
  const alug = d.alugados || []
  if (alug.length) {
    const h2 = [['Locadora', 'Substituindo', 'Modelo', 'Localidade', 'Situação do veículo', 'Devolver até', 'Devolução vencida']]
    const r2 = alug.map(a => [
      a.locadora || 'NÃO INFORMADA', a.placa_parada || '', a.modelo || '', a.localidade || '',
      rotuloStatus(a.status), a.previsao_devolucao || 'SEM PREVISÃO', a.devolucao_atrasada ? 'Sim' : 'Não',
    ])
    const ws2 = XLSX.utils.aoa_to_sheet([...h2, ...r2])
    ws2['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Alugados')
  }
  const bx = d.baixas || []
  if (bx.length) {
    const h3 = [['Placa', 'Modelo', 'Localidade', 'Motivo', 'Data da baixa', 'Em substituição por']]
    const r3 = bx.map(b => [
      b.placa || '', b.modelo || '', b.localidade || '', b.motivo || '', b.data_baixa || '',
      b.substituido_por ? `${b.substituido_por.placa || ''}${b.substituido_por.modelo ? ' — ' + b.substituido_por.modelo : ''}` : 'NÃO INFORMADO',
    ])
    const ws3 = XLSX.utils.aoa_to_sheet([...h3, ...r3])
    ws3['!cols'] = [{ wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 26 }]
    XLSX.utils.book_append_sheet(wb, ws3, 'Saíram da frota')
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
}

// ── PDF ─────────────────────────────────────────────────────────────────────
// Sem acento nos textos fixos: a fonte padrão do jsPDF (Helvetica) não tem
// acentuação completa e troca as letras por caracteres errados no papel.
function montarPDF(d) {
  const r = d.resumo || {}
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 12
  const stamp = new Date().toLocaleString('pt-BR')

  doc.setFillColor(30, 58, 95); doc.rect(0, 0, W, 18, 'F')
  doc.setTextColor(255, 255, 255); doc.setFontSize(12); doc.setFont(undefined, 'bold')
  doc.text('Situacao Atual da Frota - manutencoes em aberto', M, 12)
  doc.setFontSize(8); doc.setFont(undefined, 'normal')
  doc.text(`Gerado em: ${stamp}`, W - M, 12, { align: 'right' })
  doc.setTextColor(0, 0, 0)

  let y = 26
  const kpis = [
    { label: 'Frota ativa', val: r.frota_ativa != null ? r.frota_ativa : '-', cor: [230, 241, 251] },
    { label: 'Sinistros', val: r.sinistros || 0, cor: [252, 235, 235] },
    { label: 'Manut. em aberto', val: r.total || 0, cor: [230, 241, 251] },
    { label: 'Em atraso', val: r.atrasados || 0, cor: [252, 235, 235] },
    { label: 'Sem previsao', val: r.sem_previsao || 0, cor: [250, 238, 218] },
    { label: 'Em seguro', val: r.em_seguro || 0, cor: [230, 241, 251] },
    { label: 'Alugados', val: r.alugados_ativos || 0, cor: [230, 241, 251] },
    { label: 'Perda total', val: r.perda_total || 0, cor: [252, 235, 235] },
    { label: 'Media dias', val: (r.media_dias || 0) + ' d', cor: [234, 243, 222] },
  ]
  const cW = (W - M * 2) / kpis.length - 2
  kpis.forEach((k, i) => {
    const x = M + i * (cW + 2)
    doc.setFillColor(...k.cor); doc.roundedRect(x, y, cW, 14, 2, 2, 'F')
    doc.setFontSize(6); doc.setTextColor(80, 80, 80)
    doc.text(k.label, x + cW / 2, y + 5, { align: 'center' })
    doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.setTextColor(30, 58, 95)
    doc.text(String(k.val), x + cW / 2, y + 11, { align: 'center' })
    doc.setFont(undefined, 'normal')
  })
  y += 20

  const itens = d.itens || []
  doc.autoTable({
    startY: y, margin: { left: M, right: M },
    head: [['Placa', 'Modelo', 'Localidade', 'Supervisor', 'Entrada', 'Dias', 'Previsao', 'Atraso',
      'Tipo', 'Status', 'Oficina', 'Ultimos Servicos (ordens)']],
    body: itens.map(m => [
      m.placa || '', m.modelo || '', m.localidade || '', m.supervisor || '',
      dataBR(m.data_entrada), String(m.dias_parado),
      m.sem_previsao ? 'sem previsao' : dataBR(m.previsao_retorno),
      m.sem_previsao ? '-' : (m.dias_atraso > 0 ? String(m.dias_atraso) : 'no prazo'),
      (m.tipo_manutencao || '') + (m.em_seguro ? ' / seguro' : ''),
      rotuloStatus(m.status), m.oficina || '',
      servicosTexto(m) || (m.ultima_manutencao && m.ultima_manutencao.servico) || 'nao descrito',
    ]),
    headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 8 },
    bodyStyles: { fontSize: 7 }, alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: { 11: { cellWidth: 62 } },
    didParseCell: (c) => {
      if (c.section === 'body' && itens[c.row.index] && itens[c.row.index].atrasado) {
        c.cell.styles.fillColor = [253, 243, 243]
      }
    },
  })
  y = doc.lastAutoTable.finalY + 8

  const alug = d.alugados || []
  if (alug.length) {
    if (y > H - 40) { doc.addPage(); y = 20 }
    doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(30, 58, 95)
    doc.text('Carros alugados em uso', M, y); doc.setFont(undefined, 'normal'); doc.setTextColor(0, 0, 0)
    y += 4
    doc.autoTable({
      startY: y, margin: { left: M, right: M },
      head: [['Locadora', 'Substituindo', 'Modelo', 'Localidade', 'Situacao do veiculo', 'Devolver ate']],
      body: alug.map(a => [
        a.locadora || 'NAO INFORMADA', a.placa_parada || '', a.modelo || '', a.localidade || '',
        a.perda_total ? 'PERDA TOTAL' : rotuloStatus(a.status),
        a.previsao_devolucao ? (dataBR(a.previsao_devolucao) + (a.devolucao_atrasada ? ' (vencida)' : '')) : 'sem previsao',
      ]),
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8 }, alternateRowStyles: { fillColor: [245, 247, 250] },
      didParseCell: (c) => {
        if (c.section === 'body' && alug[c.row.index] && alug[c.row.index].perda_total) {
          c.cell.styles.fillColor = [253, 243, 243]
        }
      },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  const bx = d.baixas || []
  if (bx.length) {
    if (y > H - 40) { doc.addPage(); y = 20 }
    doc.setFontSize(10); doc.setFont(undefined, 'bold'); doc.setTextColor(30, 58, 95)
    doc.text('Sairam da frota', M, y); doc.setFont(undefined, 'normal'); doc.setTextColor(0, 0, 0)
    y += 4
    doc.autoTable({
      startY: y, margin: { left: M, right: M },
      head: [['Placa', 'Modelo', 'Localidade', 'Motivo', 'Data da baixa', 'Em substituicao por']],
      body: bx.map(b => [
        b.placa || '', b.modelo || '', b.localidade || '', b.motivo || '',
        b.data_baixa ? dataBR(b.data_baixa) : 'sem data',
        b.substituido_por ? `${b.substituido_por.placa || ''}${b.substituido_por.modelo ? ' - ' + b.substituido_por.modelo : ''}` : 'nao informado',
      ]),
      headStyles: { fillColor: [30, 58, 95], textColor: 255, fontSize: 8 },
      bodyStyles: { fontSize: 8 }, alternateRowStyles: { fillColor: [245, 247, 250] },
    })
  }
  return Buffer.from(doc.output('arraybuffer'))
}

module.exports = { montarExcel, montarPDF, nomeArquivo }
