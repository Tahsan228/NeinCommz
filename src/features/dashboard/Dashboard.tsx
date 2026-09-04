import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../../state/session';
import { presenceOf, useDirectory } from '../../state/directory';
import { Icon, type IconName } from '../../components/Icon';
import { resolveStatus } from '../status/statusEngine';
import { minutesOfDay, relativeMinutes } from '../../lib/time';

/**
 * The small board of things worth knowing without asking anyone.
 *
 * Weather comes from Open-Meteo, which needs no API key and no account — the
 * only sensible choice for something that ships in a client bundle. Location
 * is asked for once and remembered; declining leaves the rest of the panel
 * working, because none of it depends on the weather.
 */

const LOCATION_KEY = 'neincommz.coords';

interface Weather {
  temp: number;
  feels: number;
  code: number;
  wind: number;
  high: number;
  low: number;
  isDay: boolean;
  place: string;
}

/** WMO weather codes, condensed to what a person actually wants told. */
function describe(code: number): { text: string; icon: IconName } {
  if (code === 0) return { text: 'Clear', icon: 'circle' };
  if (code <= 2) return { text: 'Mostly clear', icon: 'circle' };
  if (code === 3) return { text: 'Overcast', icon: 'circle' };
  if (code <= 48) return { text: 'Fog', icon: 'circle' };
  if (code <= 57) return { text: 'Drizzle', icon: 'circle' };
  if (code <= 67) return { text: 'Rain', icon: 'circle' };
  if (code <= 77) return { text: 'Snow', icon: 'snowflake' };
  if (code <= 82) return { text: 'Showers', icon: 'circle' };
  if (code <= 86) return { text: 'Snow showers', icon: 'snowflake' };
  return { text: 'Thunderstorms', icon: 'zap' };
}

function readSavedCoords(): { lat: number; lon: number } | null {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    return raw ? (JSON.parse(raw) as { lat: number; lon: number }) : null;
  } catch {
    return null;
  }
}

export function Dashboard() {
  const { profile, prefs } = useSession();
  const { profiles, blocksFor, presence } = useDirectory();

  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherState, setWeatherState] = useState<'idle' | 'loading' | 'denied' | 'failed'>('idle');

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const load = useMemo(
    () => async (lat: number, lon: number) => {
      setWeatherState('loading');
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          '&current=temperature_2m,apparent_temperature,is_day,weather_code,wind_speed_10m' +
          '&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit' +
          '&wind_speed_unit=mph&timezone=auto&forecast_days=1';

        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as {
          current: {
            temperature_2m: number;
            apparent_temperature: number;
            is_day: number;
            weather_code: number;
            wind_speed_10m: number;
          };
          daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
          timezone: string;
        };

        setWeather({
          temp: Math.round(json.current.temperature_2m),
          feels: Math.round(json.current.apparent_temperature),
          code: json.current.weather_code,
          wind: Math.round(json.current.wind_speed_10m),
          high: Math.round(json.daily.temperature_2m_max[0]),
          low: Math.round(json.daily.temperature_2m_min[0]),
          isDay: json.current.is_day === 1,
          place: json.timezone.split('/').pop()?.replace(/_/g, ' ') ?? 'here',
        });
        setWeatherState('idle');
      } catch {
        setWeatherState('failed');
      }
    },
    [],
  );

  useEffect(() => {
    const saved = readSavedCoords();
    if (saved) void load(saved.lat, saved.lon);
  }, [load]);

  const askForLocation = () => {
    if (!('geolocation' in navigator)) {
      setWeatherState('denied');
      return;
    }
    setWeatherState('loading');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const coords = {
          // Two decimals is a neighbourhood, which is all a forecast needs —
          // no reason to send anyone's exact position to a weather service.
          lat: Math.round(p.coords.latitude * 100) / 100,
          lon: Math.round(p.coords.longitude * 100) / 100,
        };
        try {
          localStorage.setItem(LOCATION_KEY, JSON.stringify(coords));
        } catch {
          /* private mode; it will ask again next time */
        }
        void load(coords.lat, coords.lon);
      },
      () => setWeatherState('denied'),
      { timeout: 8000, maximumAge: 600_000 },
    );
  };

  /* ------------------------------------------------------------ my day -- */
  const mine = profile ? blocksFor(profile.id) : [];
  const weekday = now.getDay();
  const minute = minutesOfDay(now);

  const nextUp = mine
    .filter((b) => b.days.includes(weekday) && b.start_min > minute)
    .sort((a, b) => a.start_min - b.start_min)[0];

  const freeNow = profiles.filter((p) => {
    const s = resolveStatus(p, blocksFor(p.id), presenceOf(presence, p.id), now);
    return s.free && s.presence !== 'offline';
  });

  // Friday afternoon is a different feeling from Monday morning.
  const toWeekend = weekday === 0 || weekday === 6 ? 0 : 6 - weekday;

  const conditions = weather ? describe(weather.code) : null;

  return (
    <div className="dash">
      <div className="dash-card dash-clock">
        <div className="dash-time">
          {now.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
            hour12: !prefs.clock24,
          })}
        </div>
        <div className="dash-date">
          {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>

      <div className="dash-card">
        {weather && conditions ? (
          <>
            <div className="dash-row">
              <Icon name={conditions.icon} size={17} />
              <span className="dash-temp">{weather.temp}°</span>
              <span className="dash-cond">{conditions.text}</span>
            </div>
            <div className="dash-sub">
              Feels {weather.feels}° · H {weather.high}° L {weather.low}° · wind {weather.wind} mph
            </div>
            <div className="dash-sub">{weather.place}</div>
          </>
        ) : weatherState === 'loading' ? (
          <div className="dash-sub">Checking the sky…</div>
        ) : weatherState === 'denied' ? (
          <div className="dash-sub">Location declined — no weather, everything else still works.</div>
        ) : weatherState === 'failed' ? (
          <button className="btn btn-sm" onClick={askForLocation}>
            Weather unavailable — retry
          </button>
        ) : (
          <button className="btn btn-sm" onClick={askForLocation}>
            <Icon name="snowflake" size={14} />
            Show local weather
          </button>
        )}
      </div>

      <div className="dash-card">
        <div className="dash-label">Up next</div>
        {nextUp ? (
          <>
            <div className="dash-row">
              <Icon name="clock" size={16} />
              <b>{nextUp.label}</b>
            </div>
            <div className="dash-sub">{relativeMinutes(nextUp.start_min - minute)}</div>
          </>
        ) : (
          <div className="dash-sub">
            {mine.length === 0 ? 'No schedule set up yet.' : 'Nothing left today.'}
          </div>
        )}
      </div>

      <div className="dash-card">
        <div className="dash-label">Free right now</div>
        {freeNow.length === 0 ? (
          <div className="dash-sub">Nobody, apparently.</div>
        ) : (
          <div className="dash-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <b>{freeNow.length}</b>
            <span className="dash-sub" style={{ margin: 0 }}>
              {freeNow
                .slice(0, 3)
                .map((p) => p.display_name)
                .join(', ')}
              {freeNow.length > 3 && ` +${freeNow.length - 3}`}
            </span>
          </div>
        )}
        <div className="dash-sub">
          {toWeekend === 0
            ? "It's the weekend."
            : toWeekend === 1
              ? 'One more day.'
              : `${toWeekend} days to the weekend.`}
        </div>
      </div>
    </div>
  );
}
