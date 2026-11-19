/**
 * Synthetic creator workspace and search scenarios for Slate's retrieval benchmark (M5.0).
 * Content is invented; it never comes from real creators.
 */

export interface BenchPost {
  key: string;
  title: string;
  caption: string;
  tags: string[];
  notes?: string;
  channel: 'Main Studio' | 'Coffee Shorts' | 'Design Feed';
  status: 'idea' | 'scripting' | 'editing' | 'ready' | 'posted';
}

export interface BenchIdea {
  key: string;
  title: string;
  notes: string;
  tags: string[];
}

export const BENCH_POSTS: BenchPost[] = [
  { key: 'tokyo-night', title: 'Tokyo After Dark — Night Walk Cinematic', caption: '45 minutes of neon and rain through Shibuya after midnight.', tags: ['tokyo', 'nightwalk', 'japan'], channel: 'Main Studio', status: 'editing' },
  { key: 'kyoto-temples', title: 'Kyoto Temples at Sunrise', caption: 'Quiet mornings at Fushimi Inari before the crowds.', tags: ['kyoto', 'japan', 'travel'], channel: 'Main Studio', status: 'posted' },
  { key: 'osaka-food', title: 'Osaka Street Food Tour', caption: 'Takoyaki, okonomiyaki and late-night stalls in Dotonbori.', tags: ['osaka', 'food', 'japan'], channel: 'Main Studio', status: 'ready' },
  { key: 'podcast-setup', title: 'My $300 Podcast Setup (Full Breakdown)', caption: 'Mic, arm, interface and acoustic panels on a budget.', tags: ['podcast', 'audio', 'gear'], channel: 'Main Studio', status: 'scripting' },
  { key: 'mic-review', title: 'Shure MV7 vs Rode PodMic — Honest Review', caption: 'Which one sounds better for spoken word?', tags: ['mic', 'review'], channel: 'Main Studio', status: 'posted' },
  { key: 'lighting', title: 'Three-Light Setup for Small Rooms', caption: 'Key, fill and hair light in a tiny apartment.', tags: ['lights', 'gear'], channel: 'Main Studio', status: 'editing' },
  { key: 'camera-settings', title: 'Cinematic Camera Settings for Beginners', caption: 'Shutter angle, ISO and picture profiles explained.', tags: ['camera', 'filmmaking', 'tutorial'], channel: 'Main Studio', status: 'posted' },
  { key: 'color-grading', title: 'Color Grading in DaVinci Resolve', caption: 'Build a teal and orange look with nodes.', tags: ['davinci', 'grading'], channel: 'Main Studio', status: 'idea' },
  { key: 'latte-art', title: 'Latte Art in 60 Seconds', caption: 'The wrist motion nobody explains.', tags: ['coffee', 'latte', 'barista'], channel: 'Coffee Shorts', status: 'ready' },
  { key: 'espresso-tamp', title: 'Your Espresso Tamp Is Lying to You', caption: 'Even pressure beats hard pressure.', tags: ['espresso', 'barista'], channel: 'Coffee Shorts', status: 'posted' },
  { key: 'pour-over', title: 'V60 Pour-Over Recipe', caption: '15 grams, 250 ml, three pours.', tags: ['pourover', 'v60'], channel: 'Coffee Shorts', status: 'posted' },
  { key: 'cold-brew', title: 'Overnight Cold Brew Concentrate', caption: 'Coarse grind, twelve hours, fridge.', tags: ['coldbrew', 'summer'], channel: 'Coffee Shorts', status: 'editing' },
  { key: 'grinder', title: 'Budget Burr Grinder Showdown', caption: 'Three grinders under $150 compared side by side.', tags: ['grinder', 'gear'], channel: 'Coffee Shorts', status: 'scripting' },
  { key: 'milk-steam', title: 'How to Steam Milk Without a Machine', caption: 'A French press trick for microfoam at home.', tags: ['milk', 'hack'], channel: 'Coffee Shorts', status: 'idea' },
  { key: 'golden-ridge', title: 'Golden Ridge Sunrise', caption: 'Ten frames from the ridge at first light.', tags: ['landscape', 'sunrise', 'hiking'], channel: 'Design Feed', status: 'posted' },
  { key: 'desk-setup', title: 'Minimal Desk Setup Tour', caption: 'Hidden cables, a warm lamp and one monitor.', tags: ['desk', 'setup'], channel: 'Design Feed', status: 'posted' },
  { key: 'notebook', title: 'Analog Notebook to Digital Edit', caption: 'From pencil sketch to finished layout.', tags: ['sketch', 'process'], channel: 'Design Feed', status: 'editing' },
  { key: 'typography', title: 'Five Font Pairings That Always Work', caption: 'Serif headlines with grotesk body text.', tags: ['typography', 'fonts'], channel: 'Design Feed', status: 'ready' },
  { key: 'brand-colors', title: 'Picking a Brand Palette', caption: 'Start from one hero hue and build tints.', tags: ['branding', 'palette'], channel: 'Design Feed', status: 'scripting' },
  { key: 'iceland', title: 'Iceland Ring Road in 7 Days', caption: 'Waterfalls, black sand beaches and glaciers.', tags: ['iceland', 'roadtrip'], channel: 'Main Studio', status: 'posted' },
  { key: 'rain-asmr', title: 'Rainy Window Ambience', caption: 'Two hours of rain on glass.', tags: ['ambience', 'rain'], channel: 'Main Studio', status: 'posted' },
  { key: 'morning-routine', title: 'My 5AM Creator Morning Routine', caption: 'Journaling, coffee, then two hours of editing.', tags: ['routine', 'morning'], channel: 'Main Studio', status: 'posted' },
  { key: 'burnout', title: 'How I Recovered From Burnout', caption: 'Taking a month off and what changed.', tags: ['burnout', 'creator'], channel: 'Main Studio', status: 'idea' },
  { key: 'batching', title: 'Batch Filming 10 Shorts in One Day', caption: 'Plan, shoot and edit a week of content at once.', tags: ['batching', 'shorts', 'workflow'], channel: 'Main Studio', status: 'ready' },
  { key: 'thumbnail', title: 'Thumbnails That Get Clicks', caption: 'Faces, contrast and three words max.', tags: ['thumbnail', 'youtube'], channel: 'Main Studio', status: 'scripting' },
  { key: 'seoul-cafes', title: "Seoul's Hidden Cafes", caption: 'Five tiny coffee shops in Seongsu-dong.', tags: ['seoul', 'cafe'], channel: 'Coffee Shorts', status: 'idea' },
  { key: 'drone', title: 'First Drone Flight Over the Coast', caption: 'Learning to fly a DJI Mini over the cliffs.', tags: ['drone', 'aerial'], channel: 'Main Studio', status: 'editing' },
  { key: 'film-photo', title: 'Shooting 35mm Film in 2026', caption: 'Portra 400 on a thrifted camera.', tags: ['film', 'analog'], channel: 'Design Feed', status: 'posted' },
  { key: 'budget-travel', title: 'Japan on $50 a Day', caption: 'Hostels, konbini meals and rail passes.', tags: ['japan', 'budget'], channel: 'Main Studio', status: 'scripting' },
  { key: 'editing-workflow', title: 'My Video Editing Workflow', caption: 'Proxies, bins and a fast rough cut.', tags: ['editing', 'workflow', 'premiere'], channel: 'Main Studio', status: 'posted' },
];

