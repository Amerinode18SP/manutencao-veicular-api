-- ─────────────────────────────────────────────────────────────────────────────
-- Parte C — sessão do TicketLog pela Conta Edenred (SSO), sem captcha.
-- Guarda o REFRESH TOKEN do SSO, que vale ~90 dias e substitui a reconexão
-- manual por cURL.
-- Rodar manualmente no Supabase → SQL Editor (idempotente). Projeto: pjasyczbgghatkbgnovs
-- ─────────────────────────────────────────────────────────────────────────────

-- ⚠️ POR QUE O TOKEN FICA NO BANCO, E NÃO SÓ NA VARIÁVEL DO RAILWAY:
--    o SSO da Edenred ROTACIONA o refresh token a cada renovação — devolve um
--    novo e MATA o anterior na mesma hora. Guardado apenas na env, o valor de lá
--    ficaria velho já na primeira renovação e a automação pararia cerca de 1 hora
--    depois, SEM ERRO NENHUM na tela: a sessão simplesmente cairia e não
--    levantaria mais. A env TICKETLOG_SSO_REFRESH é só a SEMENTE (vale enquanto
--    esta coluna estiver vazia); da primeira gravação em diante, quem manda é o
--    banco. Ver getRefreshSSO()/salvarRefreshSSO() em src/controllers/importarKm.js.

-- config_sistema já existe desde o km-sync.sql; o bloco abaixo é só rede de
-- segurança para o caso de este script rodar antes daquele.
CREATE TABLE IF NOT EXISTS config_sistema (
  id INTEGER PRIMARY KEY DEFAULT 1,
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT config_sistema_single_row CHECK (id = 1)
);
INSERT INTO config_sistema (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- O segredo de ~90 dias. NUNCA é devolvido pelo GET /api/config nem pelo
-- GET /api/km/sessao/status (que informa apenas se está preenchido).
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS ticketlog_sso_refresh TEXT;

-- ── Aviso de renovação dos ~90 dias (26/08/2026) ────────────────────────────
-- Quando o ciclo atual COMEÇOU. Só muda quando uma PESSOA cola um codigo novo no
-- Railway (a semente do ambiente) — NUNCA nas renovações automáticas. Se ela
-- fosse atualizada a cada rotação, que acontece o dia todo, o aviso de validade
-- nunca chegaria a disparar e o acesso venceria de surpresa.
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS ticketlog_sso_conectado_em TIMESTAMPTZ;
-- Último e-mail de "renove o acesso" — segura a repetição em 1x por semana.
ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS ticketlog_sso_aviso_em     TIMESTAMPTZ;

-- Conferência (deve listar as três colunas):
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'config_sistema' AND column_name LIKE 'ticketlog_sso%';
