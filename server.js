require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Please upload a JPG, PNG, WEBP, or GIF image.'));
    }
    cb(null, true);
  }
});

const geminiKey = process.env.GEMINI_API_KEY || '';
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const pay2allKey = process.env.PAY2ALL_API_KEY || '';
const pay2allBaseUrl = (process.env.PAY2ALL_API_BASE_URL || 'https://www.pay2all.in/api/v1').replace(/\/$/, '');
const railRadarKey = process.env.RAILRADAR_API_KEY || process.env.INDIANRAIL_API_KEY || '';
const railRadarBaseUrl = 'https://api.railradar.in';

app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(geminiKey),
    trainConfigured: Boolean(railRadarKey),
    busConfigured: Boolean(pay2allKey),
    provider: 'TerrWays',
    services: {
      gemini: Boolean(geminiKey),
      trains: Boolean(railRadarKey),
      buses: Boolean(pay2allKey)
    },
    model: geminiModel
  });
});

function extractJson(text) {
  try { return JSON.parse(text); } catch (_) {}
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('The AI returned an invalid response.');
  return JSON.parse(match[0]);
}

async function pay2allRequest(endpoint, options = {}) {
  if (!pay2allKey) {
    const error = new Error('Bus API is not configured. Add PAY2ALL_API_KEY to your .env file and restart the server.');
    error.status = 503;
    throw error;
  }

  const response = await fetch(`${pay2allBaseUrl}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pay2allKey}`,
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error?.message || `Bus provider returned HTTP ${response.status}.`);
  }
  if (payload?.status_id && payload.status_id !== 1) {
    throw new Error(payload.message || 'Bus provider rejected the request.');
  }
  return payload;
}

function cleanCityName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 100);
}

async function findBusCityId(cityName) {
  const q = cleanCityName(cityName);
  if (!q) throw new Error('Departure and destination are required.');

  const payload = await pay2allRequest(`/buses/cities?q=${encodeURIComponent(q)}`, {
    method: 'GET'
  });

  const cities = Array.isArray(payload?.data?.cities) ? payload.data.cities : [];
  if (!cities.length) throw new Error(`Could not find bus city: ${q}`);

  const exact = cities.find(city => String(city.name || '').toLowerCase() === q.toLowerCase());
  return exact || cities[0];
}

function normalizeBusTrip(trip) {
  const fareMin = Number(trip?.fare_min ?? trip?.fare?.min ?? trip?.fare ?? 0);
  const fareMax = Number(trip?.fare_max ?? trip?.fare?.max ?? fareMin);

  return {
    id: trip?.trip_id || trip?.id || '',
    operator: trip?.operator || trip?.operator_name || 'Bus operator',
    busType: trip?.bus_type || trip?.busType || 'Bus',
    departure: trip?.departure || trip?.departure_time || '',
    arrival: trip?.arrival || trip?.arrival_time || '',
    duration: trip?.duration || '',
    fareMin,
    fareMax,
    availableSeats: Number(trip?.available_seats ?? trip?.availableSeats ?? 0),
    currency: trip?.currency || 'INR'
  };
}

