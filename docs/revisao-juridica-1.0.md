# Revisão técnica de licenças para a versão 1.0.0

**Revisão atualizada:** 5 de setembro de 2026
**Escopo:** código-fonte, dependências Node.js e Python, imagens Docker, FFmpeg/PyAV,
CUDA/cuDNN, ROCm, modelos baixados, avisos de terceiros e preparação do SBOM.
**Estado:** candidato tecnicamente preparado para o gate final; **tag e release ainda não
autorizadas**.

Este documento registra uma análise técnica de conformidade. Não é parecer jurídico e
não substitui a revisão futura por advogado escolhida pelo titular.

## Conclusão executiva

A estratégia do Summyz Community continua coerente como software **source-available**,
com uso não comercial permitido e direitos comerciais reservados ao titular. Ela não deve
ser divulgada como open source: a definição da Open Source Initiative não aceita restrição
à venda nem a campos de atividade.

Os bloqueios técnicos antes identificados em FFmpeg/PyAV, versões Python não
reproduzíveis, tags Docker mutáveis e ausência de avisos foram tratados neste candidato:

- FFmpeg 8.1.2 é compilado por receita própria, com fonte e checksum fixos, componentes
  GPL/nonfree e rede desativados e configuração LGPL 2.1-or-later;
- PyAV 18.1.0 é compilado do fonte e ligado dinamicamente às bibliotecas FFmpeg
  controladas, em vez de usar wheel que incorpora outro build;
- o grafo Python completo está em `requirements.lock`, com hashes;
- bases e serviços externos têm versão e digest fixos;
- `THIRD_PARTY_NOTICES.md`, instruções de instalação e checklist de release foram criados;
- o gerador de SBOM produz CycloneDX e SPDX, manifesto ligado ao commit e checksums, mas
  os documentos finais serão gerados somente no commit exato da release;
- modelos arbitrários continuam permitidos, com aviso ao operador e inventário de
  origem/revisão/digest/licença quando o provedor fornece esses dados.

A release planejada é **somente de código-fonte**. O projeto não distribuirá imagens
Summyz pré-compiladas na 1.0.0; cada operador construirá as imagens da aplicação e baixará
as imagens upstream fixadas. Essa escolha reduz o escopo de redistribuição binária pelo
titular, mas não elimina as obrigações do operador que redistribuir suas próprias imagens.

## Resultado por área

| Área | Resultado técnico | Observação restante |
| --- | --- | --- |
| Licença Summyz e CLAs | Textos principal em inglês, tradução informativa, lei brasileira sem foro exclusivo, CLA individual automatizado | Revisão jurídica profissional permanece recomendada, conforme decisão do titular |
| Node.js | Lockfile; dependências externas de produção com licenças permissivas detectadas | O SBOM final é a lista autoritativa, não a contagem deste relatório |
| Python | Oito dependências diretas atualizadas; 37 pacotes no lock universal com hashes; auditoria sem vulnerabilidades conhecidas | Regenerar e auditar no commit final |
| FFmpeg/PyAV | Build LGPL controlado, fonte preservada, PyAV compilado do fonte e ligado dinamicamente | Confirmar novamente `ffmpeg -L` no build final |
| Docker | Referências externas fixadas por versão e digest | Alguns digests fixam índices multi-arquitetura; cada arquitetura resolvida ainda exige build, teste e SBOM próprios |
| NVIDIA | CUDA 12.6.3/cuDNN em Ubuntu 24.04; licença NGC presente; build e GPU testados em RTX 2060 | Respeitar EULA/redistribuíveis; não publicar imagem derivada sem nova revisão |
| AMD | Ollama ROCm 0.33.3 fixado; imagem exata baixada e conteúdo ROCm 7.2 inspecionado | Hardware AMD/Linux ainda não foi testado e a imagem upstream não concentra todos os textos ROCm ao lado das bibliotecas |
| Modelos | Nenhum peso incluído; escolha irrestrita; aviso e inventário não bloqueante | Metadata pode faltar ou estar errada; a licença continua responsabilidade do operador |
| SBOM | Gerador e alvos preparados; formatos CycloneDX e SPDX, manifesto e SHA-256 | Gerar somente depois do commit final limpo e anexar à release |
| Segredos/histórico | Varredura de 21 commits sem achados; identidades usam noreply; `.env` ignorado | Repetir Gitleaks após o commit candidato e antes da publicação |
| Vulnerabilidades | Auditorias Node.js e Python atuais sem vulnerabilidades conhecidas | A varredura CVE das imagens ainda requer uma sessão autenticada no Docker Scout ou scanner equivalente |

