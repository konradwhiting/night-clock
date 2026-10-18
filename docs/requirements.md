# Night Clock: product backlog

Customer: Captain (Sydney). Product owner and builder: Claude.
Working agreement: small increments, a show and tell after each one, and the customer's feedback goes into the log at the bottom before the next increment starts.

## Vision

An old iPad (6th generation) lives on a bedside table and works as a night clock. At a glance, in the dark, it shows the time in Sydney and London and the weather for the next 24 hours in both places. It never lights up the room.

## Constraints

- Device: iPad 6th gen, 9.7 inch, last supported OS is iPadOS 17 (Safari 17). No newer web features than that.
- Always on and plugged in, so the screen must resist burn-in and dim itself at night.
- Static site hosted on GitHub Pages. No build step, no server, no API keys.
- Weather comes from Open-Meteo (free, no key, allows browser requests).
- GitHub Pages on a free plan needs a public repository. The site holds no personal data.

## User stories

Status key: Built means the code exists and passed my own render checks. Accepted means the customer has seen it and said yes.

| ID | Story | Acceptance criteria | Status |
|----|-------|---------------------|--------|
| S1 | As the sleeper, I can read the Sydney time at a glance in a dark room. | Large digits, warm red on black, readable from across the room, no seconds ticking. | Built |
| S2 | I can see the London time and how far apart the two cities are. | London time shown with its zone (GMT or BST), the gap in hours, and whether it is yesterday or tomorrow there. Correct across both daylight saving changes. | Built |
| S3 | The screen dims itself at night and I can override it. | Auto mode dims between 9pm and 6am Sydney time. Tap to choose Auto, Bright, Dim or Dimmest. Choice is remembered. | Built |
| S4 | I can see the forecast for the next 24 hours in both cities. | Per city: temperature now, conditions, high and low, rain chance, and an hourly chart for the next 24 hours with night hours shaded. Refreshes by itself every 30 minutes. | Built |
| S5 | The display keeps working if the network drops. | Last forecast is kept and shown, with a note of when it was fetched. Clock never depends on the network. | Built |
| S6 | The screen protects itself from burn-in. | Content shifts a few pixels every minute. | Built |
| S7 | I can put it on the Home Screen and it opens full screen. | Home Screen icon, no Safari toolbar, black status bar. | Built |
| S8 | I can switch between 12 and 24 hour time. | One tap, remembered. Also applies to the chart hour labels. | Built |

## Ideas, not yet prioritised

- Sunrise and sunset times for both cities.
- Scheduled sleep: screen goes fully black overnight, tap to wake.
- Next alarm or next calendar event on screen.
- Weather warnings (heat, storm, UK weather alerts).
- A third city.
- Fahrenheit option.
- Editable auto-dim hours.
- Service worker so the page loads with no network at all.

## Open questions for the customer

1. 12 hour or 24 hour as the default? (Built as 12 hour, one tap to change.)
2. Will the iPad sit in landscape or portrait? Both layouts exist, I want to tune the one you use.
3. Red or amber digits? (Built as warm red-orange, the least disruptive to night vision.)
4. Which part of London and Sydney should the weather use? (Built as central London and Earlwood.)
5. Is a public GitHub repository acceptable? It is needed for free GitHub Pages hosting.

## Assumptions made in increment 1

- Seconds are not shown, to keep the display calm.
- The forecast window is the next 24 hours from now, not the calendar day.
- Temperatures are in Celsius, rain as chance of precipitation.

## Risks

- Checked only in a desktop browser emulating the iPad 6 screen size. Not yet seen on the real iPad, which is the first thing the next show and tell should cover (font loading, brightness, Home Screen mode).
- The screen wake lock may not work for Home Screen apps on iPadOS 17. Auto-Lock set to Never is the fallback.
- Weather depends on one free service (Open-Meteo). If it is down the clock still works and the last forecast stays up.

## Definition of done

- Renders correctly at iPad 6 size (1024 x 768 points) in landscape and portrait.
- No horizontal scrolling, no clipped text.
- Clock and date correct across daylight saving changes.
- Works with the forecast unavailable.
- Shown to the customer and feedback recorded.

## Increments

| # | Scope | Show and tell |
|---|-------|---------------|
| 1 | S1 to S8 as a first working version | Screenshots of landscape and portrait with sample forecast data |

## Feedback log

| Date | Increment | Feedback | Decision |
|------|-----------|----------|----------|
| | | | |
