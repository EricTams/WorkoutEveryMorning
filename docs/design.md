# WorkoutEveryMorning -- Design Document

## Overview

Mobile-first static web app for tracking cardio workouts. Users photograph their
treadmill/elliptical/bike display screen, an LLM extracts the workout data, and
results are stored in Firebase Firestore for historical visualization.

## Architecture

Static vanilla JS (no build step), hosted on GitHub Pages.

Three external integrations:
- **Camera / photo picker** -- browser `<input type="file">` API
- **OpenAI Vision API** -- direct `fetch` with user-supplied API key
- **Firebase Firestore** -- CDN compat SDK, no server

```
User Phone                          Cloud
+-----------+                +------------------+
| Camera    |--photo-------->| OpenAI gpt-5.2   |
| Browser   |<--JSON--------| (vision extract)  |
| localStorage (key, user)  +------------------+
|           |--save--------->| Firestore        |
|           |<--query--------| (workouts coll)  |
+-----------+                +------------------+
```

## Data Flow

1. **First launch** -- setup screen collects username + OpenAI API key, saved to localStorage
2. **Capture** -- user taps "Log Workout", takes or selects photo
3. **Extract** -- photo resized to ~1024px, base64-encoded, sent to gpt-5.2
4. **Review** -- extracted fields shown as summary card; user taps Save or Retake
5. **Store** -- workout document written to Firestore
6. **View** -- history screen queries Firestore, renders Chart.js bar charts

## Firestore Schema

**Collection**: `workouts`

Each document (auto-ID):

| Field                 | Type             | Example          |
|-----------------------|------------------|------------------|
| `username`            | string           | "eric"           |
| `timestamp`           | server timestamp | (auto)           |
| `machineType`         | string           | "treadmill"      |
| `elapsedTimeSeconds`  | number           | 2183             |
| `calories`            | number           | 445              |
| `distanceMiles`       | number           | 4.10             |
| `distanceClimbedFeet` | number \| null   | 4000             |
| `avgSpeedMph`         | number           | 6.77             |
| `avgPaceSecondsPerMile` | number \| null | 531              |
| `avgHeartRate`        | number \| null   | 138              |
| `rawExtraction`       | object           | (LLM raw JSON)   |

Values are normalized to imperial units (miles, feet, MPH, BPM) by the LLM prompt.
Firestore rules enforce that reads/writes match the document `username` field.

## UI Screens

### Setup (shown once on first launch)
- Username text input
- OpenAI API key (password input)
- "Get Started" button
- Settings gear icon on main screen to change later

### Log (default view)
- Large "Log Workout" button (camera/photo picker)
- Loading spinner during LLM extraction
- Summary card with extracted fields
- Save / Retake buttons
- Bottom nav: **Log** | **History**

### History
- Metric selector (calories, distance, duration, speed, heart rate)
- Time range selector (1 week, 1 month, 3 months, 6 months, 1 year, all)
- Bar chart (Chart.js) with horizontal scroll for long timelines
- Scrollable list of workout summary cards below chart

## Privacy

- Data is private per user; each user only sees their own workouts
- API key never leaves the device (stored in localStorage, sent directly to OpenAI)
- No server-side code; all logic runs in the browser
