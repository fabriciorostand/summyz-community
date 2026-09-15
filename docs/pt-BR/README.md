<p align="center">
  <img src="../../assets/banner.png" width="820" alt="Summyz — bot de gravação e transcrição para Discord" />
</p>

<p align="center">
  <a href="../../README.md">English</a> |
  <a href="./README.md">Português</a>
</p>

<p align="center">
  <b>Summyz Community</b> é um bot para Discord que grava calls sob comando, transcreve o áudio de cada participante e publica resumos
  com decisões e tarefas.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/versão-1.0.0-blue" alt="Versão">
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-339933?logo=node.js&logoColor=white" alt="Node >= 22.12" />
  <img src="https://img.shields.io/badge/PRs-welcome-23A559" alt="PRs welcome" />
  <img src="https://img.shields.io/badge/self--hosted-100%25-0A0B0F" alt="Self-hosted" />
  <img src="https://img.shields.io/badge/licen%C3%A7a-source--available-6E40C9" alt="Licença source-available" />
</p>

---

O Summyz grava cada participante separadamente e, depois do encerramento normal da call, transcreve
os segmentos pelo provedor configurado e monta um arquivo único preservando falantes, timestamps e
falas sobrepostas. Uma segunda etapa revisa apenas o texto da transcrição, sem
permitir que o modelo altere IDs, falantes, timestamps ou ordem. Em seguida, gera um resumo
estruturado e publica em um post de fórum do Discord o resumo executivo, os tópicos discutidos, as
decisões, as tarefas e a transcrição completa.

## Requisitos

- Docker com Compose;
- uma aplicação de bot criada no Discord Developer Portal;
- uma conta no OpenRouter com créditos e uma chave de API somente para as fases configuradas com
  `openrouter`;
- drivers e integração Docker compatíveis se a aceleração NVIDIA ou AMD for utilizada.

Node.js 22.23.2, npm 10.9.8 e uma instalação do FFmpeg com `libopus` são necessários somente para
desenvolvimento nativo. PostgreSQL, Ollama, faster-whisper, Python, Node e FFmpeg são preparados
automaticamente no fluxo Docker.

## Configuração local

1. No Linux ou macOS, execute `./summyz-community up`. No Windows, execute
   `.\summyz-community.ps1 up`. No primeiro uso, o launcher cria `.env` com segredos locais
   aleatórios sem imprimir seus valores.
2. O launcher roda
   no host, detecta CPU, NVIDIA ou AMD, escolhe os overlays seguros e chama o Docker Compose.
3. O launcher abre uma URL privada de configuração. Informe somente o token do bot. O Summyz o
   valida no Discord e obtém o Application ID automaticamente. No modo público, escolha também a
   senha única da instalação. OpenRouter e perfis de IA são configurados depois no dashboard.
4. Para desenvolvimento, preencha `DISCORD_GUILD_ID` com o ID do servidor de teste. Sem essa
   variável, os comandos são registrados globalmente e podem demorar para aparecer.

Use `./summyz-community status`, `./summyz-community logs`, `./summyz-community restart` e
`./summyz-community down` para administrar a instalação; no Windows, substitua `./summyz-community` por
`.\summyz-community.ps1`. O Compose direto continua disponível para operadores avançados. O comando
base `docker compose up -d --build` usa CPU. Para NVIDIA, execute
`docker compose -f compose.yaml -f docker/compose.nvidia.yaml up -d --build`; para AMD, substitua o
overlay NVIDIA por `docker/compose.amd.yaml`.

No modo público, a recuperação da senha exige acesso ao host: `recover-access` gera uma URL de uso
único que expira em dez minutos. O modo local não autentica o dashboard. O Community não possui
contas de usuário Summyz, cadastro público, envio de e-mail nem OAuth de usuário Discord.

