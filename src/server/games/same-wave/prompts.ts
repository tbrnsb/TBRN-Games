/**
 * Same Wave prompt pack — DRAFT FOR HUMAN REVIEW.
 *
 * These 24 prompts are original to TBRN-Games and must be reviewed by the
 * project owner before this branch is merged or released. Do not copy prompts
 * from another game.
 */
export interface SameWavePrompt {
  readonly id: string;
  readonly text: string;
  readonly options: {
    readonly a: string;
    readonly b: string;
  };
}

export const SAME_WAVE_PROMPTS: readonly SameWavePrompt[] = [
  {
    id: "wave-01",
    text: "A door appears in your room. Where does it lead?",
    options: { a: "A quiet beach", b: "A busy night market" },
  },
  {
    id: "wave-02",
    text: "Your phone can gain one feature forever. Which one?",
    options: { a: "A battery that lasts a week", b: "Perfect signal everywhere" },
  },
  {
    id: "wave-03",
    text: "You must give one up for a month. Which?",
    options: { a: "Streaming video", b: "Streaming music" },
  },
  {
    id: "wave-04",
    text: "A genie grants you one skill. Which?",
    options: { a: "Speak every language", b: "Play every instrument" },
  },
  {
    id: "wave-05",
    text: "You can teleport once a day. Where do you go?",
    options: { a: "Somewhere you have never been", b: "Home to your family" },
  },
  {
    id: "wave-06",
    text: "Which would you rather find in your attic?",
    options: { a: "A box of old letters", b: "A vintage arcade cabinet" },
  },
  {
    id: "wave-07",
    text: "Your home can have one impossible room. Which?",
    options: { a: "A rooftop observatory", b: "An indoor garden" },
  },
  {
    id: "wave-08",
    text: "Which sounds better on a rainy day?",
    options: { a: "A puzzle marathon", b: "A movie marathon" },
  },
  {
    id: "wave-09",
    text: "You get one wish for your neighborhood. Which?",
    options: { a: "More trees", b: "More street food" },
  },
  {
    id: "wave-10",
    text: "Which would you rather have?",
    options: { a: "A pet that talks", b: "A car that flies" },
  },
  {
    id: "wave-11",
    text: "Choose the better view from your window.",
    options: { a: "Mountains at sunrise", b: "A city at dusk" },
  },
  {
    id: "wave-12",
    text: "Which rule would you add to every party?",
    options: { a: "No phones at the table", b: "Everyone must try the snacks" },
  },
  {
    id: "wave-13",
    text: "You can master one thing instantly. Which?",
    options: { a: "Cooking any dish", b: "Fixing anything broken" },
  },
  {
    id: "wave-14",
    text: "Which power would improve your commute most?",
    options: { a: "Teleportation", b: "Freezing time" },
  },
  {
    id: "wave-15",
    text: "Pick a soundtrack for your week.",
    options: { a: "Upbeat pop", b: "Lo-fi beats" },
  },
  {
    id: "wave-16",
    text: "Which would you rather receive?",
    options: { a: "A surprise road trip", b: "A quiet weekend alone" },
  },
  {
    id: "wave-17",
    text: "Your town gets one new attraction. Which?",
    options: { a: "A giant library", b: "A year-round festival" },
  },
  {
    id: "wave-18",
    text: "Which would be harder to give up?",
    options: { a: "Coffee and tea", b: "Dessert" },
  },
  {
    id: "wave-19",
    text: "Pick the better robot helper.",
    options: { a: "One that cleans everything", b: "One that cooks everything" },
  },
  {
    id: "wave-20",
    text: "Which would you rather explore?",
    options: { a: "A coral reef", b: "A desert ruin" },
  },
  {
    id: "wave-21",
    text: "You must wear one color for a year. Which?",
    options: { a: "Forest green", b: "Deep blue" },
  },
  {
    id: "wave-22",
    text: "Which would make a better museum?",
    options: { a: "The history of games", b: "The history of food" },
  },
  {
    id: "wave-23",
    text: "Pick your ideal alarm sound.",
    options: { a: "Ocean waves", b: "Birdsong" },
  },
  {
    id: "wave-24",
    text: "Which would you rather win?",
    options: { a: "A year of free groceries", b: "A year of free travel" },
  },
];
