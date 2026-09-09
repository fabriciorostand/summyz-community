# Contrato do backend para o novo dashboard Community

Este documento registra o contrato que substitui autenticação por e-mail e senha pelo vínculo de
uma única conta Discord. O frontend atual ainda não implementa esse contrato.

## Primeiro acesso

O launcher gera `SUMMYZ_SETUP_TOKEN` automaticamente e abre uma URL no formato
`/setup#claim=<valor>`. O valor fica no fragmento do navegador, portanto não é enviado em requisições
HTTP nem aparece nos logs do proxy. O frontend deve ler o fragmento, mantê-lo apenas em memória e
removê-lo da barra de endereço com `history.replaceState`.

1. `GET /api/setup/status` retorna:

   ```json
   {
     "setupCompleted": false,
     "technicalSetupCompleted": false
   }
   ```

2. `POST /api/setup`, com o header `x-summyz-setup-token`, recebe somente:

   ```json
   {
     "installation": {
       "discordClientId": "...",
       "secrets": {
         "discordBotToken": "...",
         "discordClientSecret": "..."
       }
     }
   }
   ```

   A resposta de sucesso é `204`. `PUBLIC_BASE_URL` pertence exclusivamente ao `.env` e não deve
   aparecer no formulário.

3. `GET /api/setup/discord`, com o mesmo header, retorna `{ "authorizationUrl": "..." }`. O
   frontend deve redirecionar o navegador para essa URL.
4. O callback OAuth cria a sessão e conclui o setup. O bot se conecta ao Discord imediatamente, mas
   `/record` continua bloqueado até existir um perfil de IA válido e ativo para o servidor.

## Sessão e proprietário

- `GET /api/auth/discord` inicia o login Discord depois do setup.
- `GET /api/discord/callback?code=...&state=...` grava o cookie HttpOnly `summyz_session` e
  redireciona para `/setup?discord=connected`.
- `GET /api/auth/me` retorna `userId`, `discordUsername`, `discordAvatar`, `dashboardLanguage` e
  `dashboardTheme`.
- `POST /api/auth/logout` revoga a sessão e remove o cookie; resposta `204`.
- A sessão é opaca, armazenada no servidor somente pelo hash, dura 30 dias e renova sua validade
  quando uma requisição autenticada é concluída.
- Não existem endpoints de cadastro, login por senha, verificação de e-mail, recuperação, troca de
  senha ou refresh token.

Só pode existir uma conta Discord conectada. `GET /api/discord/connect` exige sessão válida e
retorna a URL OAuth para substituí-la. A troca revoga imediatamente todas as sessões da conta
anterior. Perfis de IA continuam associados ao ID Discord que os criou: outra conta começa sem
perfis, e os perfis anteriores reaparecem quando sua conta for reconectada.

Se o proprietário perder acesso, o operador do host executa `recover-owner` no launcher e abre a
URL OAuth de uso único apresentada no terminal.

## Página Configurações

- `PUT /api/account/preferences` recebe `dashboardLanguage` (`en` ou `pt-BR`) e `dashboardTheme`
  (`system`, `light` ou `dark`). Esses valores são globais da instalação, embora a rota permaneça
  autenticada.
- `GET /api/discord/connection` retorna o estado da conexão Discord atual.
- `GET /api/installation/settings` retorna configurações e booleanos indicando quais segredos estão
  configurados; nunca retorna seus valores.
- `PUT /api/installation/settings` altera apenas `discordClientId`.
- `PUT /api/installation/secrets/:secretName` recebe `{ "value": "..." }`.
- `DELETE /api/installation/secrets/:secretName` remove o segredo.
- Os nomes aceitos são `discord_bot_token`, `discord_client_secret` e `openrouter_api_key`.

## Erros relevantes

- `401 { "error": "session_expired" }`: sessão ausente, revogada ou vencida;
- `403 { "error": "invalid_setup_token" }`: credencial privada de setup inválida;
- `403 { "error": "guild_access_denied" }`: conta não é proprietária do servidor instalado;
- `409 { "error": "setup_required" }`: tentativa de login antes do setup;
- `409 { "error": "setup_already_completed" }`: tentativa de repetir o bootstrap;
- `400`: payload ou query inválidos;
- `500 { "error": "internal_error" }`: falha interna sem exposição de detalhes.

Todas as requisições autenticadas do frontend devem usar credenciais do mesmo origin. O modo
público exige `PUBLIC_BASE_URL=https://dominio` no `.env` e utiliza cookies `Secure` por trás do
Caddy/TLS opcional.
