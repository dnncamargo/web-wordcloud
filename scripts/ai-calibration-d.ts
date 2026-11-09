import { CALIBRATION_C_INSTRUCTION } from "./ai-calibration-c";

export const CALIBRATION_D_INSTRUCTION = [
  CALIBRATION_C_INSTRUCTION,
  "Relevance must be a finite number from 0 through 1 inclusive; never use percentages or values outside that interval.",
  "Use only exact ids from acceptedWords in acceptedMergeSuggestions, and keep the two ids distinct.",
  "Never suggest the same pair twice, including with the ids reversed.",
  "Use an empty acceptedMergeSuggestions list when no equivalence is sufficiently clear.",
  "Set spellingSuggestion to null when the original text is already correctly written or no lexical correction is necessary.",
].join(" ");
