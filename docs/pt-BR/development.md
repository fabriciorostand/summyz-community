# Desenvolvimento e qualidade

[English](../development.md) · [Início da documentação](./README.md)

## Ambiente e comandos

A execução nativa do bot/API suporta somente Windows e Linux. Os pontos de entrada recusam
outros sistemas antes de carregar configuração, acessar o banco ou iniciar gravações.

Use Node.js 22.23.2 e npm 10.9.8, fixados em `package.json` e na CI. Docker prepara esses runtimes,
Python 3.12.14 e o build controlado LGPL do FFmpeg. A execução nativa exige FFmpeg com `libopus`:
configure `FFMPEG_PATH` absoluto ou disponibilize `ffmpeg`/`ffmpeg.exe` no `PATH`. O bot o valida
antes de conectar ao Discord. A licença e os codecs do FFmpeg nativo são responsabilidade do desenvolvedor.

Instale as dependências fixadas na raiz:

```sh
npm ci
```

Prepare `.env` pelo [fluxo de instalação](./installation.md). Não o versione. Para banco nativo,
troque `DATABASE_URL` gerada para Compose de `postgres:5432` pelo endereço do host e `POSTGRES_PORT`
publicado.

| Comando | Finalidade |
| --- | --- |
| `npm run dev` | Bot supervisionado em desenvolvimento |
| `npm run dev:api:local` | API do dashboard em desenvolvimento, modo local |
| `npm run dev:api:public` | API do dashboard em desenvolvimento, modo público |
| `npm run dev:web` | Dashboard Vite em `127.0.0.1:5173`, com proxy de `/api` para `127.0.0.1:8787` |
| `npm run build` | Compilar servidor e dashboard |
| `npm start` | Bot supervisionado compilado |
| `npm run api:local` | API compilada do dashboard, modo local |
| `npm run api:public` | API compilada do dashboard, modo público |

Execute bot, API e Vite em terminais separados conforme necessário. Vite é a origem do navegador
no desenvolvimento frontend, enquanto `PUBLIC_BASE_URL` determina a origem do callback Discord;
registre esse callback exato na aplicação Discord.

O script seleciona o modo de acesso por argumento `--access-mode local` ou `--access-mode public`.
O modo não é lido do `.env`; uma entrada antiga de `DASHBOARD_ACCESS_MODE` é ignorada. Sem argumento,
a API assume o modo local. No Docker, o launcher seleciona o comando correspondente da API.

`WEB_HOST` define o listener da API nativa e o endereço de publicação da porta do dashboard no
Docker. O listener interno do contêiner permanece em `0.0.0.0:8787`. Alterar o host não altera
as regras de autenticação, os cabeçalhos `Host` ou as origens aceitas pelo modo selecionado.
Use `WEB_HOST=127.0.0.1` ao executar o modo local, que dispensa senha. Ao alternar os scripts,
verifique esse valor: ele é compartilhado entre os modos.

Os scripts npm do modo público exigem `PUBLIC_BASE_URL` com origem HTTPS e `WEB_HOST` que aceite
conexões externas, como `0.0.0.0`. Eles não iniciam o Caddy nem configuram certificados: prepare o
proxy HTTPS antes de acessar esse modo. O launcher Docker público fornece o Caddy automaticamente.

Os clientes de IA local usam `http://ollama:11434` e `http://faster-whisper:8000`. Esses nomes resolvem
dentro do Compose e a pilha base não publica as portas no host. IA local nativa exige configuração
deliberada de rede e resolução de nomes; apenas iniciar serviços privados em Compose não torna
essas URLs acessíveis ao processo nativo. O fluxo Compose fornece a rede compartilhada automaticamente.

## Estrutura e convenções do projeto

