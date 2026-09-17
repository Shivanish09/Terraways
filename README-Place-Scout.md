# Terraways — AI Place Scout + Travel Platform MVP

## What is included
- AI Place Scout powered by Gemini (`gemini-2.5-flash` by default)
- Dynamic travel search with autocomplete, dates, traveller count, budget/rating/amenity/distance filters and sorting
- Interactive map preview using Leaflet + OpenStreetMap
- Curated destination-guide cards
- Unified demo booking flow for hotels, flights, trains, cars, tours and packages
- Custom package builder with demo bundle discount
- Visual seat and room selectors
- My Trip dashboard, saved wishlist and drag-and-drop itinerary
- Verified-review, UGC gallery and traveler Q&A prototype
- Currency, weather, visa-checker, budget and price-alert widgets
- Vendor/CMS/analytics admin dashboard prototype

## Run locally

1. Install Node.js LTS.
2. In this folder run:

```bash
npm install
```

3. Create `.env` and add:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
PORT=3000
```

4. Start the app:

```bash
npm start
```

5. Open `http://localhost:3000`.
6. Optional health check: `http://localhost:3000/api/health`.

## Important
The booking, payment, weather, visa, price-alert, review, vendor, and analytics screens are currently **MVP/demo UI**. They do not claim real inventory or payment confirmation. For production, connect authenticated backend services and official supplier/payment/data APIs.

Keep your Gemini API key only in `.env`; never put it in `index.html` or commit it to Git.


## Live train and bus search

The Book your way section no longer fabricates demo trains/buses. It calls backend provider adapters and shows a provider-search link when live inventory is not configured.

Add these to `.env` for live search:

```env
INDIANRAIL_API_KEY=your_indian_rail_api_key
AOPAY_API_KEY=your_aopay_api_key
AOPAY_API_BASE_URL=https://api.aopay.in/v2
```

The train adapter uses Indian Rail API for train/station discovery; booking still opens IRCTC for the final availability/booking step. The bus adapter uses AOPAY's bus search endpoint; final booking can open the provider/redBus. Provider credentials belong on the server only — never put them in `index.html`.
