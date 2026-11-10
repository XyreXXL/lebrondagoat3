const cityInput = document.querySelector("#city-input");
const searchButton = document.querySelector("#search-button");
const locationButton = document.querySelector("#location-button");
const refreshButton = document.querySelector("#refresh-button");
const genreSelect = document.querySelector("#genre-select");
const statusMessage = document.querySelector("#status-message");
const audioPlayer = document.querySelector("#audio-player");
const trackList = document.querySelector("#track-list");
const personalizationToggle = document.querySelector("#personalization-enabled");
const spotifyConnectButton = document.querySelector("#spotify-connect");
const spotifyDisconnectButton = document.querySelector("#spotify-disconnect");
const spotifyStatus = document.querySelector("#spotify-status");
const spotifyPreferences = document.querySelector("#spotify-preferences");
const spotifyRevokeLink = document.querySelector("#spotify-revoke-link");
const likeButton = document.querySelector("#like-button");
const aiToggle = document.querySelector("#ai-enabled");
const aiStatus = document.querySelector("#ai-status");
const HISTORY_KEY = "weather-rhythm-recent-tracks";
const PLACE_KEY = "weather-rhythm-place";
const PREFERENCES_KEY = "weather-rhythm-preferences";
const PERSONALIZATION_KEY = "weather-rhythm-personalization";
const AI_ENABLED_KEY = "weather-rhythm-ai-enabled";
const HISTORY_LIMIT = 60;

const weatherElements = {
  icon: document.querySelector("#weather-icon"),
  temperature: document.querySelector("#temperature"),
  description: document.querySelector("#weather-description"),
  details: document.querySelector("#weather-details"),
  location: document.querySelector("#location-name"),
  localTime: document.querySelector("#city-local-time"),
  localDay: document.querySelector("#city-local-day"),
  updatedAt: document.querySelector("#updated-at"),
};

const elements = {
  moodTitle: document.querySelector("#mood-title"),
  moodTag: document.querySelector("#mood-tag"),
  moodCopy: document.querySelector("#mood-copy"),
  playlistTitle: document.querySelector("#playlist-title"),
  playlistDescription: document.querySelector("#playlist-description"),
  albumArt: document.querySelector("#album-art"),
  spotifyLink: document.querySelector("#spotify-link"),
  appleLink: document.querySelector("#apple-link"),
  playButton: document.querySelector("#play-button"),
  previousButton: document.querySelector("#previous-button"),
  nextButton: document.querySelector("#next-button"),
  shuffleButton: document.querySelector("#shuffle-button"),
  progress: document.querySelector("#progress-slider"),
  playerTime: document.querySelector("#player-time"),
  nowPlaying: document.querySelector("#now-playing-title"),
  playerNote: document.querySelector("#player-note"),
};

const weatherTypes = {
  clear: {
    title: "Солнце просится в наушники",
    tag: "солнечно",
    copy: "Ясное небо задаёт лёгкий, открытый настрой.",
    icon: "☀",
    mood: "bright upbeat",
  },
  clouds: {
    title: "Облака — отличный повод замедлиться",
    tag: "облачно",
    copy: "Мягкий свет за окном — время для спокойного ритма.",
    icon: "☁",
    mood: "mellow dreamy",
  },
  rain: {
    title: "Пусть дождь задаёт ритм",
    tag: "дождливо",
    copy: "Капли за окном и мелодии, в которых можно раствориться.",
    icon: "☂",
    mood: "mellow rainy",
  },
  snow: {
    title: "Поймали снежную тишину",
    tag: "снег",
    copy: "Зимний воздух просит уютного и объёмного звучания.",
    icon: "❄",
    mood: "cozy winter atmospheric",
  },
  storm: {
    title: "У погоды сегодня громкий голос",
    tag: "гроза",
    copy: "Собрали энергичный настрой под шум настоящей стихии.",
    icon: "ϟ",
    mood: "powerful energetic intense",
  },
  fog: {
    title: "Туманный день, ясный плейлист",
    tag: "туманно",
    copy: "Чуть больше пространства и загадочности в каждом звуке.",
    icon: "≋",
    mood: "mysterious mellow atmospheric",
  },
};

const weatherDescriptions = {
  0: "Ясное небо",
  1: "Преимущественно ясно",
  2: "Переменная облачность",
  3: "Облачно",
  45: "Туман",
  48: "Изморозь и туман",
  51: "Лёгкая морось",
  53: "Морось",
  55: "Сильная морось",
  56: "Ледяная морось",
  57: "Сильная ледяная морось",
  61: "Небольшой дождь",
  63: "Дождь",
  65: "Сильный дождь",
  66: "Ледяной дождь",
  67: "Сильный ледяной дождь",
  71: "Небольшой снег",
  73: "Снег",
  75: "Сильный снег",
  77: "Снежные зёрна",
  80: "Кратковременный дождь",
  81: "Ливень",
  82: "Сильный ливень",
  85: "Снегопад",
  86: "Сильный снегопад",
  95: "Гроза",
  96: "Гроза с градом",
  99: "Сильная гроза с градом",
};

let currentPlace = null;
let currentWeather = null;
let currentTimezone = "UTC";
let currentTracks = [];
let placeSelectionVersion = 0;
let spotifyTaste = null;
let currentTrackIndex = -1;
let isShuffling = false;
let weatherRequestId = 0;
let playlistRequestId = 0;
let aiConfigured = false;
let lastTimeContext = "";

function getWeatherType(code) {
  if ([0, 1].includes(code)) return "clear";
  if ([2, 3].includes(code)) return "clouds";
  if ([45, 48].includes(code)) return "fog";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "storm";
  return "rain";
}

