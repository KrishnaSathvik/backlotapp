import type { ChannelItem, ContentItem, IdeaItem } from './content-logic';

/**
 * Read-only demo workspace shown in preview mode ("Try the demo").
 * Photos live in /public/demo (Unsplash, free to use) and /public/covers.
 */
export const DEMO_CHANNELS: ChannelItem[] = [
  {
    "name": "Main Studio",
    "handle": "@mainstudio",
    "id": 1
  },
  {
    "name": "Design Feed",
    "handle": "@designfeed",
    "id": 2
  },
  {
    "name": "Field Notes",
    "handle": "@fieldnotes",
    "id": 3
  }
];

export const DEMO_ITEMS: ContentItem[] = [
  {
    "notes": "",
    "liveLink": "",
    "postDate": "",
    "targetDate": "2026-11-22",
    "videoAsset": null,
    "slides": [],
    "attachedReferences": [],
    "sourceIdeaId": null,
    "title": "Tokyo After Dark — Night Walk Cinematic",
    "platform": "youtube_long",
    "channelId": 3,
    "channelName": "Field Notes",
    "status": "editing",
    "caption": "45 minutes of neon, rain and 35mm through Shibuya after midnight. Shot handheld on a gimbal with no lights.",
    "tags": [
      "tokyo",
      "nightwalk",
      "cinematic",
      "travel"
    ],
    "coverAsset": {
      "id": "show-1",
      "name": "tokyo-night.jpg",
      "url": "/demo/tokyo-night.jpg",
      "mimeType": "image/jpeg",
      "size": 512000
    },
    "id": 200,
    "createdAt": "2026-11-16T20:00:00.000Z",
    "updatedAt": "2026-11-17T09:00:00.000Z"
  },
  {
    "notes": "",
    "liveLink": "",
    "postDate": "",
    "targetDate": "2026-12-02",
    "videoAsset": null,
    "slides": [],
    "attachedReferences": [],
    "sourceIdeaId": null,
    "title": "My $300 Podcast Setup (Full Breakdown)",
    "platform": "youtube_long",
    "channelId": 1,
    "channelName": "Main Studio",
    "status": "idea",
    "caption": "Mic, arm, interface and the one acoustic fix that made the biggest difference.",
    "tags": [
      "podcast",
      "audio",
      "setup"
    ],
    "coverAsset": {
      "id": "show-2",
      "name": "podcast-setup.jpg",
      "url": "/demo/podcast-setup.jpg",
      "mimeType": "image/jpeg",
      "size": 512000
    },
    "id": 201,
    "createdAt": "2026-11-16T21:00:00.000Z",
    "updatedAt": "2026-11-17T08:00:00.000Z"
  },
  {
    "notes": "",
    "liveLink": "https://instagram.com/p/ridge-sunrise",
    "postDate": "2026-11-12",
    "targetDate": "",
    "videoAsset": null,
    "slides": [],
    "attachedReferences": [],
    "sourceIdeaId": null,
    "title": "Golden Ridge Sunrise — 4 AM Hike",
    "platform": "instagram_reel",
    "channelId": 3,
    "channelName": "Field Notes",
    "status": "posted",
    "caption": "Alarm at 3:40. Worth it. 🌄 Full gear list in the comments.",
    "tags": [
      "sunrise",
      "hiking",
      "reels",
      "mountains"
    ],
    "coverAsset": {
      "id": "show-3",
      "name": "ridge-sunrise.jpg",
      "url": "/demo/ridge-sunrise.jpg",
      "mimeType": "image/jpeg",
      "size": 512000
    },
    "id": 202,
    "createdAt": "2026-11-16T22:00:00.000Z",
    "updatedAt": "2026-11-17T07:00:00.000Z"
  },
  {
    "notes": "",
    "liveLink": "",
    "postDate": "",
    "targetDate": "2026-11-19",
    "videoAsset": null,
    "slides": [],
    "attachedReferences": [],
    "sourceIdeaId": null,
    "title": "Latte Art in 60 Seconds",
    "platform": "youtube_shorts",
    "channelId": 1,
    "channelName": "Main Studio",
    "status": "ready",
    "caption": "The wrist motion nobody explains. Slow-mo at 0:22.",
    "tags": [
      "coffee",
      "latteart",
      "shorts"
    ],
    "coverAsset": {
      "id": "show-4",
      "name": "latte-art.jpg",
      "url": "/demo/latte-art.jpg",
      "mimeType": "image/jpeg",
      "size": 512000
    },
    "id": 203,
    "createdAt": "2026-11-16T23:00:00.000Z",
    "updatedAt": "2026-11-17T06:00:00.000Z"
  },
  {
    "notes": "",
    "liveLink": "",
    "postDate": "",
    "targetDate": "2026-11-28",
    "videoAsset": null,
    "slides": [],
    "attachedReferences": [],
    "sourceIdeaId": null,
    "title": "15-Min Home Mobility Routine",
    "platform": "tiktok",
    "channelId": 2,
    "channelName": "Design Feed",
    "status": "scripting",
    "caption": "POV: you fixed your desk posture in 15 minutes 🧘 6 moves, no equipment. Save it for tomorrow.",
    "tags": [
      "mobility",
      "fitness",
      "carousel"
    ],
    "coverAsset": {
      "id": "show-5",
      "name": "mobility.jpg",
      "url": "/demo/mobility.jpg",
      "mimeType": "image/jpeg",
      "size": 512000
    },
    "id": 204,
    "createdAt": "2026-11-16T24:00:00.000Z",
    "updatedAt": "2026-11-17T05:00:00.000Z"
  },
  {
    "notes": "",
    "liveLink": "",
    "postDate": "",
    "targetDate": "2026-12-05",
    "videoAsset": null,
    "slides": [],
    "attachedReferences": [],
    "sourceIdeaId": null,
    "title": "Sunday Brunch Spread — Overhead Shots",
    "platform": "instagram_carousel",
    "channelId": 2,
    "channelName": "Design Feed",
    "status": "idea",
    "caption": "How I light and style a top-down food flat lay with one window.",
    "tags": [
      "foodphotography",
      "flatlay",
      "brunch"
    ],
    "coverAsset": {
      "id": "show-6",
      "name": "brunch.jpg",
      "url": "/demo/brunch.jpg",
      "mimeType": "image/jpeg",
      "size": 512000
    },
    "id": 205,
    "createdAt": "2026-11-16T25:00:00.000Z",
    "updatedAt": "2026-11-17T04:00:00.000Z"
  },
  {
    "title": "Minimalist Desk Camera Rig Breakdown 2026",
    "platform": "youtube_long",
    "channelId": 1,
    "channelName": "Main Studio",
    "status": "ready",
    "caption": "Every piece of gear on an overhead desk rig — key light placement, 24mm prime framing, and clean cable routing for solo creators.",
    "tags": [
      "desksetup",
      "filmmaking",
      "cameragear",
      "youtube",
      "studio"
    ],
    "notes": "Double check chapter timestamps before scheduling Friday 9am.",
    "liveLink": "",
    "postDate": "",
    "targetDate": "2026-11-20",
    "coverAsset": {
      "id": "seed-cover-1",
      "name": "youtube-desk-cover.jpg",
      "url": "/covers/cover_youtube_desk.jpg",
      "mimeType": "image/jpeg",
      "size": 428000
    },
    "videoAsset": null,
    "slides": [],
    "attachedReferences": [
      {
        "id": "seed-ref-1",
        "url": "https://www.youtube.com/watch?v=desk-lighting-ref",
        "title": "Softbox Top-Down Lighting Angle Reference",
        "note": "Match the subtle blue monitor backlight contrast.",
        "screenshotUrl": "/covers/cover_youtube_desk.jpg"
      }
    ],
    "sourceIdeaId": null,
    "id": 100,
    "createdAt": "2026-11-16T23:07:22.386Z",
    "updatedAt": "2026-11-16T05:00:00.000Z"
  },
  {
    "title": "One-Handed Gimbal Rig for Vertical Reels",
    "platform": "instagram_reel",
    "channelId": 1,
    "channelName": "Main Studio",
    "status": "editing",
    "caption": "Why a compact cage + top mic beats heavy mirrorless rigs when shooting fast street reels. Full parts list pinned below.",
    "tags": [
      "reels",
      "mobilefilmmaking",
      "gimbal",
      "creatorgear"
    ],
    "notes": "Trim hook to first 1.6 seconds and export 1080x1920 60fps.",
    "liveLink": "",
    "postDate": "",
    "targetDate": "2026-11-18",
    "coverAsset": {
      "id": "seed-cover-2",
      "name": "reel-gimbal-cover.jpg",
      "url": "/covers/cover_shorts_studio.jpg",
      "mimeType": "image/jpeg",
      "size": 312000
    },
    "videoAsset": null,
    "slides": [],
    "attachedReferences": [],
    "sourceIdeaId": null,
    "id": 101,
    "createdAt": "2026-11-16T23:07:22.386Z",
    "updatedAt": "2026-11-16T04:00:00.000Z"
  },
  {
    "title": "5 Framing Rules for Clean Editorial Carousels",
    "platform": "instagram_carousel",
    "channelId": 2,
    "channelName": "Design Feed",
    "status": "posted",
    "caption": "Swipe through 5 layout rules for cleaner carousels: generous margins, single blue accent, and consistent slide pacing.",
    "tags": [
      "carousel",
      "editorialdesign",
      "typography",
      "instagram"
    ],
    "notes": "Slide 1 hook performed 2.1x average saves.",
    "liveLink": "https://instagram.com/p/editorial-framing-rules",
    "postDate": "2026-11-14",
    "targetDate": "2026-11-14",
    "coverAsset": {
      "id": "seed-cover-3",
      "name": "carousel-slide-01.jpg",
      "url": "/covers/cover_carousel_minimal.jpg",
      "mimeType": "image/jpeg",
      "size": 365000
    },
    "videoAsset": null,
    "slides": [
      {
        "id": "seed-slide-1",
        "name": "slide-01-cover.jpg",
        "url": "/covers/cover_carousel_minimal.jpg",
        "mimeType": "image/jpeg",
        "size": 365000,
        "order": 0
      },
      {
        "id": "seed-slide-2",
        "name": "slide-02-desk.jpg",
        "url": "/covers/cover_youtube_desk.jpg",
        "mimeType": "image/jpeg",
        "size": 428000,
        "order": 1
      },
      {
        "id": "seed-slide-3",
        "name": "slide-03-bluehour.jpg",
        "url": "/covers/cover_travel_vlog.jpg",
        "mimeType": "image/jpeg",
        "size": 410000,
        "order": 2
      }
    ],
    "attachedReferences": [],
    "sourceIdeaId": null,
    "id": 102,
    "createdAt": "2026-11-16T23:07:22.386Z",
    "updatedAt": "2026-11-16T03:00:00.000Z"
  },
  {
    "title": "Blue Hour Coastal Drive — Amalfi Cut",
    "platform": "youtube_shorts",
    "channelId": 3,
    "channelName": "Field Notes",
    "status": "scripting",
    "caption": "Shooting twilight winding roads at 1/50 shutter on 35mm. Color grade breakdown in the pinned comment.",
    "tags": [
      "shorts",
      "travelvlog",
      "bluehour",
      "colorgrading"
    ],
    "notes": "Draft 25-second voiceover focusing on shutter speed and ambient sound.",
    "liveLink": "",
    "postDate": "",
    "targetDate": "2026-11-24",
    "coverAsset": {
      "id": "seed-cover-4",
      "name": "bluehour-coastal-cover.jpg",
      "url": "/covers/cover_travel_vlog.jpg",
      "mimeType": "image/jpeg",
      "size": 410000
    },
    "videoAsset": null,
    "slides": [],
    "attachedReferences": [],
    "sourceIdeaId": null,
    "id": 103,
    "createdAt": "2026-11-16T23:07:22.386Z",
    "updatedAt": "2026-11-16T02:00:00.000Z"
  }
];

