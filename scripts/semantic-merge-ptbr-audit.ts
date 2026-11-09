/** Labels and semantic-boundary review, kept separate from execution text. */
export const SEMANTIC_MERGE_PTBR_AUDIT = [
  {
    caseId: "PT01",
    domain: "gestão de estacionamento",
    semanticPattern: "paráfrase de baixa similaridade lexical",
    category: "positive",
    expectedPairs: [["pt01-idea-a", "pt01-idea-b"]],
    justification: "As duas propostas exibem na entrada a disponibilidade atual de vagas para orientar a decisão do motorista. Pagamento automático resolve a cobrança, não informa a lotação.",
    semanticBoundary: "Painel de vagas livres e exibição da lotação cumprem a mesma ação de informar disponibilidade antes da entrada; automatizar a saída tem outro momento e finalidade.",
  },
  {
    caseId: "PT02",
    domain: "acolhimento animal",
    semanticPattern: "sinônimos para cuidado temporário",
    category: "positive",
    expectedPairs: [["pt02-idea-a", "pt02-idea-b"]],
    justification: "As duas ideias formam uma rede de famílias que acolhe temporariamente cães resgatados até que encontrem adoção definitiva. Uma feira de adoção busca diretamente o lar permanente.",
    semanticBoundary: "Acolhimento temporário e rede de lares provisórios descrevem o mesmo serviço intermediário. Adoção definitiva tem outro compromisso e outra duração.",
  },
  {
    caseId: "PT03",
    domain: "cooperativa agrícola",
    semanticPattern: "reserva compartilhada em construções distintas",
    category: "positive",
    expectedPairs: [["pt03-idea-a", "pt03-idea-b"]],
    justification: "As duas propostas organizam horários para que associados reservem a mesma colheitadeira compartilhada. Treinar operadores é uma atividade diferente do agendamento.",
    semanticBoundary: "Calendário e marcação individual representam o mesmo sistema de reserva do equipamento; treinamento altera a ação e o resultado pretendido.",
  },
  {
    caseId: "PT04",
    domain: "entrega de encomendas",
    semanticPattern: "sinônimos e empréstimo lexical",
    category: "positive",
    expectedPairs: [["pt04-idea-a", "pt04-idea-b"]],
    justification: "As duas ideias criam armários de autoatendimento para que destinatários retirem encomendas quando não estão em casa. Deixar o pacote com um vizinho depende de outra pessoa e de outra forma de entrega.",
    semanticBoundary: "Pontos e lockers descrevem o mesmo serviço de retirada em compartimentos. A retirada assistida por um vizinho altera o meio e a dependência operacional.",
  },
  {
    caseId: "PT05",
    domain: "acessibilidade em restaurantes",
    semanticPattern: "captura de texto e narração",
    category: "positive",
    expectedPairs: [["pt05-idea-a", "pt05-idea-b"]],
    justification: "As duas ideias usam a câmera do telefone para converter em fala as opções do cardápio. Alterar o contraste da tela é um recurso visual distinto.",
    semanticBoundary: "Narrar e transformar em voz se referem à mesma conversão de texto capturado em áudio; aumentar contraste não produz uma narração.",
  },
  {
    caseId: "PT06",
    domain: "zeladoria municipal",
    semanticPattern: "registro móvel georreferenciado",
    category: "positive",
    expectedPairs: [["pt06-idea-a", "pt06-idea-b"]],
    justification: "As duas ideias permitem registrar pelo celular o mesmo problema na rua junto com sua localização para a prefeitura. A ligação telefônica comunica o endereço por outro canal e sem o mesmo registro georreferenciado.",
    semanticBoundary: "Aplicativo e envio móvel da imagem descrevem o registro digital com evidência e localização; uma chamada ao telefone geral muda o meio e os dados entregues.",
  },
  {
    caseId: "PT07",
    domain: "participação de cuidadores",
    semanticPattern: "ações complementares para um objetivo comum",
    category: "negative",
    expectedPairs: [],
    justification: "Recreação infantil, participação por vídeo e horários alternados são medidas diferentes para facilitar a presença de cuidadores.",
    semanticBoundary: "Compartilhar o objetivo de ampliar participação não torna as iniciativas duplicatas: uma oferece cuidado, outra muda o canal e outra altera o horário.",
  },
  {
    caseId: "PT08",
    domain: "turismo científico",
    semanticPattern: "programação, preço e divulgação relacionados",
    category: "negative",
    expectedPairs: [],
    justification: "Desconto, sessão guiada em uma noite específica e divulgação por rádio são medidas distintas para atrair visitantes.",
    semanticBoundary: "Preço, programação e canal de divulgação alteram a ação e o compromisso concreto; nenhuma medida substitui as outras.",
  },
  {
    caseId: "PT09",
    domain: "acessibilidade arquitetônica",
    semanticPattern: "objetivo geral versus implementações específicas",
    category: "negative",
    expectedPairs: [],
    justification: "A primeira ideia expressa o objetivo amplo de circulação acessível. Rampas nas entradas e barras de apoio em banheiros são implementações distintas desse objetivo.",
    semanticBoundary: "Um objetivo geral não é duplicata de cada possível obra que pode contribuir para ele; as duas obras também não são intercambiáveis.",
  },
  {
    caseId: "PT10",
    domain: "operações aeroportuárias",
    semanticPattern: "implementações diferentes para reduzir espera",
    category: "negative",
    expectedPairs: [],
    justification: "Mais posições de inspeção, check-in antecipado pela internet e grupos de embarque por fileira são intervenções diferentes para reduzir espera.",
    semanticBoundary: "O resultado pretendido em comum não elimina diferenças de etapa, ação e responsabilidade; nenhuma proposta substitui as outras sem mudar o plano.",
  },
  {
    caseId: "PT11",
    domain: "segurança náutica",
    semanticPattern: "ações complementares de prevenção",
    category: "negative",
    expectedPairs: [],
    justification: "Coletes, treinamento da tripulação e inspeções antes da saída são medidas de segurança complementares.",
    semanticBoundary: "Cada uma controla um risco por uma ação própria; adotar uma não significa adotar nem substituir as demais.",
  },
  {
    caseId: "PT12",
    domain: "educação de adultos",
    semanticPattern: "diferenças de formato, horário e condição",
    category: "negative",
    expectedPairs: [],
    justification: "Turmas noturnas, aulas gravadas para turnos variáveis e sala de estudo aos domingos atendem necessidades diferentes.",
    semanticBoundary: "As propostas diferem em formato, horário e condição de participação. O objetivo amplo de apoiar estudantes trabalhadores não as torna duplicatas.",
  },
] as const satisfies readonly Readonly<{
  caseId: string;
  domain: string;
  semanticPattern: string;
  category: "positive" | "negative";
  expectedPairs: readonly (readonly [string, string])[];
  justification: string;
  semanticBoundary: string;
}>[];
