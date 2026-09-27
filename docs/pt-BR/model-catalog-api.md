# Contratos de perfis e modelos

Esta etapa implementa backend, bot e serviços locais. A interface deve consumir estes contratos;
os seletores, avisos e mensagens junto aos campos ainda dependem da implementação do frontend.

## Perfis

Cada etapa escolhe seu próprio `provider` e `model`:

| Etapa | Provedores permitidos |
| --- | --- |
| `transcription` | `openrouter`, `faster-whisper` |
| `refinement` | `openrouter`, `ollama` |
| `summary` | `openrouter`, `ollama` |

`profileType` é somente leitura: `external` para todas as etapas OpenRouter, `local` para todas
locais, `hybrid` para uma combinação e `null` enquanto faltar algum provedor. O backend ignora o
valor enviado nesse campo e calcula o resultado. O frontend pode fazer o mesmo cálculo enquanto
o usuário edita. Batching, VAD e execução dependem do provedor de cada etapa.

O setup cria somente um perfil, `Perfil 1` ou `Profile 1`, com os três provedores e modelos `null`.
Essa criação é a única exceção ao preenchimento obrigatório. `POST /api/profiles` e
`PUT /api/profiles/:profileId` exigem os três pares completos e modelos presentes nos respectivos
catálogos válidos. Modelos locais ainda não instalados permitem salvar e ativar o perfil.

Nomes são únicos na instalação inteira, distinguem maiúsculas de minúsculas e perdem espaços nas
extremidades. A verificação é transacional; o índice global ficará para outra versão. O antigo
índice por tipo, que desconsiderava maiúsculas, é removido na migração 15. Um conflito retorna
HTTP 409:

```json
{
  "error": "profile_name_conflict",
  "field": "name",
  "profileName": "Perfil 1",
  "message": "Já existe um perfil chamado 'Perfil 1'. Escolha outro nome."
}
```

O frontend deve apresentar o erro no campo de nome e continuar sugerindo o próximo nome livre
ao criar um perfil.

`GET /api/profiles` retorna entradas `{ profile, active, activeServerCount, availability }`.
Em `GET /api/guilds/:guildId/configuration`, cada objeto de `profiles` inclui `availability`
ao lado dos campos do perfil. A estrutura de disponibilidade é:

```json
{
  "status": "missing_models",
  "missingModels": [{ "phase": "summary", "provider": "ollama", "model": "qwen3:8b" }],
  "unavailableProviders": []
}
```

Os estados são `ready`, `incomplete`, `missing_models` e `unavailable`. Uma falha de inventário
não significa que os arquivos estejam ausentes. A lista de faltantes continua detalhada por etapa,
mesmo quando duas etapas usam o mesmo modelo.

## Catálogos

`GET /api/models?phase=summary&provider=ollama` retorna as famílias da biblioteca pública.
Entradas com `variantsAvailable: true` servem para navegação; consulte, por exemplo,
`GET /api/models?phase=summary&provider=ollama&family=qwen3` para obter modelos selecionáveis.
Somente variantes locais de geração de texto são aceitas; embeddings e variantes cloud são excluídos.
A integração lê HTML público, pois a API do Ollama não enumera a biblioteca remota; os testes smoke
verificam o formato real. Alterações no HTML podem exigir atualização do adaptador.

Para transcrição local, use `provider=faster-whisper&phase=transcription`. A lista vem dos aliases
multilíngues conhecidos pela versão instalada do faster-whisper, com tamanho consultado no Hugging
Face. Para API, use `provider=openrouter`: transcrição exige entrada de áudio e saída de transcrição;
refinamento e resumo exigem texto e suporte a `response_format`. A chave OpenRouter deve estar configurada.

A resposta contém `status` (`fresh`, `stale`, `unavailable`), `fetchedAt` em milissegundos Unix,
`phase`, `provider`, `inventoryStatus`, `installedModels` e `items`. Cada item tem `model`, `name`,
`sizeBytes`, `installed` e `compatibility`, além dos metadados pertinentes ao provedor. Tamanho
desconhecido é `null`; `installed: null` significa inventário indisponível ou provedor externo.
`installedModels` lista também modelos fora do catálogo, permitindo sua exibição e desinstalação.

