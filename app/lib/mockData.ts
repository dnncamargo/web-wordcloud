import type { Cloud, SkySettings } from "../types/cloud";

const now = new Date().toISOString();

export const skySettings: SkySettings = {
  activeCloudId: "cloud-001",
  rainAreaTitle: "Clima Agora: Chuva de Ideias",
  moderationDelaySeconds: 5,
};

export const clouds: Cloud[] = [
  {
    id: "cloud-001",
    title: "Aula de Robótica - Sustentabilidade",
    publicTitle: "O que torna uma cidade mais sustentável?",
    status: "open",
    createdAt: now,
    archivedAt: null,
    words: [
      {
        id: "word-001",
        text: "energia solar",
        normalized: "energia solar",
        count: 8,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "word-002",
        text: "reciclagem",
        normalized: "reciclagem",
        count: 6,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "word-003",
        text: "árvores",
        normalized: "arvores",
        count: 4,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "word-004",
        text: "robótica",
        normalized: "robotica",
        count: 3,
        createdAt: now,
        updatedAt: now,
      },
    ],
  },
];