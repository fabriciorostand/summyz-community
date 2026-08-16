# Summyz

Summyz é um bot para Discord que grava calls sob comando, transcreve o áudio de cada participante e
publica resumos com decisões e tarefas.

Esta primeira etapa implementa a gravação segmentada por participante. Transcrição, resumo e
retenção automática do áudio serão adicionados nas próximas etapas.

## Requisitos

- Node.js 22.12 ou superior;
- npm;
- uma aplicação de bot criada no Discord Developer Portal;
- FFmpeg não precisa ser instalado separadamente: o projeto usa um binário empacotado.

## Configuração local

1. Instale as dependências com `npm install`.
2. Copie `.env.example` para `.env`.
3. Preencha `DISCORD_TOKEN` e `DISCORD_CLIENT_ID`.
4. Para desenvolvimento, preencha `DISCORD_GUILD_ID` com o ID do servidor de teste. Sem essa
   variável, os comandos são registrados globalmente e podem demorar para aparecer.
5. Execute `npm run dev`.

Nunca versione o arquivo `.env` nem publique o token do bot.

## Permissões do bot

Ao gerar o convite, use os escopos `bot` e `applications.commands`. Conceda ao bot estas permissões:

- Ver canais;
- Conectar;
- Enviar mensagens;
- Usar comandos de aplicativo.

Depois de adicionar o bot, use `/recording-role add` para autorizar os cargos desejados. Consulte
[BOT_COMMANDS.md](./BOT_COMMANDS.md) para ver todos os comandos e regras de acesso.

## Configurações de gravação

- `DATA_DIR`: diretório dos arquivos; padrão `./data`;
- `SEGMENT_SILENCE_MS`: silêncio que encerra um segmento; padrão `1000` ms;
- `SEGMENT_MAX_SECONDS`: duração máxima de cada segmento contínuo; padrão `60` s;
- `VOICE_RECONNECT_MAX_MS`: tempo máximo de reconexão; padrão `300000` ms;
- `LOG_LEVEL`: nível dos logs estruturados; padrão `info`.

Os arquivos são salvos em
`data/recordings/<meetingId>/participants/<userId>/<segmentId>.ogg`. O `manifest.json` da reunião
registra participantes, segmentos, interrupções e métricas de recepção.

## Qualidade

Use `npm run check` antes de enviar mudanças. Esse comando valida formatação, lint, tipos, testes e
cobertura. Use `npm run security:audit` para verificar as dependências.

O decodificador Opus do MVP é `opusscript`, evitando a cadeia vulnerável encontrada na dependência
nativa avaliada. O procedimento para validar desempenho com até cinco participantes está em
[SMOKE_TEST.md](./SMOKE_TEST.md).
