# Sobre o projeto

Summyz é um bot para Discord que grava calls sob comando, transcreve o áudio de cada participante 
e publica resumos com decisões e tarefas.

# Regras

Fonte da verdade das convenções. Todo agente de IA e todo desenvolvedor **deve** seguir estas
regras.

## TypeScript

O projeto deve usar configuração estrita do TypeScript.

- Não usar `any` sem justificativa registrada.
- Preferir `unknown` em fronteiras externas e validar antes de usar.
- Validar dados vindos do Discord, ambiente, arquivos e APIs.
- Evitar type assertions que apenas silenciem erros.
- Evitar non-null assertions quando o estado puder ser modelado corretamente.
- Funções assíncronas devem tratar rejeições explicitamente.
- Recursos como streams, conexões e arquivos devem possuir ciclo de vida claro.

## Idioma e nomenclatura

- **Identificadores de código** (funções, variáveis, tipos, nomes de arquivo/módulo) → **inglês**.
- **Identificadores de banco de dados** (nomes de **tabelas, colunas e enums** no SQL) → **inglês**,
  sem acento, `snake_case` ASCII.
- **Comentários de código** → **pt-br**.
- **Artefatos textuais** (README, documentação) → **pt-br**.

## Metodologia

### TDD — estrito (red-green-refactor)
- **vitest**. Escrever o **teste falhando primeiro**, implementação mínima,
  depois refatorar.
- Cobertura **≥ 85%** (regras de domínio, gerenciamento de sessões, criação e validação do manifesto,
  montagem da transcrição, retenção, retries, integrações por meio de adapters testáveis). Glue de infra pode ter cobertura menor, mas caminhos de erro relevantes têm teste.
- Teste que **falha se segredo ou credenciais vazarem nos logs**.
- Integrações reais com voz do Discord exigem smoke test manual, além dos testes automatizados das
  regras e adapters ao redor da integração.

## Qualidade

Antes de considerar uma mudança concluída, executar os scripts aplicáveis:

- testes;
- cobertura;
- typecheck;
- lint;
- formatação.

Código não utilizado, comentários obsoletos e arquivos temporários devem ser removidos.

Não adicionar abstrações especulativas. Criar interfaces apenas em fronteiras que já precisam ser
substituíveis, testáveis ou isoladas.

## Segurança e privacidade

Tokens, chaves e credenciais nunca devem ser versionados.

- Usar variáveis de ambiente para segredos.
- Manter `.env` fora do Git.
- Fornecer apenas `.env.example`, sem valores reais.
- Nunca registrar tokens, cabeçalhos de autorização ou conteúdo bruto de áudio.
- Tratar áudio e transcrições como dados sensíveis.
- Evitar nomes de arquivo construídos diretamente com conteúdo fornecido pelo usuário.
- Validar caminhos para impedir path traversal.
- Aplicar limites de tamanho, duração e concorrência.
- Não enviar áudio ou transcrição a provedores diferentes dos configurados.

## Logs e erros

Logs devem ser estruturados e escritos em **pt-br**.

Registrar eventos relevantes, incluindo:

- inicialização e encerramento;
- entrada e saída de canal;
- início e fim de gravação;
- criação e finalização de segmentos;
- início e fim de processamento;
- retries;
- exclusão de arquivos;
- erros de Discord, áudio e provedores.

Não ocultar erros com `catch` vazio. Toda falha deve ser tratada, propagada ou registrada com
contexto suficiente para diagnóstico.

Mensagens enviadas ao Discord não devem revelar stack traces, caminhos internos ou segredos.

## Git

### Commits e Autoria

- **Conventional Commits no formato `<tipo>(<escopo>): <descrição>`:** tipo/prefixo em
  inglês + escopo nomeado conforme o projeto + descrição em inglês. O escopo indica a área afetada.
  
  Exemplos:
  - `feat(recording): add session creation by channel`
  - `fix(audio): preserve timestamps of simultaneous segments`
  - `test(manifest): cover recovery after interrupted write`
  - `docs(readme): document initial setup`
- **NUNCA** se adicione como coautor nos commits (não utilize `Co-Authored-By: Codex`).
