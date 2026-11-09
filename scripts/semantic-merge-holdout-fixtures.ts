import type { TriageInput } from "../lib/ai/openRouterTriage";

/** Execution text for the independent semantic generalization matrix. */
export const SEMANTIC_MERGE_HOLDOUT_CASES = [
  {
    caseId: "H01",
    input: {
      question: "How can the regional archive let people explore historic photographs from home?",
      acceptedWords: [
        { id: "h01-idea-a", text: "Put scanned images on a public website." },
        { id: "h01-idea-b", text: "Make digitized photos viewable in an online collection." },
        { id: "h01-idea-c", text: "Mail printed reproductions to researchers." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "H02",
    input: {
      question: "How should commuters learn that a bus line has changed?",
      acceptedWords: [
        { id: "h02-idea-a", text: "Text riders when a route is revised." },
        { id: "h02-idea-b", text: "Send passengers an SMS about service changes." },
        { id: "h02-idea-c", text: "Hang printed detour maps inside bus shelters." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "H03",
    input: {
      question: "How can a small theater sell tickets before opening night?",
      acceptedWords: [
        { id: "h03-idea-a", text: "Let people purchase seats on the website in advance." },
        { id: "h03-idea-b", text: "Enable audiences to book theater seats online ahead of the show." },
        { id: "h03-idea-c", text: "Offer discounted tickets to students." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "H04",
    input: {
      question: "How can a repair café help people fix broken household appliances?",
      acceptedWords: [
        { id: "h04-idea-a", text: "Have volunteers fix broken kitchen appliances during monthly drop-in sessions." },
        { id: "h04-idea-b", text: "Host monthly volunteer-led appliance repair clinics." },
        { id: "h04-idea-c", text: "Publish do-it-yourself repair guides." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "H05",
    input: {
      question: "How can a riverside town encourage people to spend time along its waterfront?",
      acceptedWords: [
        { id: "h05-idea-a", text: "Add benches along the promenade." },
        { id: "h05-idea-b", text: "Plant shade trees near the walkway." },
        { id: "h05-idea-c", text: "Install lights beside the path." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "H06",
    input: {
      question: "How can a clinic help patients remember appointments?",
      acceptedWords: [
        { id: "h06-idea-a", text: "Send appointment reminders to patients by text message." },
        { id: "h06-idea-b", text: "Call patients the day before their visit." },
        { id: "h06-idea-c", text: "Give each patient a printed appointment card." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "H07",
    input: {
      question: "How can an old theater preserve its architectural heritage?",
      acceptedWords: [
        { id: "h07-idea-a", text: "Protect the building's historic character for future generations." },
        { id: "h07-idea-b", text: "Restore the original plasterwork in the main hall." },
        { id: "h07-idea-c", text: "Catalog and preserve the theater's historic posters." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "H08",
    input: {
      question: "How can a hotel reduce its water use?",
      acceptedWords: [
        { id: "h08-idea-a", text: "Fit showers with low-flow heads." },
        { id: "h08-idea-b", text: "Offer guests an opt-in linen-reuse program." },
        { id: "h08-idea-c", text: "Repair leaks promptly when maintenance staff find them." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "H09",
    input: {
      question: "How can a town help independent artists earn income?",
      acceptedWords: [
        { id: "h09-idea-a", text: "Organize a monthly craft market in the town square." },
        { id: "h09-idea-b", text: "Offer low-rent studios in unused municipal buildings." },
        { id: "h09-idea-c", text: "Create a grant program for new art installations." },
      ],
      pendingWords: [],
    },
  },
  {
    caseId: "H10",
    input: {
      question: "How can a data center use less electricity?",
      acceptedWords: [
        { id: "h10-idea-a", text: "Lower the facility's overall power consumption." },
        { id: "h10-idea-b", text: "Replace older servers with energy-efficient models." },
        { id: "h10-idea-c", text: "Use outside air to cool the server rooms." },
      ],
      pendingWords: [],
    },
  },
] as const satisfies readonly Readonly<{ caseId: string; input: TriageInput }>[];
