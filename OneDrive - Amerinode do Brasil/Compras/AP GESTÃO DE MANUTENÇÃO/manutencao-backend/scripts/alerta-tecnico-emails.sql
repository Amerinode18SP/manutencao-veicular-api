-- ─────────────────────────────────────────────────────────────────────────────
-- Lista separada para os avisos TÉCNICOS da integração (sessão TicketLog caiu).
-- Rodar no Supabase → SQL Editor (idempotente). Projeto: pjasyczbgghatkbgnovs
--
-- Por quê: o aviso "Atualização automática de KM parou" reusava
-- alerta_revisao_emails, então ia para o time inteiro do alerta de revisão.
-- Agora tem lista própria, editada na tela. Vazia = ninguém recebe.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE config_sistema
  ADD COLUMN IF NOT EXISTS alerta_tecnico_emails TEXT[] DEFAULT '{}';

-- Opcional: já deixar o e-mail de quem cuida da integração cadastrado.
-- UPDATE config_sistema SET alerta_tecnico_emails = ARRAY['luciana.santos@amerinode.com.br'] WHERE id = 1;

-- PostgREST não enxerga colunas novas na hora:
NOTIFY pgrst, 'reload schema';
