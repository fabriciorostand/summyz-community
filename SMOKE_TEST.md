# Smoke test de gravação

Este teste valida `opusscript` antes de considerar um decodificador nativo.

## Preparação

1. Use um servidor exclusivo de teste e avise todos os participantes sobre a gravação.
2. Configure `.env` com `DISCORD_GUILD_ID` para o servidor de teste.
3. Execute `npm run dev` e preserve a saída do terminal.
4. Autorize o cargo de teste com `/recording-role add`.

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
