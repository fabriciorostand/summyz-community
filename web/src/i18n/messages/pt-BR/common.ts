/** Shared words, the shell and states every screen uses. */
export const commonMessages = {
  common: {
    back: "Voltar",
    cancel: "Cancelar",
    help: "Ajuda",
    loading: "Carregando…",
    retry: "Tentar novamente",
    tryAgain: "Tentar de novo",
  },
  app: {
    preparing: "Preparando o Summyz Community…",
    unreachableBody:
      "O dashboard não conseguiu consultar a API. Isso não afeta as gravações em andamento.",
    unreachableTitle: "Não foi possível falar com o servidor",
  },
  states: {
    addBack: "Adicionar o bot",
    discordNotConnectedBody:
      "Configurar servidores e perfis exige a conta Discord do dono conectada. Conecte-a em Instalação.",
    discordNotConnectedTitle: "Conta do dono não conectada",
    discordRateLimitedBody:
      "O Discord pediu uma pausa nas consultas. Aguarde alguns segundos e tente de novo.",
    discordRateLimitedTitle: "Discord pediu uma pausa",
    guildRemovedBody:
      "precisa estar com o bot instalado e pertencer à conta Discord conectada. As calls e as configurações continuam salvas.",
    guildRemovedThisServer: "Este servidor",
    guildRemovedTitle: "Este servidor não pode ser configurado",
    installBot: "Adicionar o bot a um servidor",
    noServerBody:
      "Autorize o bot em um servidor do Discord. Ele aparece aqui sozinho, sem precisar cadastrar nada.",
    noServerTitle: "O bot ainda não está em nenhum servidor",
    sessionExpiredBody:
      "A sessão cai após 7 dias sem uso, ou 30 dias no total. Digite a senha da instalação para continuar.",
    sessionExpiredTitle: "Sua sessão expirou",
    openInstallation: "Ir para Instalação",
    unlock: "Desbloquear",
    viewServers: "Ver servidores",
  },
  discordConnect: {
    connect: "Conectar conta Discord",
    connecting: "Abrindo o Discord…",
    failures: {
      discord_bot_not_configured: "Configure o token do bot antes de conectar a conta.",
      discord_client_secret_missing: "Salve o Client Secret da aplicação antes de conectar.",
      discord_rate_limited: "O Discord pediu uma pausa. Tente de novo em alguns segundos.",
      request_failed: "Não foi possível abrir a autorização do Discord. Tente de novo.",
    },
  },
  nav: {
    calls: "Calls",
    closeMenu: "Fechar menu",
    commands: "Comandos",
    configuration: "Configuração",
    installation: "Instalação",
    meetings: "Reuniões",
    navigation: "Navegação",
    openMenu: "Abrir menu de navegação",
    overview: "Visão geral",
    preferences: "Preferências",
    profiles: "Perfis de IA",
    servers: "Servidores",
    system: "Sistema",
    tasks: "Tarefas",
  },
  routeError: {
    body: "O painel pode ter sido atualizado enquanto estava aberto. Recarregue a página para continuar.",
    heading: "Tela indisponível",
    reload: "Recarregar",
    title: "Não foi possível abrir esta tela",
  },
  topBar: {
    guild: "Servidor",
    language: "Idioma do dashboard",
    useDarkTheme: "Usar tema escuro",
    useLightTheme: "Usar tema claro",
  },
  pipeline: {
    completed: "Concluída",
    failed: "Falhou",
    inProgress: "Em andamento",
  },
  stages: {
    help: {
      refinement: "Revisa a transcrição e corrige erros evidentes, sem resumir nem traduzir.",
      summary: "Encontra decisões e tarefas e escreve o resumo publicado no Discord.",
      transcription: "Converte a fala de cada participante em texto, com horário e autor.",
    },
    titles: {
      refinement: "Refinamento",
      summary: "Resumo",
      transcription: "Transcrição",
    },
  },
};