- `src/discord`, `src/recording`: comandos, propriedade, captura de voz, manifestos e recuperação;
- `src/transcription`, `src/refinement`, `src/summary`, `src/processing`: etapas validadas e jobs duráveis;
- `src/models`, `src/local-ai`, `src/openrouter`, `src/cost`: catálogos, modelos, execução e custos;
- `src/api`, `src/auth`, `src/database`: contratos do dashboard, acesso à instalação, banco e migrations;
- `web/src`: rotas React, telas, preferências do navegador e mensagens inglês/pt-BR;
- `services/faster-whisper`: serviço Python de transcrição;
- `tests`, `web/src/**/*.test.*`, `scripts/ci`: testes e gates de qualidade.

Siga [AGENTS.md](../../AGENTS.md). TypeScript é estrito; valide dados externos, modele estados
opcionais e trate rejeições e ciclos de vida explicitamente. Use identificadores de código/banco
e comentários em inglês. Segredos, cabeçalhos de autorização e áudio não devem aparecer nos logs;
erros Discord não podem expor detalhes internos. Há testes que falham quando credenciais vazam nos logs.

## TDD e verificações locais de qualidade

Para mudanças de lógica, use Vitest em red-green-refactor: escreva o teste falhando, implemente o
mínimo e refatore. Isole integrações substituíveis em fronteiras reais. Smoke tests de IA local
são separados da suíte rápida; interações manuais reais no Discord não são critérios automatizados.

```sh
npm run check
npm run security:audit
```

`check` executa Biome, typechecks do servidor e web, testes unitários Python, cobertura do servidor
e testes web. Use os scripts separadamente para diagnosticar falhas:

| Comando | Verificação |
| --- | --- |
| `npm test` | Suíte rápida do servidor, incluindo integrações de banco configuradas |
| `npm run test:coverage` | Cobertura do servidor; limites de 85% para linhas, branches, funções e statements |
| `npm run test:web` / `npm run test:web:coverage` | Testes do dashboard / configuração de cobertura CI |
| `npm run test:python` / `npm run test:python:coverage` | Testes unitários Python / cobertura e relatórios |
| `npm run typecheck` / `npm run typecheck:web` | Tipos do servidor / dashboard |
| `npm run lint` / `npm run format:check` | Lint / formatação |
| `npm run format` | Aplicar formatação |

A cobertura Python precisa das ferramentas de `requirements/ci.lock`; o script unitário usa
`unittest`. `check` não executa o gate de cobertura web, cobertura por domínio ou smoke local.
A CI também inclui mais módulos na cobertura do servidor que a configuração local.

## Testes de integração PostgreSQL

As suítes locais usam `POSTGRES_TEST_URL` e são ignoradas quando ela não existe. Aponte-a para um
banco PostgreSQL dedicado e descartável, nunca para a instalação em uso ou um backup: testes de
migração recriam schema e fixtures. A CI fornece PostgreSQL 18.4 real e executa essas suítes.

Para reproduzir a configuração mais ampla de cobertura do servidor na CI com esse banco configurado:

```sh
npm run test:coverage:ci
```

## Smoke de IA local e benchmark de transcrição

Com a pilha Docker configurada, execute a suíte isolada na rede privada:

```sh
docker compose --profile smoke run --rm smoke
```

Ela executa inferência local real, baixa modelos pequenos e pode demorar na primeira execução.
`npm run test:smoke:local-ai` é a entrada Vitest isolada; Compose fornece rede e runtime.
Escolha os overlays apropriados ao testar aceleração explicitamente. A inferência CI usa CPU;
construir o pacote CUDA não valida uma GPU física.

O benchmark usa áudio retido e `transcript.raw.txt` como referência e informa WER, CER, tempo e
fator de tempo real sem conteúdo da reunião. Por padrão, monta `./data` do host somente para
leitura, em vez do volume nomeado do bot. Forneça uma montagem somente leitura do diretório retido
desejado ao medir gravações feitas pelo Docker.

```sh
docker compose --profile benchmark run --rm -e BENCHMARK_DEVICE -e BENCHMARK_BATCH_SIZE -e BENCHMARK_MODEL benchmark
```