function getTimeContext(date = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: currentTimezone,
      weekday: "long",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      weekday: "long",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  }
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const hour = Number(values.hour);
  let dayPart = "ночью";
  if (hour >= 5 && hour < 7) dayPart = "ранним утром";
  else if (hour >= 7 && hour < 12) dayPart = "утром";
  else if (hour >= 12 && hour < 18) dayPart = "днём";
  else if (hour >= 18 && hour < 22) dayPart = "вечером";
  const weekday = values.weekday || "monday";
  const dayKind = ["Saturday", "Sunday"].includes(weekday) ? "weekend" : "weekday";
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: currentTimezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const day = new Intl.DateTimeFormat("ru-RU", {
    timeZone: currentTimezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  const weekdayLabel = new Intl.DateTimeFormat("ru-RU", {
    timeZone: currentTimezone,
    weekday: "long",
  }).format(date);
  return {
    hour,
    dayPart,
    weekday,
    weekdayLabel,
    dayKind,
    time,
    day,
    signature: `${values.year || ""}-${values.month || ""}-${values.day || ""}|${hour}|${dayPart}|${weekday}`,
  };
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function setLoading(button, isLoading, label) {
  button.disabled = isLoading;
  button.classList.toggle("is-loading", isLoading);
  if (label) {
    button.innerHTML = isLoading
      ? `<span aria-hidden="true">↻</span> ${label}`
      : '<span aria-hidden="true">↻</span> Обновить плейлист';
  }
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Сервис ответил с ошибкой (${response.status}).`);
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Сервис не ответил вовремя. Попробуйте ещё раз.");
    }
    if (error instanceof TypeError) {
      throw new Error("Не удалось подключиться к сервису. Проверьте интернет.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestAppApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Сервер приложения вернул некорректный ответ.");
  }
  if (!response.ok) throw new Error(data.error || `Ошибка сервера (${response.status}).`);
  return data;
}

function readPreferences() {
  try {
    const data = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "{}");
    return {
      likes: Array.isArray(data.likes) ? data.likes.filter((id) => typeof id === "string") : [],
      genres:
        data.genres && typeof data.genres === "object" && !Array.isArray(data.genres)
          ? data.genres
          : {},
      signals:
        data.signals && typeof data.signals === "object" && !Array.isArray(data.signals)
          ? data.signals
          : {},
    };
  } catch {
    return { likes: [], genres: {}, signals: {} };
  }
}

function savePreferences(preferences) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    statusMessage.textContent = "Не удалось сохранить персональные предпочтения в браузере.";
    return false;
  }
}

function isPersonalizationEnabled() {
  return personalizationToggle.checked;
}

function recordTrackSignal(track, signal) {
  if (!track || !isPersonalizationEnabled()) return;
  const preferences = readPreferences();
  const id = trackIdentity(track);
  const signals = preferences.signals[id] || { plays: 0, skips: 0, completed: 0, selected: 0 };
  signals[signal] = (signals[signal] || 0) + 1;
  signals.artist = track.artistName;
  signals.track = track.trackName;
  preferences.signals[id] = signals;
  savePreferences(preferences);
}

function recordGenrePreference(genre) {
  if (!isPersonalizationEnabled()) return;
  const preferences = readPreferences();
  preferences.genres = preferences.genres || {};
  preferences.genres[genre] = (preferences.genres[genre] || 0) + 1;
  savePreferences(preferences);
}

function makeSearchUrl(city) {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({
    name: city,
    count: "5",
    language: "ru",
    format: "json",
  });
  return url;
}

async function findCity(city) {
  const query = city.trim();
  if (!query) throw new Error("Введите название города.");
  const data = await fetchJson(makeSearchUrl(query));
  const place = data.results?.[0];
  if (!place) throw new Error("Город не найден. Проверьте название и попробуйте ещё раз.");
  return place;
}

function makeWeatherUrl(place) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation,rain,snowfall,cloud_cover,is_day",
    timezone: "auto",
  });
  return url;
}

function placeLabel(place) {
  return [
    place.name || place.locality || place.city,
    place.admin1 || place.principalSubdivision,
    place.country || place.countryName,
  ]
    .filter((part, index, parts) => part && parts.indexOf(part) === index)
    .join(", ");
}

function savePlace(place) {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(place));
    return true;
  } catch {
    return false;
  }
}

function loadSavedPlace() {
  try {
    const place = JSON.parse(localStorage.getItem(PLACE_KEY) || "null");
    if (
      place &&
      typeof place.latitude === "number" &&
      typeof place.longitude === "number" &&
      place.name
    ) {
      return place;
    }
  } catch {
    return null;
  }
  return null;
}

function showWeather(current, place) {
  const type = getWeatherType(current.weather_code);
  const mood = weatherTypes[type];
  const temperature = Math.round(current.temperature_2m);
  const feelsLike = Math.round(current.apparent_temperature);
  const extra = [];
  if (typeof current.snowfall === "number" && current.snowfall > 0) {
    extra.push(`снег ${current.snowfall} мм`);
  } else if (typeof current.precipitation === "number" && current.precipitation > 0) {
    extra.push(`осадки ${current.precipitation} мм`);
  }
  if (typeof current.cloud_cover === "number") {
    extra.push(`облачность ${current.cloud_cover}%`);
  }
  weatherElements.icon.textContent = mood.icon;
  weatherElements.temperature.textContent = `${temperature}°`;
  weatherElements.description.textContent =
    weatherDescriptions[current.weather_code] || "Переменная погода";
  weatherElements.details.textContent = [
    `ощущается как ${feelsLike}°`,
    `влажность ${current.relative_humidity_2m}%`,
    `ветер ${Math.round(current.wind_speed_10m)} км/ч`,
    ...extra,
  ].join(" · ");
  weatherElements.location.textContent = placeLabel(place);
  weatherElements.updatedAt.textContent = `обновлено в ${current.time?.split("T")[1]?.slice(0, 5) || "сейчас"}`;
  const timeContext = getTimeContext();
  weatherElements.localTime.textContent = timeContext.time;
  weatherElements.localDay.textContent = timeContext.day;
  elements.moodTitle.textContent = mood.title;
  elements.moodTag.textContent = mood.tag;
  elements.moodCopy.textContent =
    `${mood.copy} Сейчас ${timeContext.dayPart}, ${timeContext.weekdayLabel}, ${temperature}°.` +
    (temperature <= 5 && type !== "snow" ? " Одевайся потеплее!" : "");
  document.body.dataset.weather = type;
  document.body.dataset.timeOfDay = timeContext.dayPart;
  lastTimeContext = timeContext.signature;
  document.title = `${place.name || place.locality || place.city} — Погодный ритм`;
}

async function loadWeather(
  place,
  { refreshPlaylist = true, onlyIfContextChanged = false } = {},
) {
  const requestId = ++weatherRequestId;
  const previousWeather = currentWeather;
  weatherElements.updatedAt.textContent = "обновляем погоду…";
  statusMessage.textContent = "";
  try {
    const data = await fetchJson(makeWeatherUrl(place));
    if (requestId !== weatherRequestId) return;
    const current = data.current;
    if (!current || typeof current.temperature_2m !== "number") {
      throw new Error("Сервис погоды не вернул текущие данные.");
    }
    currentPlace = place;
    currentWeather = current;
    currentTimezone = data.timezone || place.timezone || "UTC";
    showWeather(current, place);
    cityInput.value = place.name || place.locality || place.city || "";
    const placeSaved = savePlace(place);
    const timeContext = getTimeContext();
    const contextChanged =
      !previousWeather ||
      makeMusicQuery(
        previousWeather,
        genreSelect.value,
        timeContext,
      ) !== makeMusicQuery(current, genreSelect.value, timeContext);
    if (refreshPlaylist && (!onlyIfContextChanged || contextChanged || !currentTracks.length)) {
      await generatePlaylist();
    }
    if (!placeSaved && !statusMessage.textContent) {
      statusMessage.textContent = "Город не сохранён в браузере; выберите его снова при следующем визите.";
    }
  } catch (error) {
    if (requestId !== weatherRequestId) return;
    weatherElements.updatedAt.textContent = "не удалось обновить";
    statusMessage.textContent = error.message;
  }
}

async function searchAndLoadCity() {
  const selectionVersion = ++placeSelectionVersion;
  searchButton.disabled = true;
  searchButton.textContent = "Ищем…";
  statusMessage.textContent = "";
  try {
    const place = await findCity(cityInput.value);
    if (selectionVersion !== placeSelectionVersion) return;
    await loadWeather(place);
  } catch (error) {
    statusMessage.textContent = error.message;
    weatherElements.updatedAt.textContent = "город не найден";
  } finally {
    searchButton.disabled = false;
    searchButton.innerHTML = 'Найти <span aria-hidden="true">↗</span>';
  }
}

function getCoordinates() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) {
      reject(
        new Error(
          "Для геолокации откройте WeatherMood через localhost или HTTPS. Город можно выбрать вручную.",
        ),
      );
      return;
    }
    if (!navigator.geolocation) {
      reject(new Error("Браузер не поддерживает определение местоположения."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 20000,
      maximumAge: 15 * 60 * 1000,
    });
  });
}

async function reverseGeocode(latitude, longitude) {
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.search = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    localityLanguage: "ru",
  });
  const data = await fetchJson(url);
  const administrativeAreas = data.localityInfo?.administrative || [];
  const cityArea = administrativeAreas.find((area) => {
    const description = String(area.description || "").toLocaleLowerCase();
    return (
      /(?:город|city|town|municipality)/iu.test(description) &&
      !/(?:район|округ|district|borough|ward|neighborhood)/iu.test(description)
    );
  });
  const localityIsDistrict =
    /(?:район|округ|district|borough|ward|neighborhood)/iu.test(data.locality || "");
  const name =
    data.city ||
    cityArea?.name ||
    (localityIsDistrict ? "" : data.locality) ||
    data.principalSubdivision;
  if (!name) throw new Error("Не удалось определить город по координатам.");
  return {
    name,
    admin1:
      data.principalSubdivision && data.principalSubdivision !== name
        ? data.principalSubdivision
        : "",
    country: data.countryName,
    country_code: data.countryCode,
    latitude,
    longitude,
  };
}

function geolocationError(error) {
  if (error.code === 1) return "Доступ к геолокации запрещён. Выберите город вручную.";
  if (error.code === 2) return "Местоположение недоступно. Выберите город вручную.";
  if (error.code === 3) return "Геолокация не ответила вовремя. Можно найти город вручную.";
  return error.message || "Не удалось определить местоположение.";
}

async function requestLocation() {
  const selectionVersion = ++placeSelectionVersion;
  locationButton.disabled = true;
  locationButton.textContent = "Определяем…";
  statusMessage.textContent = "";
  try {
    const position = await getCoordinates();
    const place = await reverseGeocode(position.coords.latitude, position.coords.longitude);
    if (selectionVersion !== placeSelectionVersion) return;
    await loadWeather(place);
  } catch (error) {
    const message = error.code ? geolocationError(error) : error.message;
    statusMessage.textContent = message;
  } finally {
    locationButton.disabled = false;
    locationButton.textContent = "⌖ Моё местоположение";
  }
}

function getRecentTracks() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(history)
      ? history.filter((identity) => typeof identity === "string")
      : [];
  } catch {
    return [];
  }
}

function trackIdentity(track) {
  const normalize = (value) =>
    value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `${normalize(track.artistName)}|${normalize(track.trackName)}`;
}

function rememberTracks(tracks) {
  const history = getRecentTracks();
  const identities = tracks.map(trackIdentity);
  const updated = [...new Set([...identities.reverse(), ...history])].slice(0, HISTORY_LIMIT);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}

function makeMusicQuery(weather, genre, timeContext) {
  const type = getWeatherType(weather.weather_code);
  const context = [weatherTypes[type].mood];
  const isRainy = weather.rain > 0 || weather.precipitation > 0;
  const timeMood = {
    "ранним утром": type === "clear" ? "sunrise light upbeat wake up" : "gentle morning fresh start",
    утром: isRainy ? "rainy morning calm indie lo-fi" : "morning light uplifting",
    "днём": type === "clear" ? "daytime sunny energetic upbeat" : "daytime easy listening",
    вечером: type === "clouds" ? "evening chill mellow laid-back" : "evening relaxed",
    ночью: isRainy
      ? "night rain ambient slow jazz atmospheric lo-fi"
      : "late night mellow ambient",
  };
  context.push(timeMood[timeContext.dayPart] || "easy listening");
  context.push(timeContext.dayKind === "weekend" ? "weekend" : "weekday");
  if (weather.temperature_2m <= 0) context.push("cold");
  if (weather.temperature_2m >= 25) context.push("warm");
  if (weather.wind_speed_10m >= 35) context.push("windy");
  if (weather.snowfall > 0) context.push("snow");
  else if (isRainy) context.push("rain");
  if (weather.cloud_cover >= 80) context.push("overcast");
  return `${genre} ${context.join(" ")} music`;
}

async function searchMusic(query, countryCode) {
  const url = new URL("https://itunes.apple.com/search");
  url.search = new URLSearchParams({
    term: query,
    media: "music",
    entity: "song",
    limit: "50",
    country: /^[A-Z]{2}$/i.test(countryCode || "") ? countryCode : "US",
  });
  const data = await fetchJson(url, 15000);
  return (data.results || []).filter(
    (track) =>
      Number.isInteger(track.trackId) &&
      track.trackName &&
      track.artistName &&
      track.previewUrl &&
      track.trackViewUrl,
    );
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function chooseTracks(catalog) {
  const recent = new Set(getRecentTracks());
  const uniqueCatalog = [
    ...new Map(catalog.map((track) => [trackIdentity(track), track])).values(),
  ];
  const fresh = uniqueCatalog.filter((track) => !recent.has(trackIdentity(track)));
  if (fresh.length >= 8) return fresh.slice(0, 40);
  const older = uniqueCatalog.filter((track) => recent.has(trackIdentity(track)));
  return [...fresh, ...older].slice(0, 40);
}

function getTasteSearchTerms() {
  if (!isPersonalizationEnabled()) return [];
  const preferences = readPreferences();
  const likedArtists = Object.values(preferences.signals)
    .filter((signal) => signal.likes > 0 && signal.artist)
    .map((signal) => signal.artist);
  const spotifyArtists = (spotifyTaste?.topArtists || []).map((artist) => artist.name);
  const spotifyTrackArtists = [
    ...(spotifyTaste?.topTracks || []),
    ...(spotifyTaste?.recentTracks || []),
    ...(spotifyTaste?.savedTracks || []),
  ]
    .flatMap((track) => track.artists || [])
    .slice(0, 3);
  const localGenres = Object.entries(preferences.genres)
    .sort((left, right) => right[1] - left[1])
    .map(([name]) => name);
  const preferredGenres = [...new Set([...(spotifyTaste?.genres || []), ...localGenres])];
  const artists = [...new Set([...likedArtists, ...spotifyArtists, ...spotifyTrackArtists])].slice(0, 3);
  const genres = preferredGenres.slice(0, 2);
  const terms = [];
  if (artists.length) terms.push(`${genreSelect.value} ${artists.join(" ")}`);
  if (genres.length) terms.push(`${genreSelect.value} ${genres.join(" ")}`);
  return terms;
}

function rankTracks(catalog) {
  if (!isPersonalizationEnabled()) return shuffle(catalog);
  const preferences = readPreferences();
  const spotifyArtists = (spotifyTaste?.topArtists || []).map((artist) => artist.name.toLowerCase());
  const spotifyTrackArtists = [
    ...(spotifyTaste?.topTracks || []),
    ...(spotifyTaste?.recentTracks || []),
    ...(spotifyTaste?.savedTracks || []),
  ]
    .flatMap((track) => track.artists || [])
    .map((artist) => artist.toLowerCase());
  const spotifyGenres = (spotifyTaste?.genres || []).map((genre) => genre.toLowerCase());
  const topTrackIds = new Set(
    (spotifyTaste?.topTracks || []).map((track) =>
      trackIdentity({ artistName: track.artists.join(" "), trackName: track.name }),
    ),
  );
  const recentTrackIds = new Set(
    (spotifyTaste?.recentTracks || []).map((track) =>
      trackIdentity({ artistName: track.artists.join(" "), trackName: track.name }),
    ),
  );
  const selectedGenre = genreSelect.value.toLowerCase();
  return shuffle(catalog)
    .map((track) => {
      const identity = trackIdentity(track);
      const artist = track.artistName.toLowerCase();
      const title = track.trackName.toLowerCase();
      const feedback = preferences.signals[identity] || {};
      let score = 0;
      if (topTrackIds.has(identity)) score += 9;
      if (recentTrackIds.has(identity)) score -= 2;
      if (preferences.likes.includes(identity)) score += 12;
      if (feedback.likes) score += feedback.likes * 8;
      if (feedback.plays) score += Math.min(feedback.plays, 5) * 2;
      if (feedback.skips) score -= Math.min(feedback.skips, 5) * 4;
      if (feedback.completed) score += Math.min(feedback.completed, 5) * 2;
      if (
        [...spotifyArtists, ...spotifyTrackArtists].some(
          (name) => artist.includes(name) || name.includes(artist),
        )
      ) {
        score += 6;
      }
      if (spotifyGenres.some((genre) => artist.includes(genre) || title.includes(genre))) score += 2;
      if (artist.includes(selectedGenre) || title.includes(selectedGenre)) score += 1;
      return { track, score };
    })
    .sort((left, right) => right.score - left.score)
    .map(({ track }) => track);
}

function buildAiRequest(tracks, timeContext) {
  const weatherCode = currentWeather.weather_code;
  const spotifyPreferences =
    isPersonalizationEnabled() && spotifyTaste
      ? {
          topArtists: (spotifyTaste.topArtists || []).slice(0, 12).map((artist) => ({
            name: artist.name,
            genres: (artist.genres || []).slice(0, 5),
          })),
          genres: (spotifyTaste.genres || []).slice(0, 12),
          topTracks: (spotifyTaste.topTracks || []).slice(0, 12),
          recentTracks: (spotifyTaste.recentTracks || []).slice(0, 12),
          savedTracks: (spotifyTaste.savedTracks || []).slice(0, 12),
        }
      : null;
  return {
    context: {
      city: placeLabel(currentPlace),
      timezone: currentTimezone,
      localTime: timeContext.time,
      localDate: timeContext.day,
      weekday: timeContext.weekdayLabel,
      dayPart: timeContext.dayPart,
      temperatureC: currentWeather.temperature_2m,
      feelsLikeC: currentWeather.apparent_temperature,
      weatherCode,
      weatherDescription: weatherDescriptions[weatherCode] || "Переменная погода",
      windKmh: currentWeather.wind_speed_10m,
      precipitationMm: currentWeather.precipitation,
      rainMm: currentWeather.rain,
      snowfallCm: currentWeather.snowfall,
      cloudCoverPercent: currentWeather.cloud_cover,
      genre: genreSelect.value,
    },
    preferences: isPersonalizationEnabled()
      ? {
          spotify: spotifyPreferences,
          likedTracks: readPreferences().likes.slice(0, 30),
          interactionHistory: Object.values(readPreferences().signals)
            .filter((signal) => signal.likes || signal.plays || signal.skips)
            .slice(0, 40)
            .map(({ artist, track, likes, plays, skips, completed }) => ({
              artist,
              track,
              likes: likes || 0,
              plays: plays || 0,
              skips: skips || 0,
              completed: completed || 0,
            })),
          recentRecommendations: getRecentTracks().slice(0, 60),
        }
      : null,
    candidates: tracks.map((track) => ({
      id: track.trackId,
      title: track.trackName,
      artist: track.artistName,
      album: track.collectionName || "",
      identity: trackIdentity(track),
    })),
  };
}

async function generatePlaylist() {
  if (!currentWeather || !currentPlace) return;
  const requestId = ++playlistRequestId;
  setLoading(refreshButton, true, "Обновляем…");
  genreSelect.disabled = true;
  elements.playerNote.textContent = "Ищем реальные композиции в каталоге Apple Music…";
  trackList.classList.add("is-refreshing");
  try {
    const genre = genreSelect.value;
    const timeContext = getTimeContext();
    const mood = weatherTypes[getWeatherType(currentWeather.weather_code)];
    elements.moodTitle.textContent = mood.title;
    elements.moodCopy.textContent =
      `${mood.copy} Сейчас ${timeContext.dayPart}, ${timeContext.weekdayLabel}, ` +
      `${Math.round(currentWeather.temperature_2m)}°.`;
    const query = makeMusicQuery(currentWeather, genre, timeContext);
    const country = currentPlace.country_code || currentPlace.countryCode;
    const queries = [
      query,
      ...getTasteSearchTerms(),
      ...Array.from(
        new Set(
          [
            ...(spotifyTaste?.topTracks || []),
            ...(spotifyTaste?.savedTracks || []),
            ...(spotifyTaste?.recentTracks || []),
          ]
            .flatMap((track) => track.artists || [])
            .slice(0, 3),
        ),
      ).map((artist) => `${genre} ${artist} ${weatherTypes[getWeatherType(currentWeather.weather_code)].mood} music`),
    ];
    const results = await Promise.allSettled(
      queries.map((term) => searchMusic(term, country)),
    );
    let catalog = [
      ...new Map(
        results
          .filter((result) => result.status === "fulfilled")
          .flatMap((result) => result.value)
          .map((track) => [track.trackId, track]),
      ).values(),
    ];
    if (!catalog.length) {
      const failedQuery = results.find((result) => result.status === "rejected");
      if (failedQuery) throw failedQuery.reason;
    }
    if (catalog.length < 12) {
      const supplement = await searchMusic(`${genre} music`, country);
      catalog = [...new Map([...catalog, ...supplement].map((track) => [track.trackId, track])).values()];
    }
    if (requestId !== playlistRequestId) return;
    if (!catalog.length) {
      throw new Error("В каталоге не нашлось треков с доступным превью. Попробуйте другой жанр.");
    }
    const candidateTracks = chooseTracks(rankTracks(catalog)).slice(0, 40);
    let aiResult = null;
    if (aiToggle.checked && aiConfigured) {
      try {
        aiResult = await requestAppApi("/api/ai/playlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildAiRequest(candidateTracks, timeContext)),
        });
      } catch (error) {
        aiStatus.textContent = `AI недоступен: ${error.message}. Используем резервный подбор.`;
      }
    }
    if (requestId !== playlistRequestId) return;
    const recommendedIds = new Set(
      Array.isArray(aiResult?.trackIds) ? aiResult.trackIds : [],
    );
    if (recommendedIds.size) {
      const byId = new Map(candidateTracks.map((track) => [track.trackId, track]));
      const recentTracks = new Set(getRecentTracks());
      const aiTracks = [...recommendedIds]
        .map((id) => byId.get(id))
        .filter(Boolean);
      const freshAiTracks = aiTracks.filter((track) => !recentTracks.has(trackIdentity(track)));
      currentTracks = (freshAiTracks.length ? freshAiTracks : aiTracks).slice(0, 12);
      aiStatus.textContent = `AI-подбор завершён${aiResult.model ? ` · ${aiResult.model}` : ""}.`;
    } else {
      currentTracks = candidateTracks.slice(0, 12);
      if (aiToggle.checked && aiConfigured) {
        aiStatus.textContent = "AI не выбрал подходящие треки. Используем резервный подбор.";
      }
    }
    currentTrackIndex = currentTracks.length ? 0 : -1;
    const historySaved = rememberTracks(currentTracks);
    const weatherType = getWeatherType(currentWeather.weather_code);
    elements.playlistTitle.textContent = `${weatherTypes[weatherType].tag} · ${genre}`;
    elements.playlistDescription.textContent =
      `${currentTracks.length} треков · ${genre} · ${timeContext.dayPart}, ${timeContext.weekdayLabel}`;
    if (aiResult?.mood) elements.moodTitle.textContent = aiResult.mood;
    if (aiResult?.reason) {
      elements.moodCopy.textContent = aiResult.reason;
    } else if (aiToggle.checked && !aiConfigured) {
      aiStatus.textContent = "AI-подбор не настроен. Показаны базовые музыкальные рекомендации.";
    }
    elements.playerNote.textContent =
      "Слушайте 30-секундные превью; полный трек доступен на Apple Music или Spotify.";
    if (!historySaved) elements.playerNote.textContent += " История недоступна в браузере.";
    renderTracks();
    if (currentTrackIndex >= 0) selectTrack(0, false);
    statusMessage.textContent = "";
  } catch (error) {
    if (requestId === playlistRequestId) {
      statusMessage.textContent = error.message;
      elements.playerNote.textContent = "Не удалось загрузить рекомендации. Попробуйте обновить плейлист.";
    }
  } finally {
    if (requestId === playlistRequestId) {
      setLoading(refreshButton, false, "Обновляем…");
      genreSelect.disabled = false;
      trackList.classList.remove("is-refreshing");
    }
  }
}

const fallbackArtwork =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%23c1f56b' stop-opacity='.48'/%3E%3Cstop offset='1' stop-color='%23544346'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='120' height='120' rx='12' fill='url(%23g)'/%3E%3Cpath d='M67 28v49a12 12 0 1 1-7-11V42l35-8v36a12 12 0 1 1-7-11V25z' fill='%23f4f3ee' fill-opacity='.9'/%3E%3C/svg%3E";

function artworkSources(track) {
  const sources = [];
  const add = (value) => {
    if (typeof value !== "string") return;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !sources.includes(url.href)) {
        sources.push(url.href);
      }
    } catch {
      return;
    }
  };
  const addSized = (value) => {
    if (typeof value !== "string") return;
    add(value.replace(/\/100x100bb(\.[^/?#]+)(?=[?#]|$)/i, "/300x300bb$1"));
    add(value);
  };
  addSized(track.artworkUrl);
  addSized(track.artworkUrl100);
  addSized(track.image);
  addSized(track.album?.artworkUrl);
  addSized(track.album?.artworkUrl100);

  const imageCollections = [
    track.album?.images,
    track.images,
  ];
  for (const images of imageCollections) {
    if (!Array.isArray(images)) continue;
    for (const image of [...images].sort(
      (left, right) =>
        Math.abs((left?.width || 300) - 300) -
        Math.abs((right?.width || 300) - 300),
    )) {
      add(typeof image === "string" ? image : image?.url);
    }
  }
  return sources;
}

function setTrackArtwork(image, track) {
  const sources = artworkSources(track);
  let sourceIndex = 0;
  image.onerror = () => {
    if (image.src === fallbackArtwork) {
      image.onerror = null;
      return;
    }
    sourceIndex += 1;
    image.src = sources[sourceIndex] || fallbackArtwork;
  };
  image.src = sources[0] || fallbackArtwork;
}

function renderTracks() {
  trackList.replaceChildren();
  currentTracks.forEach((track, index) => {
    const item = document.createElement("li");
    item.className = "track-item";
    const button = document.createElement("button");
    button.className = "track-item-button";
    button.type = "button";
    button.setAttribute("aria-label", `Воспроизвести ${track.trackName} — ${track.artistName}`);
    const number = document.createElement("span");
    number.className = "track-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const cover = document.createElement("img");
    cover.className = "track-cover";
    cover.alt = "";
    cover.loading = "lazy";
    setTrackArtwork(cover, track);
    const info = document.createElement("span");
    info.className = "track-item-info";
    const title = document.createElement("strong");
    title.textContent = track.trackName;
    const artist = document.createElement("span");
    artist.textContent = track.artistName;
    info.append(title, artist);
    const play = document.createElement("span");
    play.className = "track-play-indicator";
    play.setAttribute("aria-hidden", "true");
    play.textContent = "▶";
    button.append(number, cover, info, play);
    button.addEventListener("click", () => selectTrack(index, true));
    item.append(button);
    trackList.append(item);
  });
  updateActiveTrack();
}

function updateActiveTrack() {
  [...trackList.children].forEach((item, index) => {
    const isActive = index === currentTrackIndex;
    item.classList.toggle("is-active", isActive);
    item.querySelector("button")?.setAttribute("aria-current", isActive ? "true" : "false");
    const indicator = item.querySelector(".track-play-indicator");
    if (indicator) indicator.textContent = isActive && !audioPlayer.paused ? "♫" : "▶";
  });
}

function selectTrack(index, autoplay) {
  const track = currentTracks[index];
  if (!track) return;
  if (autoplay) recordTrackSignal(track, "selected");
  currentTrackIndex = index;
  audioPlayer.pause();
  audioPlayer.src = track.previewUrl;
  setTrackArtwork(elements.albumArt, track);
  elements.albumArt.alt = `Обложка: ${track.collectionName || track.trackName}`;
  elements.spotifyLink.href =
    `https://open.spotify.com/search/${encodeURIComponent(`${track.trackName} ${track.artistName}`)}`;
  elements.appleLink.href = track.trackViewUrl;
  elements.nowPlaying.textContent = `${track.trackName} · ${track.artistName}`;
  elements.progress.value = "0";
  elements.progress.max = "30";
  elements.playerTime.textContent = "0:00 / 0:30";
  elements.playButton.textContent = "▶";
  elements.playButton.setAttribute("aria-label", "Воспроизвести");
  updateLikeButton();
  updateActiveTrack();
  if (autoplay) playCurrentTrack();
}

async function playCurrentTrack() {
  if (currentTrackIndex < 0 && currentTracks.length) selectTrack(0, false);
  if (!audioPlayer.src) return;
  try {
    await audioPlayer.play();
    elements.playButton.textContent = "Ⅱ";
    elements.playButton.setAttribute("aria-label", "Пауза");
    updateActiveTrack();
  } catch (error) {
    statusMessage.textContent =
      error.name === "NotAllowedError"
        ? "Браузер запретил воспроизведение. Нажмите «Воспроизвести» ещё раз."
        : "Это превью сейчас недоступно. Попробуйте следующий трек.";
  }
}

function togglePlayback() {
  if (audioPlayer.paused) {
    playCurrentTrack();
  } else {
    audioPlayer.pause();
  }
}

function moveTrack(direction, { naturalEnd = false } = {}) {
  if (!currentTracks.length) return;
  if (!naturalEnd) recordTrackSignal(currentTracks[currentTrackIndex], "skips");
  let nextIndex;
  if (isShuffling && direction > 0 && currentTracks.length > 1) {
    do {
      nextIndex = Math.floor(Math.random() * currentTracks.length);
    } while (nextIndex === currentTrackIndex);
  } else {
    nextIndex = (currentTrackIndex + direction + currentTracks.length) % currentTracks.length;
  }
  selectTrack(nextIndex, !naturalEnd);
  if (naturalEnd) playCurrentTrack();
}

function updateLikeButton() {
  const track = currentTracks[currentTrackIndex];
  const isLiked = Boolean(track && readPreferences().likes.includes(trackIdentity(track)));
  likeButton.classList.toggle("is-liked", isLiked);
  likeButton.setAttribute("aria-pressed", String(isLiked));
  likeButton.setAttribute("aria-label", isLiked ? "Убрать из понравившихся" : "Нравится трек");
  likeButton.textContent = isLiked ? "♥" : "♡";
}

function toggleLike() {
  const track = currentTracks[currentTrackIndex];
  if (!track) return;
  const preferences = readPreferences();
  const identity = trackIdentity(track);
  const existingIndex = preferences.likes.indexOf(identity);
  if (existingIndex >= 0) {
    preferences.likes.splice(existingIndex, 1);
    if (preferences.signals[identity]) {
      preferences.signals[identity].likes = Math.max(
        0,
        (preferences.signals[identity].likes || 0) - 1,
      );
    }
  } else {
    preferences.likes.push(identity);
    const signals = preferences.signals[identity] || {
      plays: 0,
      skips: 0,
      completed: 0,
      selected: 0,
    };
    signals.likes = (signals.likes || 0) + 1;
    signals.artist = track.artistName;
    signals.track = track.trackName;
    preferences.signals[identity] = signals;
  }
  if (savePreferences(preferences)) updateLikeButton();
}

async function loadSpotifyTaste() {
  if (!isPersonalizationEnabled()) return;
  try {
    spotifyTaste = await requestAppApi("/api/spotify/profile");
    const artists = spotifyTaste.topArtists.map((artist) => artist.name).slice(0, 5);
    const genres = spotifyTaste.genres.slice(0, 5);
    const topTracks = spotifyTaste.topTracks
      .slice(0, 5)
      .map((track) => `${track.name} — ${track.artists.join(", ")}`);
    const recentTracks = spotifyTaste.recentTracks
      .slice(0, 3)
      .map((track) => `${track.name} — ${track.artists.join(", ")}`);
    const savedTracks = spotifyTaste.savedTracks
      .slice(0, 3)
      .map((track) => `${track.name} — ${track.artists.join(", ")}`);
    const display = [];
    if (spotifyTaste.displayName) display.push(`Аккаунт: ${spotifyTaste.displayName}.`);
    if (artists.length) display.push(`Любимые исполнители: ${artists.join(", ")}.`);
    if (genres.length) display.push(`Жанры из профиля: ${genres.join(", ")}.`);
    if (topTracks.length) display.push(`Топ-треки: ${topTracks.join("; ")}.`);
    if (recentTracks.length) display.push(`Недавно: ${recentTracks.join("; ")}.`);
    if (savedTracks.length) display.push(`Сохранено: ${savedTracks.join("; ")}.`);
    if (!genres.length) {
      display.push(
        "Spotify не предоставил жанры исполнителей; учитываются топ-треки и выбранный вами жанр.",
      );
    }
    spotifyPreferences.textContent = display.join(" ");
    spotifyStatus.textContent = spotifyTaste.unavailable?.length
      ? `Аккаунт подключён; Spotify ограничил часть данных (${spotifyTaste.unavailable.join(", ")}).`
      : "Аккаунт подключён. Учитываются разрешённые Spotify данные.";
    await generatePlaylist();
  } catch (error) {
    spotifyTaste = null;
    spotifyStatus.textContent = error.message;
    spotifyPreferences.textContent = "";
  }
}

async function initializeAi() {
  try {
    aiToggle.checked = localStorage.getItem(AI_ENABLED_KEY) === "true";
  } catch {
    aiToggle.checked = false;
  }
  try {
    const status = await requestAppApi("/api/ai/status");
    aiConfigured = status.configured;
    if (!aiConfigured) {
      aiStatus.textContent =
        status.error ||
        "AI-подбор не настроен. Можно продолжать пользоваться базовыми рекомендациями.";
    } else if (aiToggle.checked) {
      aiStatus.textContent = `AI-подбор доступен · ${status.model}. Контекст отправляется провайдеру только с вашего согласия.`;
    } else {
      aiStatus.textContent = `AI-подбор доступен · ${status.model}. Включите настройку выше, чтобы передавать контекст AI-провайдеру.`;
    }
  } catch {
    aiConfigured = false;
    aiStatus.textContent =
      "AI-сервер недоступен. Будут использоваться базовые музыкальные рекомендации.";
  }
}

async function initializeSpotify() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("spotify")) {
    spotifyStatus.textContent = "Аккаунт Spotify подключён. Загружаем разрешённые данные профиля…";
    history.replaceState(null, "", window.location.pathname);
  } else if (params.has("spotify_error")) {
    spotifyStatus.textContent =
      params.get("spotify_error") === "access_denied"
        ? "Подключение Spotify отменено."
        : "Не удалось безопасно завершить авторизацию. Попробуйте снова.";
    history.replaceState(null, "", window.location.pathname);
  }
  try {
    const status = await requestAppApi("/api/spotify/status");
    if (!status.configured) {
      spotifyStatus.textContent =
        status.error || "Spotify OAuth не настроен на сервере. См. инструкции в README.md.";
      spotifyConnectButton.disabled = true;
      return;
    }
    if (status.connected) {
      spotifyConnectButton.hidden = true;
      spotifyDisconnectButton.hidden = false;
      spotifyRevokeLink.hidden = false;
      spotifyStatus.textContent = "Аккаунт Spotify подключён.";
      if (isPersonalizationEnabled()) await loadSpotifyTaste();
      return;
    }
    spotifyConnectButton.hidden = false;
    spotifyStatus.textContent =
      "Подключите аккаунт, чтобы учитывать доступные топ-треки, исполнителей и историю.";
  } catch {
    spotifyStatus.textContent =
      "Не удалось связаться с серверным OAuth API. Проверьте deployment и настройки Spotify на сервере.";
    spotifyConnectButton.disabled = true;
  }
}