## FFmpeg, PyAV e libopus

O script `docker/ffmpeg/build-lgpl.sh` baixa o tar oficial do FFmpeg 8.1.2 por HTTPS,
confere SHA-256 e habilita somente os codecs, formatos, filtros e protocolos necessários.
Ele usa `--disable-gpl`, `--disable-nonfree`, `--disable-autodetect`,
`--disable-network` e bibliotecas compartilhadas. A configuração resultante declarou
“LGPL version 2.1 or later” no build validado.

O tar, URL, checksum, argumentos de configuração, `COPYING.LGPLv2.1` e `LICENSE.md` são
copiados para `/opt/ffmpeg/share/source`. A imagem mantém libopus como biblioteca dinâmica,
com o arquivo de copyright do pacote do sistema. O teste sintético converteu PCM estéreo
para Ogg Opus e novamente para PCM float 16 kHz; a imagem Python decodificou o mesmo Ogg
por PyAV.

Essa arquitetura evita a wheel binária de PyAV que anteriormente podia carregar um build
FFmpeg diferente. Ela também preserva a possibilidade técnica de substituir as bibliotecas
dinâmicas. `THIRD_PARTY_NOTICES.md` aponta para fonte e termos. Desenvolvimento nativo não
usa esse build: cada desenvolvedor responde pelo FFmpeg instalado no host.

## Dependências Node.js e Python

O grafo Node de produção registrado no lockfile usa MIT, MIT-0, Apache-2.0,
BSD-3-Clause, ISC, 0BSD, BlueOak-1.0.0 e `MIT OR CC0-1.0`. A única entrada sem licença no
levantamento é o workspace privado do próprio dashboard, não uma dependência externa. Os
arquivos de licença dos pacotes permanecem em `node_modules` nas imagens construídas.

O lock Python contém, entre outros, MIT, BSD, Apache-2.0, MPL-2.0, PSF-2.0 e licenças de
runtimes incorporados pelo NumPy. A metadata instalada de `tokenizers` não normaliza a
licença, embora o projeto publique Apache-2.0; por isso o SBOM e os arquivos de licença da
distribuição devem prevalecer sobre uma tabela manual. A auditoria do lock atual não
encontrou vulnerabilidades conhecidas.

Licenças permissivas não significam ausência de condições: avisos de copyright,
atribuições, textos Apache/Mozilla e notices upstream devem ser preservados. O arquivo
`THIRD_PARTY_NOTICES.md` resume os grupos; os SBOMs finais listarão pacote e versão.

## Imagens Docker, CUDA e ROCm

As bases Debian/Ubuntu/Alpine contêm muitos pacotes, cada um com sua licença. A licença do
Dockerfile oficial não licencia a imagem inteira. O mesmo vale para PostgreSQL e Ollama:
PostgreSQL License e MIT cobrem esses projetos, não todos os componentes adicionados.

A variante Ollama CPU/NVIDIA incorpora runtimes CUDA 12 e 13, cuDNN, NCCL, OpenBLAS,
llama.cpp e outros componentes, além de arquivos de licença em `/usr/lib/ollama`. O target
faster-whisper CUDA contém o contrato NGC em `/NGC-DL-CONTAINER-LICENSE` e o aviso
fornecido pela imagem NVIDIA. Uso e eventual redistribuição precisam obedecer à EULA CUDA,
aos componentes redistribuíveis e à limitação a hardware compatível NVIDIA.

A variante Ollama ROCm exata contém bibliotecas ROCm 7.2, incluindo HIP, rocBLAS,
hipBLAS/hipBLASLt, rocSOLVER, COMGR e HSA Runtime. A AMD publica licenciamento por
componente, não uma licença única para toda a pilha. A imagem inspecionada preserva notices
do Ollama/llama.cpp e copyrights de pacotes Ubuntu, mas não apresenta um diretório único
com todos os textos das bibliotecas ROCm copiadas. Como a 1.0.0 apenas referencia a imagem
upstream por digest, o projeto não a republicará; ainda assim, um redistribuidor de imagem
deve coletar e cumprir os termos de cada componente.

