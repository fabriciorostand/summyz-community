# Catálogo de benchmarks locais

## Inventário inicial — 26/08/2026

- Hardware: NVIDIA GeForce RTX 2060 com 6 GiB de VRAM, Intel Core i5-10400F, 12 threads lógicas e
  aproximadamente 16 GiB de RAM.
- Fonte de verdade: `transcript.raw.txt` de cada reunião.
- Reuniões encontradas: 5.
- Reuniões mensuráveis: 0.
- Motivo: os segmentos de áudio já tinham sido removidos conforme `PERSIST_MEETING_AUDIO=false`.

Não há estimativa de aceleração registrada nesta rodada, pois comparar somente arquivos de texto
não mede inferência e produziria um número enganoso. O script `benchmark:transcription` registra
WER, CER, duração, tempo decorrido e fator de tempo real assim que houver uma gravação com áudio
preservado. Os identificadores de reunião são anonimizados no relatório e o texto transcrito não é
incluído.
