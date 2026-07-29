// services/email.js — envio de e-mail por API HTTP.
//
// De propósito SEM dependência nova (nada de nodemailer): adicionar pacote
// quebra o `npm ci` no Railway quando o package-lock não é regerado localmente
// (ver CLAUDE.md → auto-migration). Node 18+ tem `fetch` nativo, então cada
// provedor é só um POST.
//
// Configuração (env do Railway) — basta UMA das chaves:
//   RESEND_API_KEY    → https://resend.com        (grátis: 3.000 e-mails/mês)
//   BREVO_API_KEY     → https://brevo.com         (grátis: 300 e-mails/dia)
//   SENDGRID_API_KEY  → https://sendgrid.com
//   EMAIL_FROM        → remetente verificado, ex: "Manutenção Amerinode <alertas@amerinode.com.br>"
//   EMAIL_PROVIDER    → opcional, força o provedor (resend|brevo|sendgrid)

const PROVEDORES = ['resend', 'brevo', 'sendgrid']

function chaveDo(provedor) {
  return {
    resend:   process.env.RESEND_API_KEY,
    brevo:    process.env.BREVO_API_KEY,
    sendgrid: process.env.SENDGRID_API_KEY
  }[provedor]
}

// Provedor explícito por env, ou o primeiro que tiver chave configurada.
function provedorAtivo() {
  const forcado = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase()
  if (forcado) return PROVEDORES.includes(forcado) ? forcado : null
  return PROVEDORES.find(p => chaveDo(p)) || null
}

// "Nome <a@b.com>" → { nome, email }; "a@b.com" → { nome: '', email }
function partesRemetente(valor) {
  const v = String(valor || '').trim()
  const m = v.match(/^(.*?)\s*<([^>]+)>$/)
  if (m) return { nome: m[1].trim().replace(/^["']|["']$/g, ''), email: m[2].trim() }
  return { nome: '', email: v }
}

// { configurado, provedor, remetente, motivo } — usado pela tela pra avisar o
// admin ANTES de ele ligar o alerta e achar que está funcionando.
function statusEmail() {
  const provedor  = provedorAtivo()
  const remetente = String(process.env.EMAIL_FROM || '').trim()
  if (!provedor)  return { configurado: false, provedor: null, remetente, motivo: 'Nenhuma chave de API de e-mail configurada (RESEND_API_KEY, BREVO_API_KEY ou SENDGRID_API_KEY).' }
  if (!chaveDo(provedor)) return { configurado: false, provedor, remetente, motivo: `EMAIL_PROVIDER=${provedor} mas a chave de API dele não está definida.` }
  if (!remetente || !remetente.includes('@')) return { configurado: false, provedor, remetente, motivo: 'EMAIL_FROM não definido (precisa ser um remetente verificado no provedor).' }
  return { configurado: true, provedor, remetente, motivo: '' }
}

function erroConfig(motivo) {
  const e = new Error(motivo)
  e.code = 'email_nao_configurado'
  e.status = 503
  return e
}

async function postJson(url, headers, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
  const txt = await r.text()
  if (!r.ok) {
    const e = new Error(`Provedor de e-mail respondeu ${r.status}: ${txt.slice(0, 400)}`)
    e.status = r.status
    throw e
  }
  try { return JSON.parse(txt) } catch { return { raw: txt } }
}

// enviarEmail({ para: ['a@b.com'], assunto, html, texto })
// → { provedor, id }   |  lança erro com .code='email_nao_configurado' se faltar env
async function enviarEmail({ para, assunto, html, texto }) {
  const st = statusEmail()
  if (!st.configurado) throw erroConfig(st.motivo)

  const destinos = (Array.isArray(para) ? para : [para]).map(e => String(e || '').trim()).filter(Boolean)
  if (!destinos.length) throw new Error('Nenhum destinatário informado.')

  const from = partesRemetente(st.remetente)
  const chave = chaveDo(st.provedor)

  if (st.provedor === 'resend') {
    const res = await postJson('https://api.resend.com/emails',
      { authorization: `Bearer ${chave}` },
      { from: st.remetente, to: destinos, subject: assunto, html, text: texto })
    return { provedor: 'resend', id: res.id || null }
  }

  if (st.provedor === 'brevo') {
    const res = await postJson('https://api.brevo.com/v3/smtp/email',
      { 'api-key': chave },
      {
        sender: { email: from.email, name: from.nome || undefined },
        to: destinos.map(email => ({ email })),
        subject: assunto,
        htmlContent: html,
        textContent: texto
      })
    return { provedor: 'brevo', id: res.messageId || null }
  }

  // sendgrid — responde 202 com corpo vazio (sem id utilizável)
  await postJson('https://api.sendgrid.com/v3/mail/send',
    { authorization: `Bearer ${chave}` },
    {
      personalizations: [{ to: destinos.map(email => ({ email })) }],
      from: { email: from.email, name: from.nome || undefined },
      subject: assunto,
      content: [
        { type: 'text/plain', value: texto || ' ' },
        { type: 'text/html',  value: html }
      ]
    })
  return { provedor: 'sendgrid', id: null }
}

module.exports = { enviarEmail, statusEmail }
