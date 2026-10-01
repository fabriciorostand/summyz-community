# Instalação

[English](../installation.md) · [Início da documentação](./README.md)

Este guia instala o Summyz Community a partir do código-fonte. O projeto não publica imagens Summyz
pré-compiladas para a versão 1.0.0.

## Requisitos e hosts suportados

Instale Git e Docker com o plugin Compose. Prepare uma aplicação de bot no Discord e a conta Discord
do dono dos servidores que serão configurados. Créditos OpenRouter são necessários somente para
etapas que usam OpenRouter. Execução por GPU também exige drivers e integração Docker compatíveis.

| Host | CPU | NVIDIA CUDA | AMD ROCm | Validação na preparação da 1.0.0 |
| --- | --- | --- | --- | --- |
| Windows com Docker Desktop/WSL2 | Suportado | Suportado | Não exposto pelo Docker Desktop | NVIDIA validada em uma RTX 2060; build CPU validado |
| Linux com Docker Engine + Compose | Suportado | Suportado | Suportado para Ollama | Validação em máquina física ainda pendente |
| macOS com Docker Desktop | Suportado | Não aplicável | Não aplicável | Validação em máquina física ainda pendente |

Validação pendente registra a evidência disponível, sem alterar o status de suporte.
A transcrição faster-whisper por GPU suporta NVIDIA/CUDA; AMD ROCm suporta Ollama no Linux.
Consulte as [configurações de execução](./configuration.md#execução-local-e-vad) antes de escolher
um perfil local.

## Preparar a aplicação Discord

1. Crie ou selecione a aplicação de bot no Discord Developer Portal.
2. Em **Bot**, obtenha o token e ative **Server Members Intent** para listagens e contagens de membros.
3. Em **Installation**, habilite **Guild Install** com os escopos `bot` e `applications.commands`.
   Configure as [permissões do bot](./configuration.md#fórum-e-autorizações-de-gravação).
4. Em **OAuth2**, obtenha o **Client Secret** da aplicação e registre a URL exata de redirecionamento
   `<PUBLIC_BASE_URL>/api/discord/callback`. Na origem local padrão, ela é
   `http://127.0.0.1:8787/api/discord/callback`; instalações públicas usam sua origem HTTPS configurada.

O token autentica o bot. O Client Secret permite conectar a conta Discord do proprietário do servidor.
Mantenha ambos privados e configure-os como credenciais da instalação.

## Iniciar uma instalação local

Clone o repositório e execute na raiz:

```sh
./summyz-community up
```

No Windows PowerShell:

```powershell
.\summyz-community.ps1 up
```

No primeiro `up` ou `restart`, o launcher copia `.env.example` para `.env` e gera segredos aleatórios
para PostgreSQL, criptografia e setup sem imprimir seus valores. Preserve esse arquivo: substituir
`SUMMYZ_SECRETS_KEY` torna as credenciais criptografadas já armazenadas ilegíveis.

O launcher detecta o hardware no host e seleciona os overlays Compose antes de iniciar os contêineres.
Ele nunca monta o socket Docker na aplicação. Se a execução por GPU solicitada estiver indisponível,
a inicialização para, salvo quando `LOCAL_AI_FALLBACK=cpu` tiver sido configurado explicitamente.
Dashboard e PostgreSQL escutam em `127.0.0.1`; o dashboard local não exige senha.

O launcher local abre a URL de setup no Windows ou a abre/imprime no Linux/macOS conforme a
disponibilidade do navegador. O fragmento carrega a credencial de setup; não o compartilhe.

## Iniciar uma instalação pública

Defina `PUBLIC_BASE_URL` no `.env` com a origem HTTPS exata, aponte o DNS para o host e execute:

```sh
./summyz-community-public up
```

No Windows, use `.\summyz-community-public.ps1 up`. Se `.env` não existir, o launcher público o cria
e encerra para que você configure a origem antes de executar novamente. Esse modo adiciona Caddy,
publica as portas 80/443 e obtém certificados TLS automaticamente. Mantenha PostgreSQL privado;
firewall e grupos de segurança da nuvem são responsabilidade do operador.

Registre o callback OAuth HTTPS dessa origem na aplicação Discord. O setup público também exige
uma senha da instalação com 15–128 caracteres. Consulte
[acesso e recuperação](./operations.md#acesso-à-instalação-e-recuperação-de-senha) para conhecer
o comportamento das sessões e da recuperação de senha.

## Primeiro acesso e primeira gravação

1. Conclua o setup com o token do bot e, no modo público, a senha da instalação. O Summyz valida
   o token no Discord e obtém o Application ID automaticamente.
2. Configure o Client Secret da aplicação e conecte a conta Discord do proprietário do servidor.
   O setup oferece uma etapa opcional para o Client Secret e mostra a URL de redirecionamento a
   cadastrar; a tela **Instalação** permite fazer o mesmo depois. Autorize os escopos
   `identify guilds`. No modo público, entre novamente após concluir a conexão, pois as sessões
   anteriores do dashboard são revogadas; o dashboard volta para **Servidores** com o resultado.
3. Instale o bot em um servidor da conta conectada. Configure o fórum de publicação e os cargos
   ou membros individuais autorizados a gravar.
4. Complete o perfil inicial de IA escolhendo provedor e modelo para transcrição, refinamento e
   resumo. Configure a chave OpenRouter se alguma etapa a utilizar; instale os modelos locais necessários.
5. Ative o perfil no servidor. Entre em um canal de voz convencional e execute `/record`. Use `/stop`
   no mesmo canal; a gravação também termina quando todos saem.

Instalações novas começam com um perfil incompleto e nenhum perfil ativo por servidor. Fórum
configurado, perfil completo, modelos locais disponíveis e propriedade verificada são requisitos
para gravar. Após troca de proprietário, o novo dono conectado deve revisar a configuração e
confirmá-la com `/recording-activate` ou pelo fluxo de ativação do servidor. Consulte
[configuração](./configuration.md) e [comandos](./reference/bot-commands.md) para os detalhes.

## Compose direto e desenvolvimento nativo

Operadores avançados podem fornecer um `.env` completo e escolher os overlays explicitamente:

```sh
docker compose up -d --build
docker compose -f compose.yaml -f docker/compose.nvidia.yaml up -d --build
docker compose -f compose.yaml -f docker/compose.amd.yaml up -d --build
```

São comandos alternativos de inicialização: a configuração base usa CPU; NVIDIA e AMD selecionam
seus respectivos overlays. A aceleração AMD está disponível somente no Linux.

Desenvolvimento nativo exige Node.js 22.23.2, npm 10.9.8 e FFmpeg com `libopus`. Configure um
`FFMPEG_PATH` absoluto ou disponibilize `ffmpeg`/`ffmpeg.exe` no `PATH`. Consulte o
[guia de desenvolvimento](./development.md) para scripts, conexão com o banco e rede dos serviços locais.

## Administração e dados

Use o launcher para `status`, `logs`, `restart` e `down`. Consulte [operação](./operations.md) para
recuperação, substituição de credenciais, backups e retenção. Volumes nomeados preservam banco,
gravações e caches de modelos; `down` não os exclui.

Leia [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) antes de escolher modelos ou redistribuir
imagens construídas localmente. Nunca publique `.env`, gravações, transcrições ou dumps do banco.