// Live bus inventory: city names -> Pay2All city IDs -> live trips.
app.get('/api/travel/buses', async (req, res) => {
  const from = cleanCityName(req.query.from);
  const to = cleanCityName(req.query.to);
  const date = String(req.query.date || '').trim();

  if (!from || !to || !date) {
    return res.status(400).json({ error: 'from, to and date are required.' });
  }

  if (from.toLowerCase() === to.toLowerCase()) {
    return res.status(400).json({ error: 'Departure and destination must be different.' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date must use YYYY-MM-DD format.' });
  }

  try {
    const [sourceCity, destinationCity] = await Promise.all([
      findBusCityId(from),
      findBusCityId(to)
    ]);

    const payload = await pay2allRequest('/buses/search', {
      method: 'POST',
      body: JSON.stringify({
        source_id: String(sourceCity.id),
        destination_id: String(destinationCity.id),
        date
      })
    });

    const trips = Array.isArray(payload?.data?.trips) ? payload.data.trips : [];

    res.json({
      provider: 'Pay2All',
      live: true,
      traceId: payload?.data?.trace_id || '',
      from: sourceCity.name || from,
      to: destinationCity.name || to,
      date,
      results: trips.map(normalizeBusTrip)
    });
  } catch (error) {
    console.error('Bus search error:', error?.message || error);
    res.status(error?.status || 502).json({
      error: error?.message || 'The bus provider could not be reached right now.'
    });
  }
});

const TRAIN_STATION_ALIASES = {
  'bpl': 'BPL',
  'bhopal': 'BPL',
  'bhopal jn': 'BPL',
  'bhopal junction': 'BPL',
  'bhopal railway station': 'BPL',
  'rewa': 'REWA',
  'rewa jn': 'REWA',
  'rewa junction': 'REWA',
  'rani kamlapati': 'RKMP',
  'rani kamlapati bhopal': 'RKMP',
  'habibganj': 'RKMP',
  's hiradaramnagar': 'SHRN',
  'sant hirdaram nagar': 'SHRN',
  'sant hirdaramnagar': 'SHRN'
};

function normalizeStationInput(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ');
}

function cleanTrainText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 100);
}

async function railRadarRequest(endpoint) {
  if (!railRadarKey) {
    const error = new Error(
      'Train API is not configured. Add RAILRADAR_API_KEY to your .env file and restart the server.'
    );
    error.status = 503;
    throw error;
  }

  const response = await fetch(`${railRadarBaseUrl}${endpoint}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${railRadarKey}`
    }
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const providerMessage =
      payload?.error?.message ||
      payload?.message ||
      `RailRadar returned HTTP ${response.status}.`;
    const error = new Error(providerMessage);
    error.status = response.status;
    throw error;
  }

  if (payload?.success === false) {
    const error = new Error(
      payload?.error?.message ||
      'RailRadar rejected the request.'
    );
    error.status = response.status || 502;
    throw error;
  }

  return payload;
}

async function findTrainStationCode(value) {
  const raw = cleanTrainText(value);
  const normalized = normalizeStationInput(raw);

  if (!normalized) {
    throw new Error('Departure and destination are required.');
  }

  if (TRAIN_STATION_ALIASES[normalized]) {
    const code = TRAIN_STATION_ALIASES[normalized];
    console.log(`Train station: ${raw} -> ${code} (alias)`);
    return code;
  }

  if (/^[a-z]{2,10}$/i.test(raw)) {
    const code = raw.toUpperCase();
    console.log(`Train station: ${raw} -> ${code} (code)`);
    return code;
  }

  const payload = await railRadarRequest(
    `/v1/lookup/search/stations?q=${encodeURIComponent(raw)}&limit=10`
  );

  const stations = Array.isArray(payload?.data) ? payload.data : [];

  if (!stations.length) {
    throw new Error(`Could not find a railway station for "${raw}".`);
  }

  const exact = stations.find((station) => {
    const name = normalizeStationInput(station?.name);
    const city = normalizeStationInput(station?.city);
    const code = String(station?.code || '').toLowerCase();
    return name === normalized || city === normalized || code === normalized;
  });

  const station = exact || stations[0];

  if (!station?.code) {
    throw new Error(`Could not find a railway station for "${raw}".`);
  }

  const code = String(station.code).toUpperCase();
  console.log(`Train station: ${raw} -> ${code}`);
  return code;
}

