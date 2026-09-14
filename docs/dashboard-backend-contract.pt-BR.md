# Contrato do backend para o novo dashboard Community

O Community não possui conta de usuário Summyz, cadastro, e-mail SMTP nem OAuth de usuário
Discord. O frontend em `web/` implementa este contrato.

## Modos de acesso

- `local`: padrão; o dashboard escuta apenas em loopback e não exige autenticação.
- `public`: ativado pelo overlay `docker-compose.public.yaml`; exige HTTPS e uma senha única da
  instalação.

`GET /api/access/status` retorna `accessMode`, `authenticated`, `passwordConfigured` e
`setupCompleted`. No modo local, `authenticated` é sempre `true`.

## Primeiro acesso

O launcher gera `SUMMYZ_SETUP_TOKEN` e abre `/setup#claim=<valor>`. O frontend deve manter esse
valor somente em memória e remover o fragmento com `history.replaceState`.

`GET /api/setup/status` retorna:

```json
{
  "accessMode": "public",
  "passwordConfigured": false,
  "setupCompleted": false,
  "technicalSetupCompleted": false
}
```

`POST /api/setup` recebe:

```json
{
  "discordBotToken": "...",
  "installationPassword": "frase escolhida pelo operador"
}
```

No modo público, envie o claim no header `x-summyz-setup-token` e a senha é obrigatória. No modo
local, ambos são dispensados. O backend valida o token pela API do Discord, obtém o Application ID,
criptografa o token e conclui o setup. O token, seu hash e a senha nunca são retornados. O setup
cria um perfil global externo e um local, ambos com modelos vazios. O bot se conecta após o setup,
mas `/record` continua bloqueado até existir um perfil de IA completo e ativo.

## Senha e sessão pública

- `POST /api/access/login`: recebe `{ "password": "..." }` e cria `summyz_session`.
- `POST /api/access/logout`: revoga a sessão e remove o cookie.
- `PUT /api/access/password`: exige sessão e recebe `currentPassword` e `newPassword`.
- `POST /api/access/recovery`: recebe `newPassword` e o token no header
  `x-summyz-recovery-token`.

A senha tem de 15 a 128 caracteres Unicode, é normalizada em NFC, comparada com uma lista de
senhas comuns e armazenada somente com hash Argon2id. Não há regras artificiais de maiúsculas,
números ou símbolos. O login sofre atraso progressivo após falhas repetidas.

O cookie é opaco, `HttpOnly`, `Secure`, `SameSite=Strict`, tem inatividade máxima de sete dias e
validade absoluta de trinta dias. Troca ou recuperação de senha revoga as sessões anteriores. No
modo público, mutações também exigem que o header `Origin` corresponda exatamente a
`PUBLIC_BASE_URL`.

Para recuperação, o operador executa `recover-access` no host. A URL emitida é de uso único e
expira em dez minutos. A senha anterior só deixa de valer quando a substituição termina com
sucesso. Sem acesso ao host, não há recuperação por e-mail ou Discord.

## Configurações

- `GET /api/settings`: retorna modo de acesso, preferências globais, Application ID e booleanos de
  segredos configurados.
- `PUT /api/settings/preferences`: recebe `dashboardLanguage` (`en` ou `pt-BR`) e
  `dashboardTheme` (`system`, `light` ou `dark`).
- `GET /api/installation/health`: retorna a saúde dos componentes.
- `PUT` e `DELETE /api/installation/secrets/openrouter_api_key`: configuram ou removem OpenRouter.
- `GET /api/installation/bot`: retorna o Application ID e uma URL genérica para instalar o bot.
- `PUT /api/installation/bot`: valida e substitui o token do bot e seu Application ID; o processo
  do bot deve ser reiniciado depois da rotação.

O token do bot usa essa rota dedicada para impedir divergência do Application ID. Não existe client
secret OAuth.

## Servidores e perfis

`GET /api/guilds` retorna apenas servidores nos quais o bot configurado está instalado. Todas as
rotas `/api/guilds/:guildId/*` recusam IDs ausentes dessa lista. Quando o bot sai, os dados do
servidor permanecem no PostgreSQL, mas deixam de ser visíveis; ao reinstalar o mesmo bot, reaparecem.

Perfis de IA são globais da instalação. `GET`, `POST`, `PUT` e `DELETE /api/profiles` não usam ID de
usuário. A ativação continua por servidor em
`PUT /api/guilds/:guildId/profiles/:profileId/active`. Tarefas concluídas pelo dashboard persistem
`completed_by_user_id = null`, pois não há identidade Discord no dashboard.

## Erros relevantes

- `400 invalid_request`, `installation_password_required` ou `invalid_discord_bot_token`;
- `401 session_expired` ou `invalid_password`;
- `403 invalid_setup_token`, `invalid_recovery_token`, `invalid_origin` ou
  `guild_access_denied`;
- `409 setup_already_completed`;
- `429 login_rate_limited`, com `Retry-After`;
- `500 internal_error`, sem detalhes internos ou segredos.