Para desenvolver nativamente, execute `npm install` e informe um `FFMPEG_PATH` absoluto ou deixe
`ffmpeg`/`ffmpeg.exe` disponível no `PATH`. O bot valida o executável e o encoder `libopus` antes de
conectar ao Discord. PostgreSQL, Ollama e faster-whisper podem continuar no Compose. Para a
interface, use `npm run dev:api` e `npm run dev:web` em terminais separados.

Se a porta local `5432` já estiver ocupada, altere `POSTGRES_PORT` e ajuste a porta de
`DATABASE_URL`. O PostgreSQL é publicado somente em `127.0.0.1`; entre containers, a conexão
continua usando `postgres:5432`.

Para uma instalação pública em VPS, configure uma origem HTTPS em `PUBLIC_BASE_URL` dentro do
`.env`, aponte o domínio para o host e execute `./summyz-community-public up` ou
`.\summyz-community-public.ps1 up`. Esse modo opcional adiciona o Caddy para TLS automático. O
launcher local não publica o dashboard na Internet. Se o `.env` ainda não existir, o launcher
público o cria e pede que o operador configure a origem HTTPS antes de executar o comando novamente.
No setup público, escolha uma senha da instalação com 15 a 128 caracteres. Ela é normalizada em
Unicode NFC e armazenada somente como hash Argon2id; cookies de sessão são `HttpOnly`, `Secure` e
`SameSite=Strict`, com sete dias de inatividade e validade absoluta de trinta dias.

Nunca versione o arquivo `.env`, publique o token do bot ou compartilhe a URL privada de setup.

As migrações e a conexão PostgreSQL são validadas antes de o bot conectar ao Discord; se o banco estiver
indisponível ou a URL for inválida, o processo encerra com uma mensagem segura. Os volumes
`postgres_data`, `summyz_community_data`, `ollama_models` e `faster_whisper_models` preservam o banco, os
arquivos e os modelos gerenciados após reinício.

## Documentação

- [Instalação](./installation.md)
- [Configuração](./configuration.md)
- [Operação, privacidade e publicação](./operations.md)
- [Desenvolvimento e qualidade](./development.md)
- [Referência de comandos do bot](./reference/bot-commands.md)
- [Checklist de release](./release-checklist.md)
- [Política de segurança](../../SECURITY.md)

A [documentação em inglês](../../README.md) é a fonte mantida em paralelo com esta tradução.

## Contribuição

Contribuições individuais são bem-vindas. Contribuições corporativas não são aceitas
atualmente.

1. Faça um fork do repositório e crie uma branch para a funcionalidade.
2. Mantenha os módulos pequenos e com uma única responsabilidade, siga a estrutura existente.
3. Adicione testes para novas lógicas — `npm test` deve passar.
4. Leia e aceite o CLA Individual e crie o registro público de aceitação.
5. Abra um pull request descrevendo a mudança e sua motivação.

Consulte [CONTRIBUTING.md](./CONTRIBUTING.md) e
[CLA-INDIVIDUAL.md](./legal/CLA-INDIVIDUAL.md). Para relatar bugs ou solicitar
funcionalidades, abra uma issue.

O guia completo está em [installation.md](./installation.md). Quem
mantém releases também deve seguir
[release-checklist.md](./release-checklist.md).

## Licença

Summyz Community é software source-available sob a
[Summyz Community License 1.0](./legal/LICENSE.md). Ela permite uso pessoal, uso
empresarial interno gratuito, disponibilização externa gratuita sob suas condições e
administração remunerada de infraestrutura controlada pelo cliente dentro da exceção
prevista. Ela não permite vender o bot, cobrar por seus serviços ou sua configuração,
nem oferecer acesso hospedado monetizado.

Esta não é uma licença open source aprovada pela Open Source Initiative. Os nomes e
Ativos de Marca são regidos pela [política de marcas](./legal/TRADEMARKS.md), e
Materiais de Terceiros mantêm seus próprios termos. Consulte
[NOTICE.md](./legal/NOTICE.md) e
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
