// ── utils/placa.js ──────────────────────────────────────────────────────────
// A regra da placa mora AQUI, num lugar só.
//
// Existem dois formatos no Brasil, e só dois:
//   Mercosul  ABC1D23  — 3 letras, número, letra, 2 números
//   Antigo    ABC1234  — 3 letras e 4 números
// Motos e reboques usam os mesmos.
//
// POR QUE ISTO EXISTE: o campo aceitava qualquer texto, e o cadastro acabou com
// "OS260107" (um número de ordem de serviço) e "QN0ZH31" (dígito e letra
// trocados de lugar) virando VEÍCULOS. Cada um é um carro fantasma que ninguém
// percebe até conferir na mão.
//
// ⚠️ NÃO DUPLICAR esta regra em outro arquivo. Ela é conferida em vários
// caminhos que criam veículo (cadastro, manutenção, ordem de compra, importação
// de planilha) e duas cópias divergem em silêncio — a porta fechada num lugar
// continua aberta no outro, que foi exatamente o problema original.

const PLACA_MERCOSUL = /^[A-Z]{3}\d[A-Z]\d{2}$/
const PLACA_ANTIGA   = /^[A-Z]{3}\d{4}$/

// "abc-1d23" / " abc 1d23 " → "ABC1D23"
const normPlaca = p => String(p == null ? '' : p).toUpperCase().replace(/[^A-Z0-9]/g, '')

const placaValida = p => {
  const n = normPlaca(p)
  return PLACA_MERCOSUL.test(n) || PLACA_ANTIGA.test(n)
}

const ERRO_PLACA = 'Placa fora do padrão. Use ABC1D23 (Mercosul) ou ABC1234 (antigo).'

// Mensagem com a placa recusada dentro — em importação de planilha, dizer só
// "placa inválida" obriga a pessoa a caçar a linha errada no arquivo.
const erroPlacaCom = p => `Placa "${String(p || '').trim()}" fora do padrão (use ABC1D23 ou ABC1234).`

module.exports = { normPlaca, placaValida, ERRO_PLACA, erroPlacaCom, PLACA_MERCOSUL, PLACA_ANTIGA }
