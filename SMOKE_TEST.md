# Smoke test de gravação e transcrição

Este teste valida `opusscript` antes de considerar um decodificador nativo.
Também valida a transcrição de uma call real em pt-BR, incluindo falas sobrepostas.

## Preparação

1. Use um servidor exclusivo de teste e avise todos os participantes sobre a gravação.
2. Configure `.env` com `DISCORD_GUILD_ID` para o servidor de teste.
3. Execute `npm run dev` e preserve a saída do terminal.
4. Autorize o cargo de teste com `/recording-role add`.
5. Configure `OPENROUTER_API_KEY` e um `OPENROUTER_TRANSCRIPTION_MODEL` que possua uma entrada
   correspondente em `config/transcription-model-profiles.json`.

## Cenários

Execute uma gravação de pelo menos cinco minutos em cada cenário:

1. duas pessoas alternando a fala;
2. duas pessoas falando ao mesmo tempo em alguns trechos;
3. cinco pessoas alternando e sobrepondo falas;
4. uma pessoa entrando depois do início e outra saindo antes do fim;
5. todos saindo sem usar `/stop`.

Durante os cenários, confirme que cada participante autorizado consegue usar os comandos nas
condições documentadas e que bots não geram segmentos.

## O que medir

Os logs `Métricas da gravação`, emitidos a cada dez segundos, contêm:

- `processCpuPercentSingleCore`: CPU média do processo desde o início, em percentual equivalente a
  um núcleo;
- `rssBytes`: memória total residente;
- `heapUsedBytes`: heap utilizado pelo Node.js;
- `activeCaptures`: participantes capturados naquele instante.

Cada log `Segmento de áudio finalizado` e cada segmento do `manifest.json` contêm:

- `receivedOpusPackets`: pacotes Opus recebidos;
- `estimatedPacketLossPercent`: estimativa de pacotes ausentes.

A perda é uma estimativa porque a API pública de recepção usada pelo bot não fornece os números de
sequência RTP. Confirme qualquer valor alto ouvindo o arquivo correspondente e comparando com a
qualidade percebida pelos participantes na call.

## Resultado esperado

- um arquivo Ogg reproduzível para cada trecho falado;
- nenhuma troca de áudio entre participantes;
- nenhum segmento vazio ou arquivo PCM, salvo quando a conversão falhar;
- encerramento imediato quando o canal ficar sem pessoas;
- ausência de erros de decodificação e de falhas recorrentes de captura;
- CPU sem saturação sustentada do núcleo e sem crescimento contínuo de memória;
- ausência de cortes audíveis não presentes na call.

Só substitua `opusscript` se o cenário com cinco participantes apresentar saturação sustentada,
erros de decodificação ou cortes reproduzíveis atribuíveis ao decoder. Uma estimativa isolada de
perda não basta, pois também pode refletir a rede ou o comportamento de detecção de fala do Discord.

Registre a máquina, a duração, o número de participantes, o pico e a média aproximada de CPU e
memória, os segmentos com maior perda estimada e qualquer falha audível. Não inclua áudio real no
Git.

## Validação da transcrição

Use pelo menos duas pessoas e prepare um roteiro curto com:

1. cada pessoa dizendo uma frase sem sobreposição;
2. uma pessoa falando uma frase longa enquanto a outra faz uma intervenção no meio;
3. ambas iniciando frases aproximadamente ao mesmo tempo;
4. uma pausa e uma fala final de cada participante.

Inclua também uma resposta real bem curta, como “sim” ou “tá”, e alguns segundos de ruído sem fala.
Isso verifica simultaneamente se o VAD preserva intervenções curtas e se o modelo não inventa texto
para áudio não verbal.

Encerre primeiro com `/stop` e repita em outra reunião saindo do canal sem usar o comando. Nos dois
casos, aguarde o log `Transcrição da reunião concluída` e confira:

- existência de `data/recordings/<meetingId>/transcript.txt`;
- uma linha legível por trecho, com início, fim e nome correto;
- nomes iguais desambiguados com `#1`, `#2` e assim por diante;
- ordem cronológica pelo início das falas;
- intervalos coincidentes nos trechos realmente sobrepostos;
- ausência de `userId`, detalhes internos, conteúdo inventado ou falas atribuídas à pessoa errada;
- presença da resposta curta real e ausência de texto para o ruído sem fala;
- coerência do texto com o áudio ouvido pelos participantes.

Uma reunião só passa no critério quando todos os segmentos estão `completed` em
`transcription.json` e o arquivo final representa corretamente as falas alternadas e sobrepostas.
Segmentos descartados pelo VAD aparecem como `completed`, com `attempts: 0` e `pieces: []`. Nos
lotes consolidados, somente intervalos com voz são enviados; seus timestamps são remapeados antes
de a origem temporal ser persistida no segmento representante.
Quando `mistralai/voxtral-mini-transcribe` estiver configurado, valide também que uma linha pode
cobrir o lote consolidado inteiro: o OpenRouter fornece somente o texto desse modelo, então o
intervalo representa o primeiro ao último trecho real de voz do lote, sem precisão por palavra.
Quando `deepgram/nova-3` estiver configurado, confirme que o perfil insere 350 ms entre intervalos de
voz sem deslocar os timestamps finais da reunião. Trocar entre Nova-3 e Whisper não deve exigir nem
alterar configurações internas do outro perfil.
Não adicione ao Git o áudio, `transcription.json` ou `transcript.txt` produzidos no teste.

## Cenário de falha controlada

1. configure temporariamente um modelo sem entrada no arquivo de perfis;
2. confirme que o processo falha antes de se conectar ao Discord e não inicia uma gravação;
3. restaure o modelo correto antes de qualquer outro teste.

Retries e falhas terminais do provedor são validados por testes automatizados com dados sintéticos,
sem enviar uma call real deliberadamente para uma configuração inválida.

A exclusão automática após 24 horas pode ser validada em ambiente descartável reduzindo
temporariamente `FAILED_RECORDING_RETENTION_HOURS`; não reduza a retenção no ambiente que contém
gravações reais.
