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
    addBack: "Adicionar de volta",
    guildRemovedBody:
      "saiu da lista porque o bot foi removido de lá. As calls e as configurações continuam no banco e reaparecem se ele for adicionado de novo.",
    guildRemovedThisServer: "Este servidor",
    guildRemovedTitle: "O bot não está mais neste servidor",
    installBot: "Adicionar o bot a um servidor",
    noServerBody:
      "Autorize o bot em um servidor do Discord. Ele aparece aqui sozinho, sem precisar cadastrar nada.",
    noServerTitle: "O bot ainda não está em nenhum servidor",
    sessionExpiredBody:
      "A sessão cai após 7 dias sem uso, ou 30 dias no total. Digite a senha da instalação para continuar.",
    sessionExpiredTitle: "Sua sessão expirou",
    unlock: "Desbloquear",
    viewServers: "Ver servidores",
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
