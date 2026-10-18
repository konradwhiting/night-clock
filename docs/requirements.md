# Night Clock: product backlog

Customer: Captain (Sydney). Product owner and builder: Claude.
Working agreement: small increments, a show and tell after each one, and the customer's feedback goes into the log at the bottom before the next increment starts.

## Vision

An old iPad (6th generation) lives on a bedside table and works as a night clock. At a glance, in the dark, it shows the time in Sydney and in the UK (Eastbourne) and the weather for the next 24 hours in both places. It never lights up the room.

## Constraints

- Device: iPad 6th gen, 9.7 inch, last supported OS is iPadOS 17 (Safari 17). No newer web features than that.
- Always on and plugged in, so the screen must resist burn-in and dim itself at night.
- Static site hosted on GitHub Pages. No build step, no server, no API keys.
- Weather comes from Open-Meteo (free, no key, allows browser requests).
- GitHub Pages on a free plan needs a public repository. The site holds no personal data.

## User stories

Status key: Built means the code exists and passed my own render checks. Accepted from screenshots means the customer has seen it and said yes. Accepted on device will mean it has also been checked on the real iPad.

| ID | Story | Acceptance criteria | Status |
|----|-------|---------------------|--------|
| S1 | As the sleeper, I can read the Sydney time at a glance in a dark room. | Large digits, warm red on black, readable from across the room, no seconds ticking. | Accepted on device |
| S2 | I can see the UK time and how far apart the two places are. | Eastbourne (UK) time shown with its zone (GMT or BST), the gap in hours, and whether it is yesterday or tomorrow there. Correct across both daylight saving changes. | Accepted on device |
| S3 | The screen dims itself at night and I can override it. | Auto mode dims between 9pm and 6am Sydney time. Tap to choose Auto, Bright, Dim or Dimmest. Choice is remembered. | Accepted on device |
| S4 | I can see the forecast for the next 24 hours in both cities. | Per place: temperature now, conditions, high and low, rain chance, and an hourly chart for the next 24 hours with night hours shaded. Refreshes by itself every 30 minutes. | Accepted on device |
| S5 | The display keeps working if the network drops. | Last forecast is kept and shown, with a note of when it was fetched. Clock never depends on the network. | Accepted on device |
| S6 | The screen protects itself from burn-in. | Content shifts a few pixels every minute. | Accepted on device |
| S7 | I can put it on the Home Screen and it opens full screen. | Home Screen icon, no Safari toolbar, black status bar. | Accepted on device |
| S8 | I can switch between 24 and 12 hour time. | 24 hour by default. One tap to switch, remembered. Also applies to the chart hour labels. | Accepted on device |
| S9 | As the sleeper, I can see the top regional headline for each place. | Earlwood (Sydney) shows the top ABC News NSW story, Eastbourne the top BBC News Sussex story, each with its source and age. Refreshes about once an hour. Hidden if no headline is available. Landscape only. | Accepted on device. The scheduled job has run once and fetched live headlines from both feeds |
| S10 | As the sleeper, I can see how likely rain is in Earlwood, without temperature taking the space. | Sydney forecast leads with a plain-words rain outlook (for example "Rain easing by 20:00"), chance now, peak chance and time, expected millimetres, a next-2-hours rain strip, and a 24 hour chart led by rain chance. Temperature shrinks to one small line. Eastbourne unchanged. | Built, awaiting customer check on the iPad |
| S11 | As the sleeper, I can have a second clock that shows only Earlwood, at its own address. | `/earlwood/` page with one large clock and the rain-first forecast. No headline and no Eastbourne. No Eastbourne. Own Home Screen icon and name. | Built, awaiting customer check |

## Ideas, not yet prioritised

- Sunrise and sunset times for both cities.
- Scheduled sleep: screen goes fully black overnight, tap to wake.
- Next alarm or next calendar event on screen.
- Weather warnings (heat, storm, UK weather alerts).
- A third city.
- Fahrenheit option.
- Editable auto-dim hours.
- Service worker so the page loads with no network at all.

## Decisions from the customer (19 Oct 2026)

- Layout: landscape. Portrait stays working but is not tuned further.
- Time format: 24 hour by default.
- Weather locations: Eastbourne, East Sussex and Earlwood, Sydney. The second clock is labelled Eastbourne and uses UK time, same as London.
- Repository: named `night-clock` under the customer's GitHub account. Customer to create it, as the build session cannot create repositories.

## Open questions for the customer

0. Would a live rain radar for the Earlwood area be worth adding? It is the only source that sees showers street by street.
1. Red or amber digits? (Built as warm red-orange, the least disruptive to night vision.)
2. Is a public GitHub repository acceptable? It is needed for free GitHub Pages hosting.

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
| 1 | S1 to S8 as a first working version | Screenshots of landscape and portrait with sample forecast data. Done, feedback recorded below |
| 2 | S9 regional headlines in the blank middle section | Screenshot with sample headlines, then live once the first scheduled run has finished |

## Feedback log

| Date | Increment | Feedback | Decision |
|------|-----------|----------|----------|
| 19 Oct 2026 | 1 | Landscape, 24 hour, locations Eastbourne and Earlwood, repo named night-clock | Applied the same day |
| 19 Oct 2026 | 1 | Make Sydney's digits larger than Eastbourne's | Sydney is now about 2.3 times the height of Eastbourne in landscape |
| 19 Oct 2026 | 1 | Change the font so it looks like the TV series 24 | Bold seven-segment digital display with faint unlit segments. A look in the same spirit, not a copy of the show's graphic. Sydney is about 2.3 times the size of Eastbourne. Customer to confirm it is the right feel |
| 19 Oct 2026 | 1 | Use the blank middle section for a top regional news headline | Added as S9. One headline per place, Sydney from ABC News NSW, Eastbourne from BBC News Sussex |
| 19 Oct 2026 | 2 | LGTM on headlines in the middle section | Accepted from screenshots. Next: check on the real iPad |
| 19 Oct 2026 | 1 and 2 | Set up on the iPad: all done, perfect for now | Accepted on device. Ideas list stays open for later |
| 19 Oct 2026 | 2 | Headlines once an hour is enough | Job now runs hourly at 7 past, page checks every 30 minutes |
| 19 Oct 2026 | 3 | Sydney: shrink temperature, show more on rain likelihood for Earlwood, ideally Hughes Park or Hansen Avenue | Added as S10. Forecast models are about 10 km grid, so Hughes Park, Hansen Avenue and the suburb centre all get the same numbers. Kept the suburb-level point, and did not put a street-level location in the public repo. A rain radar would be the way to get truly local. Offered to the customer |
| 19 Oct 2026 | 3 | Rename Sydney to Earlwood, and make news, weather and rain specific to Earlwood | Column renamed. Weather and rain already use an Earlwood point. News now looks for Earlwood stories first, then Canterbury-Bankstown and Inner West, then ABC News NSW. Few stories name Earlwood, so the wider area will often show |
| 19 Oct 2026 | 3 | A second night clock that shows only Earlwood, with a different URL | Added as S11 on the same site at /earlwood/, so no new repository is needed. A separate repository is possible if a fully separate address is wanted |
| 19 Oct 2026 | 3 | Earlwood-only page: remove the news, keep time and weather | Headline area removed from /earlwood/. Clock and forecast chart are larger to use the space. The main clock still shows headlines |
