# Workout Every Morning

A mobile-first web app for tracking cardio workouts by photographing your machine's display screen.

## How It Works

1. Take a photo of your treadmill / elliptical / bike summary screen
2. GPT-5.2 extracts the workout data (duration, calories, distance, speed, heart rate, etc.)
3. Data is saved to Firebase Firestore
4. View your progress over time with bar charts

## Setup

### Prerequisites

- An **OpenAI API key** (with access to gpt-5.2 vision)
- A **Firebase project** with Firestore enabled

### Firebase Configuration

1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable Firestore Database
3. Copy your web app config into `src/config.js` (`FIREBASE_CONFIG` object)
4. Set Firestore security rules (see `docs/firestore-rules.md`)

### Deploy to GitHub Pages

Push this repo to GitHub and enable Pages from the repository settings (serve from the root of the `main` branch).

## Project Structure

```
index.html          Single-page app shell
css/style.css       Mobile-first responsive styles
src/
  app.js            App init, screen routing
  config.js         Firebase config, constants
  setup.js          First-time setup (username + API key)
  llm.js            OpenAI Vision API integration
  firebase.js       Firestore read/write
  capture.js        Photo capture and extraction flow
  history.js        Workout history charts and list
  utils.js          Shared helpers
docs/
  design.md         Design document
  tech-stack.md     Tech stack rationale
```

## Tech Stack

- Vanilla JavaScript (ES modules, no build step)
- Chart.js v4 (bar charts)
- Firebase Firestore v10 (CDN compat SDK)
- OpenAI gpt-5.2 (vision extraction)
- Hosted on GitHub Pages
