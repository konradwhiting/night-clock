# Night Clock

A bedside clock for an old iPad (6th generation, iPadOS 17). It shows the time in Sydney and the UK (Eastbourne), how far apart they are, and the weather for the next 24 hours in both places. Warm red seven-segment digits on black, dims itself at night.

![Landscape](docs/screenshots/landscape.png)

Plain HTML, CSS and JavaScript. No build step, no dependencies, no API keys. Forecasts come from [Open-Meteo](https://open-meteo.com).

## Put it on the iPad

1. Host the folder as a website. The simplest way is GitHub Pages: repository Settings, Pages, deploy from the `main` branch, root folder. (Free GitHub accounts need the repository to be public for Pages.)
2. On the iPad open the site in Safari.
3. Tap Share, then Add to Home Screen. Open it from the new icon and it runs full screen.
4. Settings, Display & Brightness, Auto-Lock, Never. Keep the iPad plugged in.
5. Optional: Settings, Accessibility, Display & Text Size, Reduce White Point, for a dimmer minimum brightness.
6. Optional: Settings, Accessibility, Guided Access, so a stray touch cannot leave the clock.

## Using it

Tap anywhere to show the controls for eight seconds.

- Time: switch between 24 hour (the default) and 12 hour.
- Brightness: Auto (dim between 9pm and 6am Sydney time), Bright, Dim, Dimmest.

Choices are remembered on the iPad. Landscape is the main layout. Portrait also works.

## Headlines

The blank space in each column shows the top regional headline: ABC News NSW for Sydney and BBC News Sussex for Eastbourne (BBC News England if the Sussex feed is unavailable). They are hidden in portrait.

A browser cannot read those RSS feeds directly, so a scheduled GitHub Action (`.github/workflows/news.yml`) fetches them twice an hour and commits `news.json` when a headline changes. The page reads `news.json`. To refresh by hand, open the Actions tab, choose Update headlines, then Run workflow. Headlines are shown with their source for personal use.

## What it does for a night screen

- The picture shifts a few pixels every minute to protect the display.
- If the network drops, the last forecast stays on screen with the time it was fetched.
- The page reloads itself once a day around 3am Sydney time to pick up new versions.
- Daylight saving is handled by the browser's time zone data, so the gap to the UK changes correctly (10 hours now, 11 hours after the UK clocks go back on 25 October 2026).

## Run it on a computer

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure and Home Screen settings |
| `styles.css` | Layout and the night colour scheme |
| `app.js` | Clock, time zones, forecast fetch and chart, headlines, controls |
| `scripts/update-news.mjs`, `.github/workflows/news.yml` | Fetch the regional headlines on a schedule |
| `news.json` | Latest headlines, written by the workflow |
| `manifest.webmanifest`, `icon-*.png` | Home Screen install |
| `fonts/` | Seven-segment digit font (DSEG7 Classic, SIL Open Font License, licence included) |
| `docs/requirements.md` | Product backlog, open questions and feedback log |

## Known limits

- iPadOS 17 may not honour the screen wake lock for Home Screen apps, so Auto-Lock set to Never is the reliable way to keep the screen on.
- Forecast locations are Eastbourne, East Sussex and Earlwood in Sydney. They are set at the top of `app.js`.
