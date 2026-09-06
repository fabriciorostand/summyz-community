# Instalação

Este guia instala o Summyz Community a partir do código-fonte. O projeto não publicará
imagens Summyz pré-compiladas na versão 1.0.0.

## Formas de inicialização suportadas

| Host | CPU | NVIDIA CUDA | AMD ROCm | Validação na preparação da 1.0.0 |
| --- | --- | --- | --- | --- |
| Windows com Docker Desktop/WSL2 | Suportado | Suportado | Não exposto pelo Docker Desktop | NVIDIA validada em uma RTX 2060; build CPU validado |
| Linux com Docker Engine + Compose | Suportado | Suportado | Suportado | Fluxos mantidos; validação em máquina física ainda pendente |
| macOS com Docker Desktop | Suportado | Não aplicável | Não aplicável | Fluxo mantido; validação em máquina física ainda pendente |

“Validação pendente” não significa recurso experimental. Apenas registra a evidência de
testes disponível neste candidato. O hardware também precisa ser compatível com o driver,
a integração Docker e a versão CUDA ou ROCm instalada.

## Requisitos

- Git;
- Docker com o plugin Compose;
- uma aplicação de bot no Discord;
- drivers e integração Docker compatíveis quando a aceleração for solicitada;
- conta e créditos OpenRouter somente para etapas configuradas com OpenRouter.

## Subir a aplicação

Clone o repositório e, na raiz, execute:

```sh
./summyz-community up
```

No Windows PowerShell:

```powershell
.\summyz-community.ps1 up
```

No primeiro `up` ou `restart`, o launcher copia `.env.example` para `.env` e gera segredos
aleatórios para PostgreSQL, criptografia e primeiro acesso. Nenhum valor secreto é
impresso. Preserve esse arquivo de forma privada: trocar `SUMMYZ_SECRETS_KEY` torna as
credenciais criptografadas já armazenadas ilegíveis.

O launcher detecta CPU, NVIDIA ou AMD antes de entrar nos contêineres e escolhe o overlay
Compose correspondente. Ele nunca monta o socket Docker na aplicação. A aceleração AMD
ROCm está disponível apenas no Linux. Se uma GPU exigida não puder ser usada, a
inicialização para, salvo quando `LOCAL_AI_FALLBACK=cpu` tiver sido configurado de forma
deliberada.

Abra `http://127.0.0.1:8787` e conclua o primeiro acesso. Configure Discord, SMTP,
credenciais OpenRouter opcionais, um perfil pessoal de IA e um fórum de publicação.

## Administração

```sh
./summyz-community status
./summyz-community logs
./summyz-community restart
./summyz-community down
```

Use o launcher `.ps1` no Windows. O Compose direto continua disponível para operadores
avançados, que deverão escolher o overlay correto e fornecer um `.env` completo.

As portas do PostgreSQL e dashboard escutam em `127.0.0.1` por padrão. Em uma VPS, coloque
um proxy reverso HTTPS diante do dashboard, configure `PUBLIC_BASE_URL` com a origem HTTPS
pública e nunca exponha o PostgreSQL à Internet.

## Desenvolvimento nativo

Instale Node.js 22.12 ou superior, npm e FFmpeg com libopus no host. Configure um
`FFMPEG_PATH` absoluto ou disponibilize `ffmpeg`/`ffmpeg.exe` no `PATH`. Depois, execute
`npm install` e os scripts de desenvolvimento desejados. Python, PostgreSQL, Ollama e
faster-whisper podem continuar no Docker.

O build FFmpeg LGPL controlado é automático somente no Docker. No desenvolvimento
nativo, a licença e a configuração de codecs do FFmpeg instalado são responsabilidade do
desenvolvedor.

## Dados e backups

Volumes nomeados preservam PostgreSQL, caches de modelos e dados do Summyz. `down` não os
apaga; não adicione `--volumes` sem desejar uma exclusão permanente. Faça backup conjunto
do PostgreSQL, volume de dados do Summyz e `.env`. Nunca publique `.env`, gravações brutas,
transcrições completas, dumps do banco ou caches de modelos.

Leia [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) antes de escolher modelos ou
redistribuir qualquer imagem construída localmente.
