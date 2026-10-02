# Instalação

[English](../installation.md) · [Início da documentação](./README.md)

Este guia instala o Summyz Community a partir do código-fonte. O projeto não publica imagens Summyz
pré-compiladas para a versão 1.0.0.

## Requisitos e hosts suportados

Use Windows ou Linux e instale Git e Docker com o plugin Compose. Prepare uma aplicação de bot no
Discord e a conta Discord do dono dos servidores que serão configurados. Créditos OpenRouter são necessários somente para
etapas que usam OpenRouter. Execução por GPU também exige drivers e integração Docker compatíveis.

| Host | CPU | NVIDIA CUDA | AMD ROCm | Validação na preparação da 1.0.0 |
| --- | --- | --- | --- | --- |
| Windows com Docker Desktop/WSL2 | Suportado | Suportado | Não exposto pelo Docker Desktop | NVIDIA validada em uma RTX 2060; build CPU validado |
| Linux com Docker Engine + Compose | Suportado | Suportado | Suportado para Ollama | Validação em máquina física ainda pendente |

Validação pendente registra a evidência disponível, sem alterar o status de suporte.
A transcrição faster-whisper por GPU suporta NVIDIA/CUDA; AMD ROCm suporta Ollama no Linux.
Consulte as [configurações de execução](./configuration.md#execução-local-e-vad) antes de escolher
um perfil local.

Os launchers e os pontos de entrada nativos do bot/API recusam sistemas não suportados antes de
criar configuração ou inicializar serviços. O bloqueio usa o sistema operacional visível ao processo;
containers Linux não identificam o sistema operacional da máquina física.

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

`SUMMYZ_SECRETS_KEY` e `SUMMYZ_SETUP_TOKEN` são acrescentadas diretamente ao `.env` pelo launcher;
não aparecem no `.env.example` e não exigem preenchimento manual. A geração ocorre somente quando
o `.env` não existe. Um arquivo existente é preservado; se faltar algum segredo, a inicialização
falha. Copiar o exemplo manualmente não substitui a inicialização pelo launcher.

O launcher inicia as instâncias CPU e tenta iniciar, separadamente, os serviços GPU compatíveis
com o hardware detectado. Sem GPU compatível ou se um serviço GPU falhar, a instalação conclui
com CPU e o dashboard mostra GPU indisponível nas etapas afetadas. O outro serviço GPU pode
continuar disponível. A aplicação não monta o socket Docker.
Por padrão, dashboard e PostgreSQL são publicados em `127.0.0.1`; o dashboard local não exige
senha. `WEB_HOST` permite configurar o IP de publicação da porta do dashboard no Docker,
conforme o [guia de configuração](./configuration.md#ambiente-e-parâmetros-de-execução).
Mantenha o modo local em loopback; o acesso pela rede exige o modo público.

O launcher local abre a URL de setup no Windows ou a abre/imprime no Linux conforme a
disponibilidade do navegador. O fragmento carrega a credencial de setup; não o compartilhe.

No Windows e no Linux, os launchers local e público adicionam `docker/compose.hardware.yaml`. A detecção
acontece dentro do bot e da API, sem elevação administrativa, tarefa agendada ou processo residente
no host. Cada processo aguarda uma leitura inicial válida antes de iniciar suas funções, inclusive
na retomada automática pelo Docker; falha nessa leitura impede sua inicialização. O launcher prepara
os provedores CPU e tenta os provedores GPU antes de iniciar bot/API. A ausência de um provedor GPU
opcional mantém CPU disponível; uma resposta inválida ou uma falha declarada pelo sensor impede a
leitura. Alterações posteriores podem ser consultadas pela [redetecção manual da API](./operations.md#redetectar-hardware-no-windows-e-linux).
Esta etapa não adiciona um botão ao dashboard nem redetecção automática por eventos ou temporizador.
Encerrar um container encerra sua detecção; o outro continua independente. O endpoint antigo de
relatórios do host foi removido. Os launchers não removem automaticamente tarefas Windows ou
serviços Linux antigos.

Um inventário armazenado inválido só é substituído após uma nova detecção bem-sucedida e validada.
Erros de acesso ao banco continuam impedindo a inicialização. Essa recuperação altera somente o
inventário de hardware, sem modificar reuniões, áudios ou dados de processamento.

Uma instalação Linux existente pode ainda ter o serviço antigo cadastrado. Antes de atualizar,
confira seu nome e o `ExecStart` para confirmar que pertence a este repositório, e remova somente
essa unidade com privilégios administrativos. Na raiz do repositório:

```sh
repository_path=$(pwd -P)
unit_name="summyz-hardware-$(printf '%s' "$repository_path" | sha256sum | cut -c1-12).service"
systemctl cat "$unit_name"
# After confirming the unit points to this repository:
sudo systemctl disable --now "$unit_name"
sudo rm -- "/etc/systemd/system/$unit_name"
sudo systemctl daemon-reload
```

Essa é uma limpeza manual de um serviço instalado anteriormente; novas inicializações não
instalam serviços de detecção no host.

### Recursos no Windows

O inventário registra CPU e RAM efetivamente expostas ao container, considerando afinidade de CPU,
cotas de CPU do cgroup v2 e limites de memória. A GPU é consultada no faster-whisper GPU; se somente
Ollama GPU estiver acessível, seu modelo e VRAM permanecem desconhecidos. Dados antigos do launcher
não substituem uma nova leitura. No Linux, AMD/ROCm é reconhecido pelo serviço Ollama GPU disponível;
seu modelo e VRAM permanecem desconhecidos. A aceleração AMD continua disponível para resumos,
com transcrição em CPU. Detectar uma GPU não amplia o acesso de containers já existentes:
pode ser necessário recriar os serviços GPU com o Compose, executar o launcher novamente e depois
solicitar uma nova leitura.

Para usar todo o poder computacional disponível da máquina física, provavelmente será necessário
configurar os recursos do Docker Desktop/WSL 2. O Compose do Summyz não impõe cotas de CPU/RAM e o
perfil NVIDIA solicita todas as GPUs, mas os containers só podem usar o que o Docker/WSL expõe.
Disponibilizar recursos não garante utilização de todos os núcleos ou GPUs simultaneamente: isso
depende do modelo, do provedor e da carga de trabalho.

Por padrão, o WSL 2 disponibiliza todos os processadores lógicos, mas limita a RAM a 50% da memória
do Windows. Consulte a [configuração oficial do WSL](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)
e revise os limites na sua instalação. Ajustes em `%UserProfile%\.wslconfig` são globais para todas
as distribuições WSL 2; um limite individual de container não aumenta a memória disponível na VM.
O Summyz não altera esse arquivo. Reserve memória para o Windows e os demais programas ao definir
os limites. Aplicar mudanças pode exigir reiniciar o WSL/Docker; `wsl --shutdown` encerra todas as
distribuições WSL 2, portanto finalize suas atividades antes de executar esse comando. Reinicie o
Summyz após aplicar a configuração para fazer a leitura inicial dos novos recursos.

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