export const BENCH_IDEAS: BenchIdea[] = [
  { key: 'agents', title: 'AI agents for creators, explained', notes: 'What agents can and can’t do for a solo creator.', tags: ['ai', 'tools'] },
  { key: 'hanoi', title: 'Hanoi coffee culture', notes: 'Egg coffee and plastic stools on the sidewalk.', tags: ['vietnam', 'coffee'] },
  { key: 'gear-100', title: 'Gear under $100 that upgraded my videos', notes: 'Cheap lav mic, LED panel, phone tripod.', tags: ['gear', 'budget'] },
  { key: 'sunrise-hike', title: 'Sunrise hike timelapse', notes: 'Hike up in the dark and timelapse the sky.', tags: ['hiking', 'timelapse'] },
  { key: 'font-series', title: 'Font of the week series', notes: 'One typeface per week with real examples.', tags: ['typography', 'series'] },
  { key: 'studio-tour', title: 'Small apartment studio tour', notes: 'How I fit a studio into 30 square meters.', tags: ['studio', 'setup'] },
  { key: 'croissant', title: 'Bakery croissant ranking', notes: 'Ranking croissants from five bakeries.', tags: ['food', 'bakery'] },
  { key: 'color-theory', title: 'Color theory for thumbnails', notes: 'Complementary colors that pop on small screens.', tags: ['color', 'thumbnail'] },
  { key: 'night-photo', title: 'Night photography basics', notes: 'Long exposures and tripods after dark.', tags: ['photography', 'night'] },
  { key: 'vlog-camera', title: 'Best vlog camera for beginners', notes: 'Compact cameras with flip screens.', tags: ['camera', 'vlog'] },
];

export type ScenarioKind = 'exact' | 'inflection' | 'synonym' | 'vague' | 'typo' | 'filter' | 'irrelevant';

export interface Scenario {
  query: string;
  kind: ScenarioKind;
  target: 'posts' | 'ideas';
  /** Keys of the records a good search returns (empty: nothing should match). */
  expect: string[];
  channel?: BenchPost['channel'];
  stage?: BenchPost['status'];
}

