/** First-run setup and the public-mode unlock screen. */
export const accessMessages = {
  setup: {
    addToServer: "Adicionar a um servidor",
    back: "Voltar",
    bot: "Bot",
    clientSecretLabel: "Client Secret",
    continue: "Continuar",
    copyRedirect: "Copiar URL de redirecionamento",
    discordHelp:
      "Developer Portal → sua aplicação → OAuth2 → Client Secret. Ele permite conectar a conta Discord do dono dos servidores; dá para fazer isso depois em Instalação.",
    discordLabel: "Conta do dono (opcional)",
    discordTitle: "Prepare a conexão do dono",
    doneHelpAfter: ".",
    doneHelpBefore: "Falta ativar um perfil de IA no servidor — é o que libera o",
    doneTitle: "Bot conectado",
    failures: {
      invalid_discord_bot_token: "Token recusado pelo Discord",
      invalid_setup_token:
        "O link privado de setup não confere. Abra de novo a URL impressa pelo launcher.",
      request_failed: "O setup não pôde ser concluído. Tente de novo em instantes.",
    },
    finish: "Concluir",
    finishing: "Concluindo…",
    goToDashboard: "Ir para o dashboard",
    localModeHelp:
      "No modo local o dashboard escuta só em 127.0.0.1 e não pede senha — por isso não existe o passo da senha aqui.",
    local: "Local",
    mode: "Modo",
    notConnected: "Não conectado",
    online: "Online",
    passwordGood: (length: number) => `Boa · ${String(length)} caracteres`,
    passwordHelp:
      "Uma senha por instalação — não existe conta de usuário. De 15 a 128 caracteres; uma frase longa vale mais que símbolos embaralhados.",
    passwordLabel: "Senha da instalação",
    passwordMinimum: "Mínimo 15",
    passwordPlaceholder: "uma frase que você lembre",
    passwordShort: (length: number) => `Curta · ${String(length)} de 15`,
    passwordTitle: "Escolha a senha desta instalação",
    public: "Público",
    publicConnectNotice:
      "Ao voltar do Discord, entre com a senha da instalação que você acabou de criar.",
    redirectLabel: "Cadastre esta URL em OAuth2 → Redirects",
    skip: "Pular por enquanto",
    skippedNotice:
      "Sem o Client Secret, nenhum servidor pode ser configurado. Salve-o depois em Instalação e conecte a conta do dono.",
    tokenHelp:
      "Developer Portal → sua aplicação → Bot → Reset Token. O Application ID é derivado dele.",
    tokenLabel: "Token do bot",
    tokenTitle: "Cole o token do bot",
    validating: "Validando no Discord…",
  },
  unlock: {
    attempt: (count: number) => `Tentativa ${String(count)}`,
    checking: "Verificando…",
    goToDashboard: "Ir para o dashboard",
    helpAfter: "no host.",
    helpBefore: "Senha da instalação, não de usuário. Esqueceu? Rode",
    lockoutHelp:
      "Bloqueio temporário deste endereço após tentativas seguidas. A instalação continua funcionando normalmente.",
    passwordLabel: "Senha da instalação",
    submit: "Entrar",
    title: "Desbloquear",
    unlocked: "Instalação desbloqueada",
    verifyFailed: "Não foi possível verificar a senha",
    waitToRetry: "Aguarde para tentar de novo",
    wrongPassword: "Senha incorreta",
  },
};
