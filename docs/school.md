# School (Canvas calendar feeds)

A read-only School building in the town combines your SDSU and SDCCD Canvas calendars. Walk to the door and press **E**, or use the **School** button. It opens on **Upcoming**: today and the next seven days in deadline order, grouped by day, with empty days collapsed into one line. The month **Calendar** (with a list for the picked day) is the other tab. Each event shows its school, its course (when the feed gives one), a location when there is one, and a **Canvas calendar** link. The calendars card is a compact one-line bar by default; **Show** expands the per-school controls.

**Due times.** Both real feeds list assignments with a date only (`DTSTART;VALUE=DATE`, no time and no end), apart from rare ones that carry a UTC time. A date-only assignment is shown as **Check Canvas for due time**, never as a made-up deadline; it sorts after the timed items of that day. **All day** is kept for genuine all-day calendar events (feed ids that are not `event-assignment-*`). Exact times and time zones are kept whenever the feed provides them. The links Canvas puts in these feeds open the Canvas calendar month, not the individual assignment.

Only calendar dates are used. Grades, submission status and completion are never read, inferred or shown. A cancelled event is listed as Cancelled.

## Where to enter the two feed URLs
1. In Canvas, open **Calendar**, choose **Calendar Feed**, and copy the link. Do this for SDSU and for SDCCD.
2. Open `.env.local` in your editor. `npm run env:init` has already added two empty lines (existing values were not touched):
   - `CANVAS_SDSU_FEED_URL=`
   - `CANVAS_SDCCD_FEED_URL=`
3. Paste each link after its `=`. Never paste a feed link into chat, and never commit it: anyone holding the link can read that calendar.
4. `FINANCE_TOWN_ACCESS_CODE` must already be set (the same code that unlocks brokerages).
5. Restart: `npm run dev:stop && npm run dev`.

## How to test it
1. Open http://localhost:3000 and enter the School (E at the door, or the School button).
2. Unlock with your local access code.
3. Each school loads once on first open. Check that the school badges, course names and times look right, and that **Open in Canvas** opens the right page.
4. Use **Refresh** per school (60 second cooldown each) or **Refresh both**. The last-updated time appears per school.
5. To see the failure path, put a wrong link in one variable, restart, and refresh: that school shows a fixed error message and keeps its previous events marked stale, while the other school is unaffected.

## Security
- Feed links live only in `.env.local` (gitignored) and are read on the server. They are never sent to the browser, logged, returned in an error or written to an export or backup. The calendar data is kept in server memory and the page's React state only.
- Routes: `GET /api/brokerage/school/state` (cached copy, never fetches) and `POST /api/brokerage/school/refresh` (`{school}`), both behind the same loopback, same-origin and access-code session guard as the financial endpoints. They sit under `/api/brokerage` because that is the path the session cookie is scoped to; a test enforces it.
- A feed link must be `https`, end in `.ics`, carry no credentials or odd port, and be on the school's own host: SDSU `sdsu.instructure.com` or `*.sdsu.edu`; SDCCD `sdccd.instructure.com` or `*.sdccd.edu`. If your school's Canvas lives on a different host, the link is refused with a clear message and the allowed hosts are in `lib/server/schoolHosts.ts`. Redirects are followed by hand (at most 3) and every hop is checked the same way. Feeds are capped at 5 MB and 15 seconds.
- Event links are shown only when they are `https` on the school's own host.
- Only titles, times, a course label, a location and the link are kept. Descriptions are dropped.

## Parsing
`ical.js` parses the feed on the server (`lib/server/ics.ts`). Times in UTC, in a time zone defined by the feed, or in an IANA zone name are converted to the right instant, including across daylight saving; floating times are shown as written. All-day events keep their date (the end is exclusive). Repeating events are expanded from 14 days back to 120 days ahead, honouring exceptions, moved and cancelled occurrences. Duplicate IDs inside one feed keep the highest revision; two schools that reuse the same ID never collide because every event ID starts with the school.

## Verification status
- Done with synthetic data only: parsing and date behavior, school separation, the fetch and redirect rules, failures and stale handling, cooldowns, the auth boundary with `curl` (401 without a session, 403 for a bad host or origin, the cookie reaching the school routes) and a browser pass (walking to the door, E to enter, unlock, all three views, per-school failure, Esc, mobile width).
- **Live feeds have not been tested.** Nothing has fetched a real SDSU or SDCCD feed. Unverified until you add your links: that the allowed hosts match your Canvas sites, real Canvas titles and links, and your time zones.
