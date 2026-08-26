# Como conectar o KM automático pela Conta Edenred (vale ~90 dias)

Este é o jeito **definitivo** de manter a atualização automática de quilometragem
funcionando. Você faz isto **uma vez a cada ~90 dias** — e nada mais.

> Antes existia só um jeito: colar o cURL toda vez que a sessão caía (às vezes
> toda semana). Esse jeito continua funcionando e está em
> `COMO-RECONECTAR-TICKETLOG.md`, mas agora é o plano B.

## Por que isto funciona (em duas frases)

O portal antigo, onde mora o relatório de km, aceita ser aberto pela sua Conta
Edenred. Quando você entra no navegador, a Edenred entrega um **código de
renovação** que vale ~90 dias — e é ele que o sistema guarda para se reconectar
sozinho, sem captcha, sem código no celular e sem ler e-mail.

## ⚠️ Antes de começar: esse código é uma chave

O código que você vai copiar **abre o portal como se fosse você**. Trate-o como
senha:

- **não** cole em conversa, e-mail, WhatsApp ou chat com o Claude;
- cole **direto** no campo do Railway e feche a janela;
- se achar que ele vazou, entre no portal e saia de todas as sessões (ou troque
  a senha da Conta Edenred) — isso derruba o código antigo.

## Passo a passo

### 1. Entre no portal, normalmente

No Chrome, acesse **https://plataforma.ticketlog.com.br** e faça login com a sua
Conta Edenred, como você já faz. Resolva o "não sou um robô" e o código do celular
se aparecerem — **é esta a única vez** que alguém precisa fazer isso.

### 2. Abra o painel de desenvolvedor

Com o portal aberto, aperte **F12**.

### 3. Vá em Application

No painel que abriu, clique na aba **Application** (em português, **Aplicativo**).
Se não estiver visível, clique nas setinhas **»** para achar.

### 4. Ache o armazenamento do site

Na coluna da esquerda, procure **Local Storage** (Armazenamento local) e clique na
linha **https://plataforma.ticketlog.com.br** que aparece embaixo dele.

Vai surgir uma tabela com duas colunas: **Key** (chave) e **Value** (valor).

### 5. Procure a linha do login

Olhe na coluna **Key** por uma linha que comece com **`oidc.user:`** — o nome
completo é comprido e tem o endereço do `sso.sa.edenred.io` no meio.

> Não achou? Repita o passo 4 clicando em **Session Storage** (Armazenamento de
> sessão) em vez de Local Storage. Fica no mesmo lugar, logo abaixo.

### 6. Copie o código de renovação

Clique nessa linha. No quadro de baixo aparece um texto grande, cheio de
`"campo": "valor"`. Procure dentro dele:

```
"refresh_token":"XXXXXXXXXXXXXXXX"
```

Copie **só o que está entre as aspas depois de `refresh_token`** — sem as aspas,
sem o nome do campo. É um texto longo, de letras e números.

### 7. Guarde no Railway

1. Entre no **Railway** → projeto **manutencao-veicular-api** → aba **Variables**.
2. Crie (ou edite) a variável **`TICKETLOG_SSO_REFRESH`**.
3. Cole o código copiado e salve.

O Railway republica sozinho. Espere ~2 minutos.

### 8. Teste

No PowerShell (repare no **`.exe`** — sem ele o Windows chama outro programa):

```
curl.exe -s -X POST https://manutencao-veicular-api-production.up.railway.app/api/km/sso
```

- **`{"ok":true,"conectado":true}`** → pronto. O KM volta a atualizar sozinho, e
  o sistema se reconecta sem ninguém por perto pelos próximos ~90 dias.
- **`"refresh_expirado":true`** → o código copiado já não vale. Refaça do passo 1.
- **`"ponte_nao_firmou"`** → o código foi aceito pela Edenred, mas o portal antigo
  não abriu a sessão. Chame o suporte técnico com essa mensagem.

## Quando refazer

O sistema avisa por e-mail quando a sessão cai e ele não consegue levantar
sozinha (lista editada em **🔔 Alertas por e-mail → 🛠️ Avisos técnicos da
integração**). Recebeu esse aviso? Refaça este guia do começo — leva 3 minutos.

Para conferir a qualquer momento, sem risco nenhum:

```
curl.exe -s https://manutencao-veicular-api-production.up.railway.app/api/km/sessao/status
```

Se vier `"sso_configurado":true` e `"ultimo_status":"ok"`, está tudo em ordem.

## Uma coisa que precisa ser rodada UMA vez

Antes do primeiro uso, alguém precisa rodar **`scripts/km-sso.sql`** no Supabase
(SQL Editor → colar → Run). Ele cria a coluna onde o código de renovação fica
guardado.

**Por que isso importa:** a Edenred **troca** o código de renovação a cada uso — o
antigo morre na hora. Sem essa coluna, o sistema não teria onde guardar o código
novo, e a automação pararia sozinha cerca de uma hora depois da primeira
renovação, **sem erro nenhum na tela**.