export const DEMO_IDEAS: IdeaItem[] = [
  {
    "title": "30-Second Desk Lighting Flip Transition",
    "linkUrl": "https://www.youtube.com/shorts/lighting-flip-demo",
    "linkTitle": "YouTube Short Reference: lighting flip demo",
    "linkDomain": "youtube.com",
    "screenshotUrl": "/covers/cover_shorts_studio.jpg",
    "notes": "Start dark with only blue rim light, snap fingers to trigger overhead key light and reveal full desk.",
    "platform": "youtube_shorts",
    "channelName": "Main Studio",
    "tags": [
      "lighting",
      "transition",
      "shorts"
    ],
    "targetDate": "2026-11-26",
    "convertedItemId": null,
    "id": 500,
    "createdAt": "2026-11-16T23:07:22.386Z"
  },
  {
    "title": "Analog Notebook to Digital Edit Workflow Carousel",
    "linkUrl": "https://www.instagram.com/p/sketch-to-edit",
    "linkTitle": "Instagram Post Reference: sketch to edit",
    "linkDomain": "instagram.com",
    "screenshotUrl": "/covers/cover_carousel_minimal.jpg",
    "notes": "4-slide breakdown showing hand-drawn storyboard frame side-by-side with final graded frame.",
    "platform": "instagram_carousel",
    "channelName": "Design Feed",
    "tags": [
      "storyboard",
      "carousel",
      "workflow"
    ],
    "targetDate": "2026-11-29",
    "convertedItemId": null,
    "id": 501,
    "createdAt": "2026-11-16T23:07:22.386Z"
  },
  {
    "title": "Shot list: rainy neon B-roll",
    "linkUrl": "https://www.youtube.com/watch?v=neon-broll",
    "linkTitle": "Rainy neon B-roll reference",
    "linkDomain": "youtube.com",
    "screenshotUrl": "/demo/neon-alley.jpg",
    "notes": "Low angle puddle reflections, 1/50 shutter, ND filter.",
    "platform": "youtube_long",
    "channelName": "Field Notes",
    "tags": [
      "broll",
      "neon"
    ],
    "targetDate": "2026-12-08",
    "convertedItemId": null,
    "id": 502,
    "createdAt": "2026-11-17T08:00:00.000Z"
  },
  {
    "title": "Mic comparison carousel",
    "linkUrl": "https://www.instagram.com/p/mic-compare",
    "linkTitle": "Mic comparison layout",
    "linkDomain": "instagram.com",
    "screenshotUrl": "/demo/mic-wall.jpg",
    "notes": "4 slides: dynamic vs condenser, price, sound sample QR.",
    "platform": "instagram_carousel",
    "channelName": "Design Feed",
    "tags": [
      "audio",
      "carousel"
    ],
    "targetDate": "2026-12-10",
    "convertedItemId": null,
    "id": 503,
    "createdAt": "2026-11-17T07:00:00.000Z"
  }
];
