# Checklist de release

Esta checklist foi preparada para a 1.0.0, mas deverá ser executada novamente no commit
final exato. Concluir a preparação não autoriza publicar uma tag ou release no GitHub.

## Escopo e repositório

- [ ] Confirmar o commit pretendido e a versão em todos os `package.json`.
- [ ] Confirmar que a árvore está limpa e que o branch contém somente alterações revisadas.
- [ ] Confirmar que a documentação pública usa **source-available**, e não open source.
- [ ] Revisar em conjunto `LICENSE.md`, `NOTICE.md`, `TRADEMARKS.md`, CLAs, política de
      contribuição e `THIRD_PARTY_NOTICES.md`.
- [ ] Confirmar que ainda não existe tag ou release `1.0.0`.

## Reprodutibilidade e dependências

- [ ] Executar `npm ci` em um checkout limpo.
- [ ] Recompilar `requirements.lock` apenas ao atualizar deliberadamente dependências
      Python; revisar todo o diff e os hashes.
- [ ] Verificar que cada referência Docker externa mantém versão e digest aprovados.
- [ ] Construir as tags de release do bot, dashboard, faster-whisper CPU e CUDA listadas em
      `scripts/release/sbom-targets.json`.

  ```console
  docker build --target bot-runtime --tag summyz-community-bot:release .
  docker build --target dashboard-runtime --tag summyz-community-dashboard:release .
  docker build --file services/faster-whisper/Dockerfile --target cpu --tag summyz-community-faster-whisper:release-cpu .
  docker build --file services/faster-whisper/Dockerfile --target cuda --tag summyz-community-faster-whisper:release-cuda .
  ```

- [ ] Confirmar que FFmpeg declara LGPL 2.1-or-later, que o checksum registrado corresponde
      ao arquivo-fonte e que nenhuma opção GPL/nonfree está ativa.

## Testes e segurança

- [ ] Executar `npm run check`.
- [ ] Executar `npm run build`.
- [ ] Executar `npm run security:audit` e auditoria Python contra `requirements.lock`.
- [ ] Analisar cada imagem exata da release com uma base de vulnerabilidades atualizada;
      corrigir, justificar ou documentar cada achado alto ou crítico.
- [ ] Executar o smoke test de IA local em cada caminho de hardware disponível.
- [ ] Registrar nas notas as combinações de SO/GPU não testadas, sem remover suporte em
      silêncio.
- [ ] Executar Gitleaks na árvore atual e em todo o histórico Git.
- [ ] Inspecionar manualmente staged files, `.env.example`, logs, imagens, fixtures e
      identidades Git em busca de credenciais ou dados pessoais.

## Evidências jurídicas e SBOM

- [ ] Inspecionar notas e termos atuais das bases Docker, PostgreSQL, Ollama, NVIDIA
      CUDA/cuDNN e AMD ROCm.
- [ ] Revisar os modelos padrão escolhidos e seus termos atuais. Os pesos não são incluídos,
      e modelos arbitrários continuam sob responsabilidade do operador.
- [ ] No commit final limpo, executar `npm run release:sbom`.
- [ ] Confirmar que todos os arquivos CycloneDX e SPDX são JSON válido.
- [ ] Confirmar que `manifest.json` aponta para o commit final e contém `"dirty": false`.
- [ ] Conferir cada linha de `SHA256SUMS` contra os arquivos gerados.
- [ ] Comparar as licenças do SBOM com `THIRD_PARTY_NOTICES.md`; atualizar avisos antes da
      tag se os artefatos divergirem.

## Publicação — adiada para a etapa de release

- [ ] Tornar o repositório público somente após aprovação do diff final pelo titular.
- [ ] Configurar proteção de branch e checks obrigatórios.
- [ ] Criar a tag anotada `1.0.0`, assinada ou verificada, no commit aprovado.
- [ ] Criar a release no GitHub com notas, lacunas conhecidas de validação, arquivos-fonte,
      todos os SBOMs, `manifest.json` e `SHA256SUMS`.
- [ ] Baixar os artefatos publicados e validar seus checksums de forma independente.
- [ ] Fazer uma instalação limpa usando somente as instruções públicas da release.
- [ ] Documentar rollback ou retirada antes de anunciar a versão.