async function connectSpotify() {
  spotifyConnectButton.disabled = true;
  spotifyStatus.textContent = "Подготавливаем безопасную авторизацию Spotify…";
  try {
    const result = await requestAppApi("/api/spotify/login", { method: "POST" });
    const authorizationUrl = new URL(result.authorizationUrl);
    if (
      authorizationUrl.protocol !== "https:" ||
      authorizationUrl.hostname !== "accounts.spotify.com"
    ) {
      throw new Error("Сервер вернул недопустимый адрес авторизации.");
    }
    window.location.assign(authorizationUrl);
  } catch (error) {
    spotifyStatus.textContent = error.message;
    spotifyConnectButton.disabled = false;
  }
}

async function disconnectSpotify() {
  spotifyDisconnectButton.disabled = true;
  try {
    const result = await requestAppApi("/api/spotify/disconnect", { method: "POST" });
    spotifyTaste = null;
    spotifyConnectButton.hidden = false;
    spotifyDisconnectButton.hidden = true;
    spotifyRevokeLink.hidden = true;
    spotifyPreferences.textContent = "";
    spotifyStatus.textContent = result.message;
    await generatePlaylist();
  } catch (error) {
    spotifyStatus.textContent = error.message;
  } finally {
    spotifyDisconnectButton.disabled = false;
  }
}

