import type { TriageInput } from "../lib/ai/openRouterTriage";

/** Execution-only Portuguese (Brazil) cases. Labels and rationale live in the audit module. */
export const SEMANTIC_MERGE_PTBR_CASES = [
  {
    caseId: "PT01",
    input: {
      question: "Como motoristas podem saber se há vaga antes de entrar no estacionamento?",
      acceptedWords: [
        { id: "pt01-idea-a", text: "Instalar um painel na entrada que indique quantos espaços estão livres." },
        { id: "pt01-idea-b", text: "Exibir a lotação atual para que os condutores decidam se entram." },
        { id: "pt01-idea-c", text: "Permitir pagamento automático na saída." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "PT02",
    input: {
      question: "Como encontrar um lar temporário para cães resgatados?",
      acceptedWords: [
        { id: "pt02-idea-a", text: "Cadastrar famílias dispostas a acolher cães até a adoção definitiva." },
        { id: "pt02-idea-b", text: "Montar uma rede de lares provisórios para receber os cachorros resgatados." },
        { id: "pt02-idea-c", text: "Promover uma feira para adoção definitiva dos animais." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "PT03",
    input: {
      question: "Como cooperados podem reservar a colheitadeira compartilhada?",
      acceptedWords: [
        { id: "pt03-idea-a", text: "Manter um calendário de horários para agendar o uso da máquina agrícola." },
        { id: "pt03-idea-b", text: "Permitir que cada associado marque quando vai utilizar a colheitadeira da cooperativa." },
        { id: "pt03-idea-c", text: "Oferecer treinamento para operar a colheitadeira." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "PT04",
    input: {
      question: "Como permitir que pessoas recebam encomendas quando não estão em casa?",
      acceptedWords: [
        { id: "pt04-idea-a", text: "Colocar armários de retirada de pacotes em pontos do bairro." },
        { id: "pt04-idea-b", text: "Instalar lockers para os destinatários buscarem as encomendas depois." },
        { id: "pt04-idea-c", text: "Autorizar que o entregador deixe a caixa com um vizinho." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "PT05",
    input: {
      question: "Como ajudar pessoas com baixa visão a ler o cardápio de um restaurante?",
      acceptedWords: [
        { id: "pt05-idea-a", text: "Fazer o celular narrar os itens do menu depois de fotografá-lo." },
        { id: "pt05-idea-b", text: "Transformar em voz as opções do cardápio capturadas pela câmera do telefone." },
        { id: "pt05-idea-c", text: "Aumentar o contraste das letras na tela." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "PT06",
    input: {
      question: "Como moradores podem comunicar à prefeitura um buraco na rua no local?",
      acceptedWords: [
        { id: "pt06-idea-a", text: "Registrar no celular o defeito acompanhado de foto e coordenadas GPS." },
        { id: "pt06-idea-b", text: "Enviar pelo celular uma imagem georreferenciada do buraco para a prefeitura." },
        { id: "pt06-idea-c", text: "Ligar para o telefone geral e informar o endereço." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "PT07",
    input: {
      question: "Como ampliar a participação de cuidadores em reuniões de uma associação de bairro?",
      acceptedWords: [
        { id: "pt07-idea-a", text: "Oferecer recreação infantil durante os encontros." },
        { id: "pt07-idea-b", text: "Transmitir as reuniões por videoconferência." },
        { id: "pt07-idea-c", text: "Realizar encontros em horários alternados." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "PT08",
    input: {
      question: "Como um observatório astronômico pode atrair mais visitantes durante a semana?",
      acceptedWords: [
        { id: "pt08-idea-a", text: "Dar desconto nos ingressos de terça a quinta-feira." },
        { id: "pt08-idea-b", text: "Realizar sessões guiadas de observação nas noites de quarta." },
        { id: "pt08-idea-c", text: "Divulgar a programação em emissoras de rádio da região." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "PT09",
    input: {
      question: "Como tornar prédios públicos mais acessíveis para pessoas com mobilidade reduzida?",
      acceptedWords: [
        { id: "pt09-idea-a", text: "Garantir que pessoas com mobilidade reduzida consigam circular nos prédios públicos." },
        { id: "pt09-idea-b", text: "Instalar rampas nas entradas dos edifícios municipais." },
        { id: "pt09-idea-c", text: "Adaptar banheiros públicos com barras de apoio." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "PT10",
    input: {
      question: "Como diminuir o tempo de espera para embarcar em voos domésticos?",
      acceptedWords: [
        { id: "pt10-idea-a", text: "Abrir mais posições de inspeção de segurança nos horários de pico." },
        { id: "pt10-idea-b", text: "Permitir que passageiros façam o check-in pela internet antes de chegar." },
        { id: "pt10-idea-c", text: "Organizar grupos de embarque por fileira." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "PT11",
    input: {
      question: "Como evitar acidentes durante passeios turísticos de barco?",
      acceptedWords: [
        { id: "pt11-idea-a", text: "Exigir coletes salva-vidas para todos os passageiros." },
        { id: "pt11-idea-b", text: "Treinar a tripulação para agir em emergências." },
        { id: "pt11-idea-c", text: "Inspecionar as embarcações antes de cada saída." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "PT12",
    input: {
      question: "Como apoiar adultos que cursam o ensino médio e trabalham em turnos variáveis?",
      acceptedWords: [
        { id: "pt12-idea-a", text: "Criar turmas noturnas para quem trabalha durante o dia." },
        { id: "pt12-idea-b", text: "Disponibilizar aulas gravadas para estudantes cujo turno muda a cada semana." },
        { id: "pt12-idea-c", text: "Abrir uma sala de estudo aos domingos." },
      ],
      pendingWords: [],
    },
  },
] as const satisfies readonly Readonly<{ caseId: string; input: TriageInput }>[];