Alguns digests atuais fixam índices OCI multi-arquitetura e outros fixam artefatos de uma
plataforma. A validação desta etapa ocorreu em Linux/amd64; em um índice, cada host resolve
um manifesto-filho diferente. Uma publicação para outra arquitetura precisa de build,
teste e SBOM próprios. Manter caminhos Linux/macOS/AMD no código não equivale a prometer
que todos foram testados nesta máquina. A documentação registra a matriz de validação sem
remover esses suportes.

## Modelos escolhidos pelo operador

Nenhum modelo é parte do repositório ou das imagens iniciais. O operador pode informar
qualquer ID aceito pelo Ollama ou Hugging Face/faster-whisper. Isso é importante para a
utilidade do Community, mas cria risco jurídico inevitável: pesos podem impor restrições
comerciais, territoriais, de uso, atribuição, redistribuição ou aceite separado.

O dashboard agora informa essa responsabilidade. Para Hugging Face, o sidecar grava ao
lado do modelo um inventário com ID, repositório, origem, revisão e licença declarada. Para
Ollama, o bot registra digest, família, formato, tamanho, quantização, data e hash do texto
de licença retornado, sem colocar o texto integral nos logs. Falha ou ausência de metadata
não bloqueia o modelo e não deve ser interpretada como permissão. O Hosted futuro precisa
de política própria e não está no escopo desta release Community.

## SBOM e avisos de terceiros

Um SBOM é uma lista de materiais de software: registra componentes, versões, identificadores
e licenças encontrados em um artefato. Seu valor depende de corresponder ao artefato exato.
Por isso, versionar agora um documento produzido de uma árvore ainda suja daria uma falsa
garantia.

`npm run release:sbom` recusa árvore Git suja por padrão, lê os alvos fixados em
`scripts/release/sbom-targets.json`, usa `npm sbom` para o grafo de produção da fonte e
Docker Scout para gerar CycloneDX e SPDX de cada imagem. Também cria `manifest.json` com
o commit e `SHA256SUMS`. A opção
`--allow-dirty --source-only` existe apenas para validar localmente o mecanismo. A pasta
`artifacts/sbom/` é ignorada pelo Git. No próximo estágio, os documentos deverão ser
regenerados no commit final e anexados à release 1.0.0.

## Gate restante para publicação

Esta etapa deliberadamente **não** torna o repositório público, cria tag ou cria release.
Antes da publicação:

1. executar toda a checklist em `docs/release-checklist.pt-BR.md` no commit final;
2. repetir testes, builds, auditorias de vulnerabilidades e Gitleaks;
3. validar fisicamente as plataformas disponíveis e declarar as lacunas restantes;
4. construir todos os alvos com os nomes esperados e gerar os SBOMs finais em árvore limpa;
5. comparar os SBOMs com `THIRD_PARTY_NOTICES.md` e resolver qualquer licença inesperada;
6. configurar proteções do repositório público e checks obrigatórios;
7. somente após aprovação explícita do titular, criar a tag verificada e a release 1.0.0.

A varredura CVE das imagens candidatas não foi concluída nesta máquina: o Docker Scout
permitiu gerar SBOM local, mas exigiu autenticação para consultar vulnerabilidades. A
release não deve avançar até que um scanner atualizado analise as imagens exatas e cada
achado alto ou crítico seja corrigido, justificado ou documentado.

## Fontes técnicas principais

- Open Source Definition: https://opensource.org/osd
- FFmpeg legal: https://ffmpeg.org/legal.html
- PyAV: https://github.com/PyAV-Org/PyAV
- NVIDIA CUDA EULA: https://docs.nvidia.com/cuda/eula/
- Licenciamento ROCm: https://rocm.docs.amd.com/en/latest/about/license.html
- PostgreSQL License: https://www.postgresql.org/about/licence/
- Ollama License: https://github.com/ollama/ollama/blob/main/LICENSE
- Docker Scout SBOM: https://docs.docker.com/reference/cli/docker/scout/sbom/