export const SCENARIOS: Scenario[] = [
  // Exact wording from the title or tags.
  { query: 'tokyo night walk', kind: 'exact', target: 'posts', expect: ['tokyo-night'] },
  { query: 'latte art', kind: 'exact', target: 'posts', expect: ['latte-art'] },
  { query: 'podcast setup', kind: 'exact', target: 'posts', expect: ['podcast-setup'] },
  { query: 'iceland', kind: 'exact', target: 'posts', expect: ['iceland'] },
  { query: 'font pairings', kind: 'exact', target: 'posts', expect: ['typography'] },
  { query: 'drone flight', kind: 'exact', target: 'posts', expect: ['drone'] },
  // Different word forms.
  { query: 'walking around tokyo', kind: 'inflection', target: 'posts', expect: ['tokyo-night'] },
  { query: 'grinders compared', kind: 'inflection', target: 'posts', expect: ['grinder'] },
  { query: 'steaming milk', kind: 'inflection', target: 'posts', expect: ['milk-steam'] },
  { query: 'thumbnail', kind: 'inflection', target: 'posts', expect: ['thumbnail'] },
  { query: 'recovering from burnout', kind: 'inflection', target: 'posts', expect: ['burnout'] },
  // Different words, same meaning.
  { query: 'microphone comparison', kind: 'synonym', target: 'posts', expect: ['mic-review'] },
  { query: 'sleep sounds', kind: 'synonym', target: 'posts', expect: ['rain-asmr'] },
  { query: 'lighting a home studio', kind: 'synonym', target: 'posts', expect: ['lighting'] },
  { query: 'taking a break from content creation', kind: 'synonym', target: 'posts', expect: ['burnout'] },
  { query: 'cheap travel', kind: 'synonym', target: 'posts', expect: ['budget-travel'] },
  { query: 'colour grading', kind: 'synonym', target: 'posts', expect: ['color-grading'] },
  { query: 'brand colours', kind: 'synonym', target: 'posts', expect: ['brand-colors'] },
  { query: 'coffee brewing guides', kind: 'synonym', target: 'posts', expect: ['pour-over', 'cold-brew'] },
  { query: 'japanese street snacks', kind: 'synonym', target: 'posts', expect: ['osaka-food'] },
  // Vague references to something the creator remembers.
  { query: 'that rainy city video', kind: 'vague', target: 'posts', expect: ['tokyo-night', 'rain-asmr'] },
  { query: 'the shrine before the crowds', kind: 'vague', target: 'posts', expect: ['kyoto-temples'] },
  { query: 'when I took a month off', kind: 'vague', target: 'posts', expect: ['burnout'] },
  { query: 'post about messy cables', kind: 'vague', target: 'posts', expect: ['desk-setup'] },
  { query: 'the waterfall road trip', kind: 'vague', target: 'posts', expect: ['iceland'] },
  { query: 'film camera photos', kind: 'vague', target: 'posts', expect: ['film-photo'] },
  // Typos.
  { query: 'tokio', kind: 'typo', target: 'posts', expect: ['tokyo-night'] },
  { query: 'expresso', kind: 'typo', target: 'posts', expect: ['espresso-tamp'] },
  { query: 'podcats', kind: 'typo', target: 'posts', expect: ['podcast-setup'] },
  { query: 'iceand', kind: 'typo', target: 'posts', expect: ['iceland'] },
  { query: 'typograpy', kind: 'typo', target: 'posts', expect: ['typography'] },
  { query: 'lattte', kind: 'typo', target: 'posts', expect: ['latte-art'] },
  // Channel and stage filters.
  { query: 'setup', kind: 'filter', target: 'posts', expect: ['desk-setup'], channel: 'Design Feed' },
  { query: 'gear', kind: 'filter', target: 'posts', expect: ['grinder'], channel: 'Coffee Shorts' },
  { query: 'japan', kind: 'filter', target: 'posts', expect: ['kyoto-temples'], channel: 'Main Studio', stage: 'posted' },
  // Ideas.
  { query: 'ai agents', kind: 'exact', target: 'ideas', expect: ['agents'] },
  { query: 'egg coffee vietnam', kind: 'exact', target: 'ideas', expect: ['hanoi'] },
  { query: 'inexpensive equipment', kind: 'synonym', target: 'ideas', expect: ['gear-100'] },
  { query: 'dark sky pictures', kind: 'synonym', target: 'ideas', expect: ['night-photo'] },
  // Nothing relevant exists.
  { query: 'quantum knitting', kind: 'irrelevant', target: 'posts', expect: [] },
  { query: 'tax returns', kind: 'irrelevant', target: 'posts', expect: [] },
  { query: 'skateboarding tricks', kind: 'irrelevant', target: 'posts', expect: [] },
];
