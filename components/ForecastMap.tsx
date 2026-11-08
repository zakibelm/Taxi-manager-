import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { Forecast, ForecastSlot, placeZone, removeZone } from '../services/forecast';
import { localParts } from '../utils/zones.mjs';
import { LEVEL_STYLE, MAP_TILES } from '../utils/mapConfig';

type Ready = Extract<Forecast, { ready: true }>;
const SLOTS: [ForecastSlot, string, number, number][] = [['0-6', '0 h – 6 h', 0, 6], ['6-10', '6 h – 10 h', 6, 10], ['10-14', '10 h – 14 h', 10, 14], ['14-18', '14 h – 18 h', 14, 18], ['18-24', '18 h – 24 h', 18, 24]];
const num = (n: number) => String(n).replace('.', ',');

/** Carte des prévisions en cours : demande attendue par zone de répartition, pour la plage horaire choisie (l'heure actuelle par défaut).
 *  Le journal DataTaxi ne contient aucune coordonnée : l'administrateur place chaque zone une fois en cliquant sur la carte. */
const ForecastMap: React.FC<{ data: Ready; isAdmin: boolean; onChanged: () => void }> = ({ data, isAdmin, onChanged }) => {
  const initial = useMemo(() => {
    const here = localParts(new Date());
    return { slot: (SLOTS.find(s => here.hour >= s[2] && here.hour < s[3]) ?? SLOTS[0])[0], kind: (here.day === 0 || here.day === 6 ? 'weekend' : 'weekday') as 'weekday' | 'weekend', hour: here.hour };
  }, []);
  const [slot, setSlot] = useState<ForecastSlot>(initial.slot);
  const [kind, setKind] = useState<'weekday' | 'weekend'>(initial.kind);
  const [placing, setPlacing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const placingRef = useRef<string | null>(null);
  placingRef.current = placing;

  const entries = data.zones[kind][slot];
  const peak = Math.max(...entries.map(e => e.perHour), 0.1);
  const levelOf = (perHour: number) => perHour / peak >= 0.66 ? 'forte' : perHour / peak >= 0.33 ? 'moyenne' : 'faible';
  const missing = entries.filter(e => !data.positions[e.zone]);

  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!box.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const [leaflet] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
        if (cancelled || !box.current) return;
        const L = (leaflet as unknown as { default?: typeof import('leaflet') }).default ?? (leaflet as typeof import('leaflet'));
        leafletRef.current = L;
        const map = L.map(box.current, { scrollWheelZoom: false, attributionControl: true }).setView([45.65, -73.6], 10);
        L.tileLayer(MAP_TILES.url, { attribution: MAP_TILES.attribution, maxZoom: MAP_TILES.maxZoom, referrerPolicy: 'origin' } as import('leaflet').TileLayerOptions).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        map.on('click', (e: import('leaflet').LeafletMouseEvent) => {
          const zone = placingRef.current;
          if (!zone) return;
          setBusy(true); setError('');
          placeZone(zone, e.latlng.lat, e.latlng.lng)
            .then(() => { setPlacing(null); onChanged(); })
            .catch(err => setError(err instanceof Error ? err.message : 'Enregistrement impossible.'))
            .finally(() => setBusy(false));
        });
        mapRef.current = map;
        setReady(true);
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; layerRef.current = null; }, []);

  // Un cercle par zone placée : rayon et couleur selon la demande attendue par heure.
  useEffect(() => {
    const L = leafletRef.current, map = mapRef.current, layer = layerRef.current;
    if (!ready || !L || !map || !layer) return;
    layer.clearLayers();
    const bounds = L.latLngBounds([]);
    for (const e of entries) {
      const pos = data.positions[e.zone];
      if (!pos) continue;
      const style = LEVEL_STYLE[levelOf(e.perHour)];
      const circle = L.circle([pos.lat, pos.lng], { radius: 600 + 1400 * (e.perHour / peak), color: style.color, weight: 2, fillColor: style.color, fillOpacity: 0.3 });
      circle.bindTooltip(`Zone ${e.zone} · environ ${num(e.perHour)} appel${e.perHour >= 2 ? 's' : ''} par heure · ${e.share} % des appels`, { permanent: false });
      circle.addTo(layer);
      L.marker([pos.lat, pos.lng], { icon: L.divIcon({ className: '', html: `<div style="transform:translate(-50%,-50%);font:700 12px system-ui;color:#0f172a;text-shadow:0 0 3px #fff,0 0 3px #fff">${e.zone}</div>`, iconSize: [0, 0] }), interactive: false }).addTo(layer);
      bounds.extend(circle.getBounds());
    }
    map.invalidateSize();
    if (bounds.isValid()) map.fitBounds(bounds.pad(0.2), { maxZoom: 13 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, data, kind, slot]);

  const remove = (zone: string) => {
    setBusy(true); setError('');
    removeZone(zone).then(onChanged).catch(err => setError(err instanceof Error ? err.message : 'Enregistrement impossible.')).finally(() => setBusy(false));
  };

  return (
    <section aria-labelledby="fmap-title" className="rounded-2xl bg-white p-4 shadow-sm border border-slate-100 space-y-3">
      <div>
        <h3 id="fmap-title" className="font-semibold text-slate-900 flex items-center gap-2"><MapIcon size={18} className="text-red-600" aria-hidden="true" /> Prévisions en cours sur la carte</h3>
        <p className="text-xs text-slate-500 mt-1">
          Demande attendue par zone de répartition ({kind === 'weekday' ? 'semaine' : 'fin de semaine'}, {SLOTS.find(s => s[0] === slot)![1]}). Vert = forte, jaune = moyenne, rouge = faible ; la taille du cercle suit la demande.
          {slot === initial.slot && kind === initial.kind && <> Plage actuelle ({initial.hour} h).</>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Plage horaire">
        {SLOTS.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setSlot(id)} aria-pressed={slot === id}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border ${slot === id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>{label}</button>
        ))}
        <button type="button" onClick={() => setKind(kind === 'weekday' ? 'weekend' : 'weekday')}
          className="px-3 py-1.5 rounded-full text-xs font-bold border bg-white text-slate-600 border-slate-200">
          {kind === 'weekday' ? 'Semaine' : 'Fin de semaine'} ↔
        </button>
      </div>

      {placing && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Cliquez sur la carte à l’endroit du centre de la zone <strong>{placing}</strong>. <button type="button" className="underline" onClick={() => setPlacing(null)}>Annuler</button></p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {failed
        ? <p role="alert" className="text-sm text-amber-700">La carte n’a pas pu se charger (connexion requise). La liste ci-dessous reste valable.</p>
        : <div ref={box} role="img" aria-label="Carte des prévisions par zone" className={`h-80 w-full rounded-2xl overflow-hidden border border-slate-100 z-0 ${placing ? 'cursor-crosshair' : ''}`} />}

      <ul className="divide-y divide-slate-100 text-sm">
        {entries.map(e => {
          const placed = !!data.positions[e.zone], style = LEVEL_STYLE[levelOf(e.perHour)];
          return (
            <li key={e.zone} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: style.color }} />
              <span className="text-slate-800"><strong>Zone {e.zone}</strong> · {style.label.toLowerCase()} · environ {num(e.perHour)} par heure ({e.share} %)</span>
              {isAdmin ? (
                <span className="ml-auto flex gap-2">
                  <button type="button" disabled={busy} onClick={() => setPlacing(e.zone)} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-700">{placed ? 'Déplacer' : 'Placer sur la carte'}</button>
                  {placed && <button type="button" disabled={busy} onClick={() => remove(e.zone)} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-500">Retirer</button>}
                </span>
              ) : !placed && <span className="ml-auto text-xs text-slate-400">Position à définir par l’administrateur</span>}
            </li>
          );
        })}
      </ul>
      {missing.length > 0 && <p className="text-xs text-slate-500">{missing.length} zone{missing.length > 1 ? 's' : ''} sans position : {isAdmin ? 'placez-les une fois, la carte s’en souviendra pour tout le monde.' : 'elles apparaîtront sur la carte dès qu’elles seront placées.'}</p>}
      <p className="text-xs text-slate-400">Fond de carte © OpenStreetMap.</p>
    </section>
  );
};

export default ForecastMap;
