# ☁️ Nuvem Digital

> Uma plataforma colaborativa para coleta, curadoria e visualização de ideias em tempo real.

**Nuvem Digital** é uma aplicação web desenvolvida para atividades educacionais, brainstormings, oficinas e eventos, onde diversos participantes enviam ideias simultaneamente enquanto um moderador organiza, filtra e publica o conteúdo em uma nuvem de palavras dinâmica.

---

# Objetivos

* Incentivar a participação coletiva.
* Permitir moderação antes da publicação.
* Produzir uma visualização viva e agradável das ideias.
* Servir como ferramenta para professores, palestrantes e facilitadores.

---

# Tecnologias

* Next.js
* React
* TypeScript
* Firebase Authentication (futuro)
* Firebase Firestore
* Vercel

## Sessão administrativa de IA

O `/sky` é intencionalmente público e continua acessível aos professores. O controle `IA` permite criar uma sessão administrativa temporária e assinada com `Ativar IA`, sem alterar o acesso público ao painel. Configure duas variáveis fortes e independentes no ambiente do servidor:

```env
AI_ADMIN_PASSWORD=
AI_SESSION_SECRET=
```

Essas variáveis são exclusivamente server-only: não use prefixo `NEXT_PUBLIC_`, não as coloque no código do navegador e não as versione. A aplicação falha fechada quando qualquer uma delas está ausente. A sessão é armazenada apenas em cookie `HttpOnly`, tem validade de 8 horas e não é persistida no Firestore, `localStorage` ou `sessionStorage`.

A sessão protege somente a futura administração de IA e os endpoints pagos correspondentes; ela não concede nem aplica permissões do Firestore. As operações do Firestore executadas pelo navegador continuam autorizadas pelas Firebase Security Rules implantadas. A chave do OpenRouter permanece somente no ambiente do servidor: não existe entrada, armazenamento ou exposição dessa chave no navegador. Este checkpoint ainda não oferece endpoint de IA pago.

A proteção contra tentativas repetidas de login deverá receber rate limiting apropriado antes que qualquer endpoint de invocação paga seja habilitado. Este checkpoint não conclui a segurança do endpoint pago.

## Fundação de triagem por IA

A integração server-only com OpenRouter permanece sem rota pública até uma etapa futura. Quando for habilitada, configure apenas no ambiente do servidor:

```env
OPENROUTER_API_KEY=
OPENROUTER_MODEL=deepseek/deepseek-v4-flash-0731
```

A conta OpenRouter e a chave devem ter um limite baixo de gastos ou outro guardrail de orçamento.

### Harness local de avaliação comportamental

O harness `ai:evaluate` verifica o comportamento atual da triagem pedagógica com fixtures sintéticas versionadas. Ele é uma ferramenta de desenvolvimento, não uma certificação automatizada de segurança de moderação: não altera a UI, não usa Firestore, não executa ações de moderação, não cria integração HTTP e não persiste resultados. Os resultados comportamentais exigem interpretação humana.

O modo dry-run não faz chamadas de rede:

```bash
npm run ai:evaluate -- --dry-run
```

Uma execução real é explicitamente paga/de rede. `OPENROUTER_API_KEY` deve estar disponível no ambiente local do processo por meio do fluxo de gerenciamento de segredos do desenvolvedor. Nunca imprima, persista ou versione a chave. Em seguida, execute:

```bash
npm run ai:evaluate -- --allow-network
```

Use somente fixtures sintéticas. O harness invoca a implementação real de triagem em produção, mas não reescreve nem substitui o prompt de produção em tempo de execução. Os resultados comportamentais exigem revisão humana.

---

# Conceitos

## Evaporação

Tela utilizada pelos participantes.

Funções:

* enviar novas ideias;
* armazenar temporariamente as ideias localmente;
* enviar para o Firebase;
* exibir a animação das ideias evaporando.

A lista local pertence somente à nuvem ativa.

Quando uma nova nuvem é ativada, o armazenamento local incompatível é automaticamente descartado.

---

## Sky

Painel administrativo.

Responsável por:

* criar novas nuvens;
* editar perguntas investigadoras;
* editar títulos;
* aceitar ideias;
* recusar ideias;
* mesclar ideias semelhantes;
* editar palavras;
* remover palavras;
* ativar nuvens;
* arquivar nuvens.