function formatDuration(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return '';

  const hours = Math.floor(value / 60);
  const mins = value % 60;

  if (!hours) return `${mins}m`;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function normalizeTrainTrip(item) {
  const train = item?.train || {};
  const from = item?.from || {};
  const to = item?.to || {};
  const live = item?.live || {};

  return {
    id: train?.number || '',
    provider: 'RailRadar',
    name: train?.name || 'Train',
    number: train?.number || '',
    depart: from?.departure || '',
    arrive: to?.arrival || '',
    duration: formatDuration(item?.duration),
    type: train?.type || 'Train',
    price: 0,
    seats: live?.delayMinutes != null
      ? `${live.delayMinutes} min delay`
      : 'Check availability',
    url: 'https://www.irctc.co.in/',
    runDays: Array.isArray(train?.runDays) ? train.runDays : [],
    distance: item?.distance ?? null,
    liveStatus: live?.type || ''
  };
}

// Live timetable search: resolve station names/codes, then query RailRadar.
app.get('/api/travel/trains', async (req, res) => {
  const from = cleanTrainText(req.query.from);
  const to = cleanTrainText(req.query.to);
  const date = String(req.query.date || '').trim();

  if (!from || !to || !date) {
    return res.status(400).json({ error: 'from, to and date are required.' });
  }

  if (from.toLowerCase() === to.toLowerCase()) {
    return res.status(400).json({
      error: 'Departure and destination must be different.'
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({
      error: 'Date must use YYYY-MM-DD format.'
    });
  }

  try {
    const [fromCode, toCode] = await Promise.all([
      findTrainStationCode(from),
      findTrainStationCode(to)
    ]);

    console.log(
      `Train search: ${from} (${fromCode}) -> ${to} (${toCode}) (${date})`
    );

    const payload = await railRadarRequest(
      `/v1/trains/between/${encodeURIComponent(fromCode)}/${encodeURIComponent(toCode)}?date=${encodeURIComponent(date)}`
    );

    const trains = Array.isArray(payload?.data?.trains)
      ? payload.data.trains
      : [];

    console.log(`Train results: ${trains.length}`);

    res.json({
      provider: 'RailRadar',
      live: true,
      from: fromCode,
      to: toCode,
      date,
      traceId: payload?.meta?.traceId || '',
      results: trains.map(normalizeTrainTrip)
    });
  } catch (error) {
    console.error('Train search error:', error?.message || error);
    res.status(error?.status || 502).json({
      error:
        error?.message ||
        'The RailRadar train provider could not be reached right now.'
    });
  }
});

app.post('/api/place-info', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image was uploaded.' });
  if (!geminiKey) return res.status(503).json({ error: 'AI service is not configured. Add GEMINI_API_KEY to your .env file and restart the server.' });

  const base64 = req.file.buffer.toString('base64');
  const prompt = `You are Terraways Place Scout. Identify the travel place shown in this image as accurately as possible. Prefer a specific landmark/place only when visual evidence supports it. If you cannot identify it confidently, say so instead of inventing a location. The site is focused on Madhya Pradesh, India, but the uploaded image may be from anywhere.

Return ONLY valid JSON with these keys:
{
  "name": "place or landmark name, or Unknown",
  "location": "city, state/country if reasonably known, otherwise Unknown",
  "description": "2-4 concise sentences about what is visible and why the place is notable",
  "highlights": "2-4 short highlights separated by •",
  "confidence": "High, Medium, or Low"
}`;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: req.file.mimetype, data: base64 } }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 350 }
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `Gemini API returned ${response.status}.`);
    const text = payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
    const data = extractJson(text);
    res.json({
      name: data.name || 'Place identified',
      location: data.location || 'Unknown',
      description: data.description || 'No description was returned.',
      highlights: data.highlights || '',
      confidence: data.confidence || 'Unknown'
    });
  } catch (error) {
    console.error('Place Scout error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'The place could not be identified right now. Please try another photo.' });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'The image is too large. Please choose an image under 10 MB.' });
  }
  if (error) return res.status(400).json({ error: error.message || 'Invalid upload.' });
  next(error);
});

app.listen(PORT, () => {
  console.log(`Terraways is running at http://localhost:${PORT}`);
  console.log(geminiKey ? `Place Scout AI: Gemini configured (${geminiModel})` : 'Place Scout AI: not configured — add GEMINI_API_KEY to .env');
  console.log(pay2allKey ? 'Bus inventory: Pay2All configured' : 'Bus inventory: not configured — add PAY2ALL_API_KEY to .env');
  console.log(railRadarKey ? 'Train API: RailRadar configured' : 'Train API: not configured — add RAILRADAR_API_KEY to .env');
});
