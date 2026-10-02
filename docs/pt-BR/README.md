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
  <img src="https://img.shields.io/badge/node-22.23.2-339933?logo=node.js&logoColor=white" alt="Node 22.23.2" />
  <img src="https://img.shields.io/badge/PRs-welcome-23A559" alt="PRs welcome" />
  <img src="https://img.shields.io/badge/self--hosted-100%25-0A0B0F" alt="Self-hosted" />
  <img src="https://img.shields.io/badge/licen%C3%A7a-source--available-6E40C9" alt="Licença source-available" />
</p>

---

## Como funciona

O Summyz grava cada participante separadamente. Depois do encerramento, transcreve os áudios
preservando falantes, timestamps e falas sobrepostas, revisa o texto sem alterar sua estrutura e
gera um resumo com tópicos, decisões, tarefas e pendências. O resultado e a transcrição completa
são publicados em um post de fórum do Discord.

Cada etapa escolhe seu provedor: OpenRouter para execução externa, faster-whisper para transcrição
local e Ollama para refinamento e resumo locais. Um perfil pode combinar execução local e externa.
O dashboard reúne configuração, histórico, participação, custos e tarefas.

## Requisitos

- Git e Docker com Compose;
- uma aplicação de bot no Discord e a conta Discord do dono dos servidores que serão configurados;
- conta, créditos e chave OpenRouter somente para etapas que usam esse provedor;
- drivers e integração Docker compatíveis quando a aceleração por GPU for utilizada;
- no Linux, systemd, udev, curl e sudo para detecção automática por eventos de hardware;
- no Windows, permissão para registrar uma tarefa de inicialização com elevação administrativa.

O fluxo Docker prepara Node, Python, FFmpeg, PostgreSQL, Ollama e faster-whisper. Para desenvolvimento
nativo, consulte [Desenvolvimento e qualidade](./development.md).

## Início rápido

1. Prepare a aplicação Discord seguindo o [guia de instalação](./installation.md).
2. Na raiz do repositório, execute `./summyz-community up` no Linux/macOS ou
   `.\summyz-community.ps1 up` no Windows. O launcher gera `.env` com segredos locais, detecta o
   hardware e abre o setup. Informe o token do bot; o Application ID é obtido automaticamente.
3. Configure o Client Secret e o redirecionamento OAuth da aplicação, conecte a conta Discord do
   proprietário e instale o bot no servidor.
4. Complete um perfil de IA, instale seus modelos locais quando necessário e ative-o no servidor.
   Defina o fórum de publicação e as autorizações de gravação.
5. Entre em um canal de voz convencional e execute `/record`. Use `/stop` no mesmo canal para
   encerrar; quando todos saem, o encerramento é automático.

O modo local publica o dashboard em `127.0.0.1` por padrão e não exige senha. Para uma VPS pública, configure
`PUBLIC_BASE_URL` com a origem HTTPS e use `./summyz-community-public up` ou
`.\summyz-community-public.ps1 up`; o setup exige uma senha única da instalação e o Caddy fornece TLS.
A conexão Discord identifica o proprietário dos servidores; não cria contas de usuário Summyz.

Nunca versione `.env` nem compartilhe tokens, Client Secret ou a URL privada de setup.

## Próximos passos e documentação

- [Instalação](./installation.md): preparação do Discord, execução local/pública e primeira gravação.
- [Configuração](./configuration.md): acesso aos servidores, perfis, modelos, idiomas e parâmetros.
- [Operação](./operations.md): administração, recuperação, publicação, retenção, custos e backups.
- [Desenvolvimento e qualidade](./development.md): ambiente, testes, migrações e CI.
- [Referência de comandos](./reference/bot-commands.md): sintaxe e regras de acesso.
- [Checklist de release](./release-checklist.md) e [política de segurança](../../SECURITY.md).

As versões [em inglês](../../README.md) e pt-BR são mantidas em paralelo.

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
