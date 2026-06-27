export type CloudStatus = "draft" | "open" | "closed" | "archived";

export type Word = {
  id: string;
  text: string;
  normalized: string;
  count: number;
  createdAt: string;
  updatedAt: string;
};

export type NewWord = {
  id: string;
  text: string;
  normalized: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  visibleAt: string;
  deviceId: string;
};

export type Cloud = {
  id: string;
  title: string;
  publicTitle: string;
  status: CloudStatus;
  createdAt: string;
  archivedAt?: string | null;
  words: Word[];
};

export type SkySettings = {
  activeCloudId: string | null;
  rainAreaTitle: string;
  moderationDelaySeconds: number;
};