Submissões cuja chave é exatamente equivalente pela normalização determinística existente podem ser autoagregadas à palavra aceita, preservando sua grafia canônica. Similaridade semântica continua reservada para uma futura sugestão de IA.

---

## Zona de Precipitação

Tela pública.

Exibe somente as ideias aprovadas.

Características:

* palavras flutuantes;
* tamanho proporcional à frequência;
* movimento contínuo;
* reorganização dinâmica da composição;
* indicação do clima atual.

---

# Estrutura do Firestore

```
settings
 └── global
      activeCloudId

clouds
 └── cloudId
      title
      publicTitle
      status

      words
           normalizedWord

      newWords
           pendingWord
```

---

# Estados da nuvem

## draft

Nuvem recém-criada.

Ainda está sendo preparada.

Não aparece na Zona de Precipitação.

---

## open

Nuvem ativa.

Recebe novas ideias.

É exibida na Zona de Precipitação.

Existe apenas uma nuvem aberta por vez.

---

## closed

Nuvem encerrada.

Foi substituída por outra.

Continua disponível para consulta e edição.

---

## archived

Nuvem arquivada.

Não participa das atividades.

Pode ser restaurada posteriormente.

---

# Fluxo

```
Participante

↓

Evaporação

↓

Firebase

↓

Sky

↓

Aceitar
Recusar
Mesclar

↓

Zona de Precipitação
```

---

# Evolução do Projeto

## v0.1

Inicialização

* criação do projeto Next.js
* configuração do Vercel
* configuração do Firebase

---

## v0.2

Primeira arquitetura

Implementação dos conceitos:

* Cloud
* Word
* Sky

---

## v0.3

Evaporação

* armazenamento local
* envio para Firebase
* limpeza automática quando muda a nuvem ativa

---

## v0.4

Sky

Primeira versão do painel administrativo.

* criação de nuvens
* ativação
* arquivamento
* aprovação
* rejeição

---

## v0.5

Palavras

* contagem de ocorrências
* edição
* remoção
* mesclagem
* aliases

---

## v0.6

Rain Area

Primeira visualização pública.

* palavras em tempo real
* tamanhos diferentes
* clima atual

---

## v0.7

Nova experiência visual

Evaporação:

* painel minimalista
* animação das palavras subindo
* armazenamento local vinculado à nuvem

Zona de Precipitação:

* tela quase integral
* palavras flutuantes
* reorganização dinâmica
* rotações calculadas

Sky:

* três colunas
* edição inline
* interface simplificada
* gerenciamento completo das nuvens
* reordenação das ideias (Ventar)

---

# Roadmap

## Interface

* [ ] Drag and Drop para mesclagem
* [ ] Busca de palavras
* [ ] Ordenação por frequência
* [ ] Tema escuro
* [ ] Atalhos de teclado

---

## Moderação

* [ ] Filtro automático de palavrões
* [ ] Lista negra personalizada
* [ ] Aprovação em lote
* [ ] Histórico de ações

---

## Zona de Precipitação

* [ ] Algoritmo sem sobreposição
* [ ] Distribuição baseada em ocupação real
* [ ] Física de flutuação
* [ ] Reação à velocidade das novas ideias
* [ ] Chuva de partículas

---

## Participantes

* [ ] Identificação opcional
* [ ] Avatar
* [ ] Histórico pessoal
* [ ] Estatísticas

---

## Administração

* [ ] Duplicar nuvem
* [ ] Exportar nuvem
* [ ] Importar nuvem
* [ ] Backup automático
* [ ] Histórico de versões

---

## Inteligência Artificial

* [ ] Sugestão automática de mesclagem
* [ ] Correção ortográfica
* [ ] Agrupamento semântico
* [ ] Geração automática de categorias
* [ ] Resumo das ideias

---

# Filosofia do projeto

A Nuvem Digital foi concebida para transformar uma simples nuvem de palavras em uma metáfora meteorológica completa.

As ideias evaporam.

As nuvens armazenam.

O moderador controla o céu.

As palavras precipitam sobre a tela.

O clima muda conforme a participação das pessoas.

A tecnologia permanece em segundo plano para destacar a experiência colaborativa.
