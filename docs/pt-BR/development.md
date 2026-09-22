# Desenvolvimento e qualidade

[English](../development.md) · [Início da documentação](./README.md)

## Qualidade

Use `npm run check` antes de enviar mudanças. Esse comando valida formatação, lint, tipos, testes e
cobertura. Use `npm run security:audit` para verificar as dependências.

O decodificador Opus do MVP é `opusscript`, evitando a cadeia vulnerável encontrada na dependência
nativa avaliada. O smoke test dos serviços locais é automatizado e executado dentro da rede privada
com `docker compose --profile smoke run --rm smoke`; ele baixa modelos pequenos e pode demorar na
primeira execução. Interações reais no Discord não são apresentadas como teste automatizado.

O benchmark de faster-whisper usa `transcript.raw.txt` como referência, calcula WER, CER, tempo e
fator de tempo real, e não inclui o conteúdo das reuniões no relatório. Configure
`BENCHMARK_DEVICE`, `BENCHMARK_BATCH_SIZE` e `BENCHMARK_MODEL`, depois execute
`docker compose --profile benchmark run --rm benchmark`. Ele só mede reuniões
que ainda possuem todos os áudios.

## Integração contínua

O workflow `CI` é executado em pull requests para `main` e após merges, por meio do evento de push
em `main`. Os jobs aparecem diretamente como `CI / Quality`, `CI / Security`, `CI / Tests`,
`CI / Runtime / Images`, `CI / Quality Gate / Analysis` e `CI / Quality Gate`. `Analysis` reúne os
relatórios dos quatro primeiros jobs, publica o resumo e atualiza o baseline após um merge.
`Quality Gate` aplica o resultado agregado e atualiza o comentário persistente nos pull requests
internos. Um commit novo cancela a execução anterior do mesmo pull request; as execuções em `main`
podem ocorrer em paralelo e não cancelam umas às outras. O bloqueio de pushes diretos em `main`
depende da proteção configurada no GitHub.

Os testes do servidor sempre usam PostgreSQL 18.4 real. Servidor, dashboard e serviço Python
precisam atingir pelo menos 85% de cobertura global por linhas e 85% em cada grupo de domínio. A
cobertura do código novo ou modificado é calculada uma vez, como agregado ponderado por linhas dos
três componentes, e também precisa atingir 85%. Relatórios HTML, JUnit, JSON e SARIF ficam
disponíveis como artefatos, além do resumo da execução. Pull requests internos recebem um único
comentário persistente do Quality Gate, integralmente em inglês e atualizado a cada execução; pull
requests de forks recebem os mesmos checks, resumo e artefatos sem precisar expor secrets nem
conceder permissão de escrita.

A medida `Security` contabiliza somente vulnerabilidades únicas `HIGH` ou `CRITICAL` que tenham
correção disponível. Esses achados reprovam o gate. Achados de severidade inferior e
vulnerabilidades para as quais ainda não foi publicada uma correção não entram na medida nem
reprovam o gate, mas continuam visíveis junto às issues de qualidade e segurança em `Issue details`
e nos artefatos completos.

O gate de runtime constrói as imagens do bot, dashboard, faster-whisper para CPU e o pacote NVIDIA,
valida as variantes Compose e executa uma inferência local real em CPU com revisões verificadas dos
modelos. A execução em uma GPU real fica fora deste workflow. Node.js 22.23.2, npm 10.9.8, Python
3.12.14, imagens-base, actions, locks e snapshots dos repositórios Debian/Ubuntu estão fixados. O
runner `ubuntu-24.04` e as bases de vulnerabilidades dos scanners permanecem serviços atualizados
do GitHub e dos fornecedores. Caches de npm, pip, BuildKit e modelos reduzem as execuções seguintes
sem dispensar as verificações de versão, hash e digest.