searchButton.addEventListener("click", searchAndLoadCity);
cityInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchAndLoadCity();
});
locationButton.addEventListener("click", requestLocation);
refreshButton.addEventListener("click", generatePlaylist);
genreSelect.addEventListener("change", () => {
  recordGenrePreference(genreSelect.value);
  generatePlaylist();
});
likeButton.addEventListener("click", toggleLike);
spotifyConnectButton.addEventListener("click", connectSpotify);
spotifyDisconnectButton.addEventListener("click", disconnectSpotify);
personalizationToggle.addEventListener("change", async () => {
  try {
    localStorage.setItem(PERSONALIZATION_KEY, String(isPersonalizationEnabled()));
  } catch {
    statusMessage.textContent = "Не удалось сохранить настройку персонализации.";
  }
  if (isPersonalizationEnabled()) {
    const status = await requestAppApi("/api/spotify/status").catch(() => null);
    if (status?.connected) {
      await loadSpotifyTaste();
    } else {
      await generatePlaylist();
    }
  } else {
    spotifyTaste = null;
    spotifyStatus.textContent = "Персональные данные временно исключены из рекомендаций.";
    await generatePlaylist();
  }
});
aiToggle.addEventListener("change", async () => {
  try {
    localStorage.setItem(AI_ENABLED_KEY, String(aiToggle.checked));
  } catch {
    aiToggle.checked = false;
    aiStatus.textContent = "Не удалось сохранить согласие на передачу данных AI.";
    return;
  }
  if (aiToggle.checked && !aiConfigured) {
    aiStatus.textContent = "AI API не настроен. Подборка продолжит работать в резервном режиме.";
  } else if (aiToggle.checked) {
    aiStatus.textContent = "Обновляем подборку с помощью AI-модели…";
  } else {
    aiStatus.textContent = "AI-подбор выключен. Персональные данные не передаются AI-провайдеру.";
  }
  await generatePlaylist();
});
elements.playButton.addEventListener("click", togglePlayback);
elements.previousButton.addEventListener("click", () => {
  if (audioPlayer.currentTime > 3) {
    audioPlayer.currentTime = 0;
    return;
  }
  moveTrack(-1);
});
elements.nextButton.addEventListener("click", () => moveTrack(1));
elements.shuffleButton.addEventListener("click", () => {
  isShuffling = !isShuffling;
  elements.shuffleButton.setAttribute("aria-pressed", String(isShuffling));
  elements.shuffleButton.classList.toggle("is-on", isShuffling);
});
elements.progress.addEventListener("input", () => {
  audioPlayer.currentTime = Number(elements.progress.value);
});
audioPlayer.addEventListener("loadedmetadata", () => {
  if (Number.isFinite(audioPlayer.duration)) elements.progress.max = String(audioPlayer.duration);
});
audioPlayer.addEventListener("timeupdate", () => {
  const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 30;
  elements.progress.max = String(duration);
  elements.progress.value = String(audioPlayer.currentTime);
  elements.playerTime.textContent = `${formatTime(audioPlayer.currentTime)} / ${formatTime(duration)}`;
});
audioPlayer.addEventListener("play", updateActiveTrack);
audioPlayer.addEventListener("play", () => {
  recordTrackSignal(currentTracks[currentTrackIndex], "plays");
});
audioPlayer.addEventListener("pause", () => {
  elements.playButton.textContent = "▶";
  elements.playButton.setAttribute("aria-label", "Воспроизвести");
  updateActiveTrack();
});
audioPlayer.addEventListener("ended", () => {
  recordTrackSignal(currentTracks[currentTrackIndex], "completed");
  moveTrack(1, { naturalEnd: true });
});
audioPlayer.addEventListener("error", () => {
  if (audioPlayer.src) statusMessage.textContent = "Не удалось загрузить превью. Попробуйте следующий трек.";
});

