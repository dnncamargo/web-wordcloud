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