Defina essas variáveis no host antes do comando. `BENCHMARK_DATA_DIR` é o diretório dentro do
contêiner (`/benchmark-data/recordings` por padrão). Somente reuniões com todos os áudios restantes
são medidas.
O conjunto também exige `manifest.json` e `transcript.raw.txt` por reunião. A limpeza terminal
remove esses arquivos locais mesmo com áudio retido; prepare um conjunto isolado somente leitura
com conteúdo e áudio preservados, sem presumir que o diretório terminal esteja completo.

## Migrations e preservação em upgrades

Migrations são definições SQL TypeScript ordenadas em `src/database/migrations*.ts`.
Depois de aplicadas são imutáveis: PostgreSQL registra checksum SHA-256 e a inicialização falha
de forma fechada se o SQL versionado divergir. Não corrija uma migration aplicada editando seu SQL histórico.

Da versão 10 em diante, migrations devem preservar todas as reuniões não terminais: sem exclusão de
dados de negócio, truncamento, remoção de colunas, exclusão em cascata ou atualização do
processamento de reuniões. Tabelas só podem ser removidas quando não guardam dados de reuniões nem
de configuração; as tabelas protegidas estão listadas em `src/database/migration-safety.ts`.
Limpeza pertence ao ciclo explícito de retenção após estado terminal. A inicialização deve
preservar artefatos pendentes. Upgrades de processamento/manifesto exigem testes de contrato
que comprovem preservação e recuperação de reuniões, jobs, custos, manifestos e catálogos de áudio.
Consulte os testes de integração de upgrade e `tests/database-migration-safety.test.ts`.

## Integração contínua

`CI` executa em PRs para `main` e pushes em `main`. Os jobs são `Quality`, `Security`, `Tests`,
`Runtime / Images`, `Quality Gate / Analysis` e `Quality Gate`. Novos commits cancelam execuções
anteriores do mesmo PR; pushes em `main` não cancelam uns aos outros. A proteção de branch determina
se pushes diretos são bloqueados.

Servidor, dashboard e Python exigem ao menos 85% de cobertura global por linhas e 85% em cada grupo
de domínio. A cobertura alterada é um agregado ponderado por linhas dos três componentes, também
de pelo menos 85%. Relatórios HTML, JUnit, JSON e SARIF são preservados como artefatos. PRs internos
recebem um comentário persistente em inglês; forks recebem checks, resumo e artefatos sem segredos
nem permissão de escrita. Analysis reúne resultados e guarda o baseline de main após pushes.

Security conta vulnerabilidades únicas HIGH/CRITICAL com correção disponível como bloqueantes.
Severidades menores e achados sem correção publicada continuam nos detalhes e artefatos. Checks
de segredos e configuração têm regras próprias de reprovação no workflow.

Runtime constrói imagens de bot, dashboard e transcrição CPU, valida usuários/versões e variantes
Compose e analisa essas imagens. Em pushes de `main`, inferência CPU local e pacote CUDA sempre
executam. Em PRs, alterações de transcrição, FFmpeg, locks Python ou workflow selecionam ambos;
dependências de smoke/runtime/modelos selecionam smoke; alterações não relacionadas podem dispensar
ambos. Os filtros de caminhos do workflow são a fonte de verdade dessa seleção.

Node.js 22.23.2, npm 10.9.8, Python 3.12.14, digests de imagens, actions, locks de pacotes e snapshots
Debian estão fixados. Pacotes de sistema NVIDIA são obtidos nos repositórios oficiais HTTPS Ubuntu
durante o build. Runner GitHub e bases de vulnerabilidades dos scanners são serviços atualizados.
Caches de npm, pip, BuildKit e modelos verificados reduzem o tempo; o dashboard lê o cache de build
do bot sem substituí-lo. Novas entradas de cache de modelos só são salvas após smoke bem-sucedido em main.
