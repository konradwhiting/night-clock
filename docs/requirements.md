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
| S11 | As the sleeper, I can have a second clock that shows only Earlwood, at its own address. | `/earlwood/` page with one large clock and a text-and-numbers forecast. No charts, no headline and no Eastbourne. Fits short, wide screens. No Eastbourne. Own Home Screen icon and name. | Built, awaiting customer check |
| S12 | As the sleeper, I can see at a glance whether Sydney Light Rail L1 Dulwich Hill is running on time. | Earlwood page shows a Light rail panel with a plain status (Running on time, Minor delays, Delays), a short detail line, and says so when the status is out of date or not connected. Quiet when on time, brighter when not. Live data from Transport for NSW trip updates, read by a scheduled job every 10 minutes. Minor delay is 5 minutes late or more, Delays is 10 minutes or more or any cancelled trip. | Built, awaiting the Transport for NSW key and customer check |
| S13 | As the family, we can see how good the forecast has been, checked against what actually happened, for temperature and rain. | `/accuracy/` page, open to the whole family, worked out live from free open data (Open-Meteo previous-runs forecasts against the ERA5 archive). Shows the typical miss on the high and low, each model against the six-model average, whether the umbrella advice caught wet days and stayed quiet on dry ones, rain day by day, the last 14 days and the biggest misses. Look back 30, 60 or 90 days, °C or °F. States plainly that "what happened" is a reconstruction, not a rain gauge. Costs nothing, no timer. | Built (21 Oct 2026), customer likes it. Earlwood only |

## Ideas, not yet prioritised

- Sunrise and sunset times for both cities.
- Scheduled sleep: screen goes fully black overnight, tap to wake.
- Next alarm or next calendar event on screen.
- Weather warnings (heat, storm, UK weather alerts).
- A third city.
- Fahrenheit option.
- Editable auto-dim hours.
- Service worker so the page loads with no network at all.

### Actions from the forecast accuracy page (21 Oct 2026)

- [ ] Same accuracy page for Eastbourne, using the same method.
- [ ] Link the accuracy page from somewhere the family will find it (the clock's settings panel or a Home Screen shortcut).
- [ ] Judge the forecast against real readings, not a reconstruction: log what the clock showed each morning and compare with the nearest Bureau of Meteorology station. Check first whether the Bureau's terms and any registration cost allow it; keep it private if not.
- [ ] After about two months of data, decide whether to drop or down-weight Météo-France, the weakest model in the first 59-day check (about 3.6 °C off on lows). Dropping it improved lows but made highs slightly worse, so no change yet.
- [ ] Keep the Bureau's day forecast for Sydney as a private cross-check on request (free, personal use). Using it on a public page needs Bureau registration, cost unverified.
- [ ] Look at the two umbrella misses in the first check (27 Aug and 19 Oct, light rain missed) and the 7 false alarms, all near misses, to see whether the "Take an umbrella" threshold needs tuning.

### Actions: tidy the Earlwood repository (21 Oct 2026)

- [ ] Rewrite `README.md` for what this repository now is: the Earlwood Morning Clock (`/earlwood/`), the family forecast accuracy page (`/accuracy/`) and the light rail job. It still describes the original "Night Clock" two-city bedside clock. Say where the other clocks live (`bedside-clock`, `eastbourne-clock`).
- [ ] Replace the README screenshot (`docs/screenshots/landscape.png`, from 19 Oct). It still shows the first build: "SYDNEY" label, 24-hour time, an ABC News NSW headline and red-on-black only. Use a current picture of the three-row Earlwood clock, and add a themes picture.
- [ ] Remove the old two-city page (root `index.html`) and its headlines job (`news.yml`, `scripts/update-news.mjs`, `news.json`) from this repository, **only after** the bedside iPad is using the `bedside-clock` address. Removing it earlier would break whatever device still opens the old address.
- [ ] Bring this backlog up to date: stories for what was built after S12 (three-row Earlwood redesign, rotating colour themes, her school-trip light rail, news rotation and links, 12-hour time, the Eastbourne and bedside clocks), plus the parked items (news timer, hosting, bus tracker).

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
| 19 Oct 2026 | 3 | Earlwood page on the Lenovo tablet: screen is small, clock font is fine, drop the weather graphics and use text and numbers | Charts replaced with text and a three-hourly table of temperature and rain chance. Clock size now follows screen height so nothing is cut off on short screens |
| 19 Oct 2026 | 4 | Earlwood page: weather as built (current temperature, today's top, when rain is expected), plus a space that says whether Sydney Light Rail is running on time. Line: L1 Dulwich Hill | Added as S12 under the weather. Needs a free Transport for NSW Open Data API key stored as the repository secret TFNSW_API_KEY. Until then the panel says Not connected yet. The scheduled job only commits when the status changes, plus once an hour |
| 19 Oct 2026 | 3 | Earlwood page: remove the hourly table, show just Current and High | Table and low temperature removed. Page shows current temperature, the day's high, the rain outlook and the next two hours |
| 19 Oct 2026 | 3 | Describe rain amounts so kids can understand, not millimetres | Millimetres replaced with words on both clocks: just a sprinkle, a light drizzle (bring a coat), proper rain (puddles to jump in), heavy rain (wet socks), a soaking downpour |
| 19 Oct 2026 | 4 | Describe the temperature in kid-friendly words too, keeping the numbers | Earlwood page shows e.g. 24° Now: warm, t-shirt weather, and High 24° · warm. Bands: freezing, cold, chilly, mild, warm, hot, very hot |
| 21 Oct 2026 | 3 | Check what the clock predicts for rain and temperature against what actually happened, and make it visible to all the family | Added as S13. Page at /accuracy/ built from free open data, no timer. First 59-day check: highs off by 0.9 °C and lows by 0.8 °C; "Take an umbrella" caught 17 of 19 wet days with 7 false alarms. Follow-up actions listed under Ideas |
| 21 Oct 2026 | 3 | The README screenshot looks like the two-city clock and is out of date | Confirmed: it is the first build (19 Oct). Tidy-up actions added to the backlog under Ideas |