function updateCityClock() {
  if (!currentWeather) return;
  const context = getTimeContext();
  weatherElements.localTime.textContent = context.time;
  weatherElements.localDay.textContent = context.day;
  if (context.signature === lastTimeContext) return;
  lastTimeContext = context.signature;
  document.body.dataset.timeOfDay = context.dayPart;
  elements.moodCopy.textContent =
    `${weatherTypes[getWeatherType(currentWeather.weather_code)].copy} Сейчас ` +
    `${context.dayPart}, ${context.weekdayLabel}, ${Math.round(currentWeather.temperature_2m)}°.` +
    (currentWeather.temperature_2m <= 5 && getWeatherType(currentWeather.weather_code) !== "snow"
      ? " Одевайся потеплее!"
      : "");
  generatePlaylist();
}

async function initialize() {
  try {
    personalizationToggle.checked =
      localStorage.getItem(PERSONALIZATION_KEY) !== "false";
  } catch {
    personalizationToggle.checked = false;
  }
  await initializeAi();
  updateLikeButton();
  initializeSpotify();
  const savedPlace = loadSavedPlace();
  cityInput.value = savedPlace?.name || "Москва";
  let locationNotice = "";
  const selectionVersion = placeSelectionVersion;
  const geoPromise = getCoordinates()
    .then(({ coords }) => reverseGeocode(coords.latitude, coords.longitude))
    .catch((error) => {
      locationNotice = geolocationError(error);
      return null;
    });
  const place = await geoPromise;
    if (selectionVersion !== placeSelectionVersion) return;
    if (place) {
    await loadWeather(place);
    return;
  }
  const fallback = savedPlace || (await findCity("Москва").catch((error) => {
    statusMessage.textContent = `${statusMessage.textContent} ${error.message}`.trim();
    return null;
  }));
  if (fallback) {
    await loadWeather(fallback);
    if (locationNotice) statusMessage.textContent = locationNotice;
  }
}

initialize();
window.setInterval(updateCityClock, 1000);
window.setInterval(() => {
  if (currentPlace) loadWeather(currentPlace, { onlyIfContextChanged: true });
}, 15 * 60 * 1000);
