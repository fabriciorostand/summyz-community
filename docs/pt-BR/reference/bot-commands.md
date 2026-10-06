# Comandos do Summyz

[English](../../reference/bot-commands.md) · [Início da documentação](../README.md)

## Pré-condições e acesso

Comandos são usados em servidores Discord. A instalação deve ter uma conta Discord conectada do
dono literal do servidor; o Summyz verifica a propriedade antes de executar comandos conhecidos.
Sem conta, com conta de outro proprietário ou sem conseguir verificar, o comando é recusado
com mensagem efêmera.

| Ação | Quem pode usar |
| --- | --- |
| Iniciar/encerrar gravação | Dono, cargos autorizados ou membros autorizados individualmente |
| Gerenciar fórum, cargos, perfil ativo e ativação | Somente o dono |

Administrar ou Gerenciar servidor, isoladamente, não concede acesso. Autorizar cargo/membro não
concede gestão. Autorizações individuais dependem da participação atual e são revogadas ao sair.
Após trocar de proprietário, `/record` também exige confirmação explícita da configuração.
Consulte [configuração](../configuration.md#propriedade-e-acesso-aos-servidores).

## Gravação

### `/record`

Inicia a gravação do canal de voz convencional onde a pessoa está. Apenas uma gravação pode ficar
ativa por servidor. Fórum e perfil ativo completo precisam estar configurados; modelos locais
selecionados devem estar instalados e provedores disponíveis. Etapas OpenRouter exigem chave da
instalação e verificação de capacidades. faster-whisper exige checkpoint multilíngue verificado.
Essas verificações bloqueiam a captura quando faltam requisitos; o dono também está sujeito a elas.

O Summyz anuncia publicamente a gravação no chat de texto do comando. Bots são excluídos; pessoas
que entram depois são incluídas. Avaliações locais acima da recomendação ou desconhecidas avisam
somente quem executou, sem trocar o modelo nem expor hardware publicamente.

### `/stop`

Encerra a gravação ativa. A pessoa deve estar autorizada e no mesmo canal gravado. A confirmação
é efêmera no chat da interação; o aviso público menciona a pessoa no chat original do `/record`.

Quando todos os humanos saem, a gravação termina automaticamente e o bot sai. O chat original
identifica o canal quando seu nome salvo está disponível e informa que o áudio será processado.
Transcrição, refinamento, resumo e publicação continuam pela fila durável. Consulte
[operação](../operations.md#ciclo-de-gravação-e-processamento) para retries e recuperação.

## Configuração de fórum e cargos

### `/recording-summary-forum set forum:<fórum> tag:<tag opcional>`

Seleciona o fórum de publicação. `tag` aceita nome ou ID de tag existente e é obrigatória se o fórum
exigir tags. O bot valida Ver canais, Enviar mensagens, Enviar mensagens em threads, Ler histórico
e Anexar arquivos antes de salvar. Somente o dono; resposta efêmera.

### `/recording-summary-forum show`

Mostra fórum e tag configurados ou informa sua ausência. Somente o dono; efêmero.

### `/recording-summary-forum clear`

Remove o destino e bloqueia novas gravações até configurar outro fórum. Publicações não iniciadas
não concluem sem destino e seguem a política de retry durável; isso não garante espera ilimitada.
Posts já iniciados continuam na thread salva. Somente o dono; efêmero.

### `/recording-role add role:<cargo>`

Autoriza um cargo a iniciar e encerrar gravações. Somente o dono; efêmero.

### `/recording-role remove role:<cargo>`

Remove a autorização desse cargo. Somente o dono; efêmero.

### `/recording-role list`

Lista os cargos autorizados. Somente o dono; efêmero. Autorizações individuais são configuradas
separadamente pelo fluxo de configuração do servidor, e não por esses comandos de cargos.

## Perfil de IA ativo

### `/recording-profile list`

Lista perfis completos da instalação com nomes e IDs. Somente o dono; efêmero. Estar completo não
garante arquivos locais instalados nem aprovação dos modelos na verificação anterior à gravação.

### `/recording-profile set profile:<ID do perfil>`

Seleciona um perfil completo existente como ativo do servidor. Somente o dono; efêmero.
O perfil pode ser externo, local ou híbrido. Use o ID retornado por `list`. A seleção vale para
novas gravações e não modifica o perfil fixado em uma reunião em andamento.

## Confirmação de propriedade

### `/recording-activate`

Confirma a configuração após troca de proprietário. Somente o dono atual pode executar e sua conta
deve estar conectada à instalação. Revise antes fórum, perfil ativo e autorizações. Fórum e perfil
ativo completo são obrigatórios. Confirmar permite que novas gravações sigam para verificações
normais de autorização, modelos e voz; não baixa modelos nem retoma jobs cancelados.
A resposta é efêmera.

O primeiro dono observado é confirmado automaticamente; o seguinte exige essa confirmação explícita
ou o fluxo equivalente de ativação do servidor.

## Comportamento automático e restrições

- Perfil, provedores, modelos, idiomas, prompts, VAD, geração e retenção ficam fixados no início;
  edições posteriores valem para novas reuniões.
- Não há substituição silenciosa de provedor/modelo. Etapas locais não têm fallback para OpenRouter.
- Idioma do resumo e idioma do bot/interface são escolhas separadas; consulte
  [idiomas e prompts](../configuration.md#idiomas-e-prompts).
- A publicação exige transcrição completa. Falha de refinamento pode preservar a original;
  falha de resumo pode gerar post somente com transcrição.
- Queda de voz inicia reconexão automática. Recuperação após reinício também verifica propriedade,
  presença do bot e disponibilidade do canal antes de retomar.
- Troca de dono encerra gravação ativa e suspende novas gravações até confirmar a configuração.
  Saída do bot cancela reuniões não terminais; o histórico da instalação é preservado.
- Discord não expõe comando público de status, retry ou exclusão. Downloads, histórico, retenção,
  tarefas e administração pertencem aos respectivos fluxos de configuração/operação.