Compatibilidade usa `recommended`, `compatible`, `above_recommended`, `unknown` e `incompatible`.
As estimativas conhecidas consideram CPU/RAM ou a GPU selecionada por `LOCAL_AI_DEVICE` e
`LOCAL_AI_FALLBACK`; modelos sem estimativa retornam `unknown`. Acima da recomendação continua
selecionável, com aviso. A avaliação não instala nem executa o modelo.

O PostgreSQL guarda o último catálogo válido. Ele é reutilizado por 15 minutos; depois disso ocorre
uma atualização. Se a fonte falhar, a versão anterior pode ser usada até completar 24 horas, com
`status: stale`. Sem cache utilizável, a resposta tem `status: unavailable` e `items: []`; validações
de seleção retornam `catalog_unavailable` (503). O bot compartilha esse cache para validar as etapas
OpenRouter antes de gravar. Nenhuma seleção automática de modelo é feita pelo setup ou catálogo.

## Downloads e desinstalação

| Operação | Rota e corpo |
| --- | --- |
| Iniciar | `POST /api/models/downloads`, `{ "phase": "summary", "provider": "ollama", "model": "qwen3:8b" }` |
| Acompanhar | `GET /api/models/downloads` |
| Cancelar | `POST /api/models/downloads/:downloadId/cancel` |
| Desinstalar | `DELETE /api/models`, `{ "provider": "ollama", "model": "qwen3:8b" }` |

Downloads são explícitos. A resposta de início é HTTP 202 com `downloadId`, `provider`, `model`,
`status`, `completedBytes`, `totalBytes` e `failureCode`. O progresso é consultado pela lista;
`totalBytes: null` pede indicador indeterminado. Os estados são `queued`, `downloading`,
`completed`, `cancelling`, `cancelled` e `failed`. O cancelamento é assíncrono: aguarde o estado
terminal antes de considerar a limpeza concluída. Erros externos nunca são reproduzidos na resposta.

Há uma transferência por vez no dashboard, até 20 pedidos ativos e histórico dos últimos 1.000
pedidos, priorizando os ativos. Pedidos repetidos para o mesmo modelo ativo retornam o mesmo job.
O limite por transferência é 24 horas; o tamanho máximo é 1 TiB no Ollama e 32 GiB no faster-whisper.
`download_queue_full` retorna HTTP 429. Reiniciar o dashboard preserva a operação; arquivos parciais
são retomados automaticamente. O faster-whisper utiliza requisições Range e o Ollama seu próprio
mecanismo de retomada. Uma falha terminal limpa os parciais e informa `download_failed`.

Cancelar remove somente parciais da operação; arquivos completos compartilhados pelo Ollama são
preservados. O dashboard recebe acesso ao volume Ollama para essa limpeza. O serviço de inicialização
ajusta a propriedade desse volume ao UID 1000, também usado por Ollama e dashboard.

Desinstalação retorna 204. É bloqueada com `model_in_use` (409) enquanto uma gravação, reunião
pendente ou falha recuperável precisar do modelo fixado em seu manifesto. Somente a referência em
um perfil permite excluir. Um download ativo resulta em `model_download_active`; uma operação
concorrente de início de gravação ou alteração de modelos pode resultar em `model_lifecycle_busy`.
Nesse caso, repita a operação. Todas as rotas exigem a mesma autorização e proteção de origem do painel.

## Gravação, recuperação e atualização

O bot verifica o inventário antes de entrar no canal. Modelo local ausente recusa `/record` com
aviso no Discord para instalar pelo painel; não há download implícito. Se um serviço estiver fora
do ar, o aviso distingue a impossibilidade de verificar o inventário.

Se um modelo desaparecer depois, o job fica `scheduled`, com `last_failure_code` igual a
`local_models_missing` ou `local_models_unavailable`, e nova verificação em 30 segundos. Essa espera
devolve a tentativa consumida pela aquisição do job e preserva manifesto, áudio, custos e estados
intermediários. Ao reinstalar o modelo, o processamento continua com os provedores originalmente
fixados; mudanças posteriores no perfil não afetam a reunião.

A migração 15 amplia o contrato de perfis e cria as tabelas de catálogos e downloads, sem alterar
dados de processamento. O manifesto v3 aceita a seleção independente por etapa e continua lendo os
manifestos existentes. Testes reais de atualização partindo das versões 9 e 14 verificam a preservação
dos dados. Migrações anteriormente aplicadas não são editadas. Atualize backend, bot e serviço
faster-whisper em conjunto; esta alteração não implementa os novos componentes visuais do painel.
