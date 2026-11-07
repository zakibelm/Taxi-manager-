import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import { Service } from '../types';
import { DAYS, SLOTS, hotspots, locatedRides, localParts, recommendZones, slotOf, MIN_SLOT } from '../utils/zones.mjs';
import { LEVEL_STYLE, MAP_TILES } from '../utils/mapConfig';

const money = (n: number) => n.toFixed(2).replace('.', ',') + ' $';
const pct = (n: number) => Math.round(n * 100) + ' %';

/** Carte des secteurs d'achalandage prévus (rayon 5 km) : vert = forte, jaune = moyenne, rouge = faible.
 *  Basée sur les courses localisées, pour une tranche horaire (et, au choix, le même jour de la semaine). */
const ZoneMap: React.FC<{ services: Service[] }> = ({ services }) => {
  const initial = useMemo(() => {
    const now = new Date(), here = localParts(now), slot = slotOf(here.hour);
    return { slotId: slot.id, day: here.day, sameDay: recommendZones(services, now).basis === 'day-slot' };
  // Valeurs de départ : calculées une seule fois, ensuite le chauffeur choisit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [slotId, setSlotId] = useState(initial.slotId);
  const [sameDay, setSameDay] = useState(initial.sameDay);

  const result = useMemo(() => hotspots(locatedRides(services, { slotId, day: sameDay ? initial.day : null })), [services, slotId, sameDay, initial.day]);
  const totalLocated = useMemo(() => locatedRides(services).length, [services]);

  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const showMap = result.status === 'ok';

  // Création de la carte (Leaflet est chargé à la demande : il n'alourdit pas le démarrage de l'application).
  useEffect(() => {
    if (!showMap) {
      // Le conteneur disparaît quand il n'y a plus de secteur : la carte est détruite pour être recréée plus tard.
      mapRef.current?.remove(); mapRef.current = null; layerRef.current = null; setReady(false);
      return;
    }
    if (!box.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const [leaflet] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
        if (cancelled || !box.current) return;
        const L = (leaflet as unknown as { default?: typeof import('leaflet') }).default ?? (leaflet as typeof import('leaflet'));
        leafletRef.current = L;
        const map = L.map(box.current, { scrollWheelZoom: false, attributionControl: true }).setView([45.55, -73.6], 10);
        // referrerPolicy « origin » : le serveur de tuiles exige un référent, alors que l'application n'en envoie jamais ailleurs.
        L.tileLayer(MAP_TILES.url, { attribution: MAP_TILES.attribution, maxZoom: MAP_TILES.maxZoom, referrerPolicy: 'origin' } as import('leaflet').TileLayerOptions).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        setReady(true);
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; };
  }, [showMap]);

  // Libération de la carte au démontage.
  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; layerRef.current = null; }, []);

  // Cercles : un par secteur, rayon réel de 5 km.
  useEffect(() => {
    const L = leafletRef.current, map = mapRef.current, layer = layerRef.current;
    if (!ready || !L || !map || !layer) return;
    layer.clearLayers();
    if (!result.spots.length) return;
    const bounds = L.latLngBounds([]);
    for (const s of result.spots) {
      const style = LEVEL_STYLE[s.level as keyof typeof LEVEL_STYLE];
      const circle = L.circle([s.lat, s.lng], { radius: s.radiusKm * 1000, color: style.color, weight: 2, fillColor: style.color, fillOpacity: 0.3 });
      circle.bindTooltip(`${style.label} · ${s.count} appel${s.count > 1 ? 's' : ''} · ${money(s.averageAmount)} en moyenne`);
      circle.addTo(layer);
      bounds.extend(circle.getBounds());
    }
    map.invalidateSize();
    map.fitBounds(bounds.pad(0.1));
  }, [ready, result]);

  return (
    <section aria-labelledby="zonemap-title" className="bg-white rounded-[28px] p-6 shadow-sm border border-slate-100 space-y-4">
      <div>
        <h3 id="zonemap-title" className="font-bold text-slate-900 flex items-center gap-2"><MapIcon size={18} className="text-red-600" aria-hidden="true" /> Carte des zones d’achalandage</h3>
        <p className="text-xs text-slate-500 mt-1">Secteurs de 5 km autour de vos appels localisés. Vert : forte, jaune : moyenne, rouge : faible.</p>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Tranche horaire">
        {SLOTS.map(s => (
          <button key={s.id} type="button" onClick={() => setSlotId(s.id)} aria-pressed={slotId === s.id}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${slotId === s.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
            {s.label.split(' (')[0]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" className="h-4 w-4 accent-red-600" checked={sameDay} onChange={e => setSameDay(e.target.checked)} />
        Seulement les {DAYS[initial.day]}s
      </label>

      {!showMap ? (
        <p className="text-sm text-slate-500">
          {totalLocated === 0
            ? 'Cochez « Localiser l’origine de l’appel » en saisissant vos courses : la carte se remplit au fil de vos appels.'
            : `Pas assez d’appels localisés pour cette période (il en faut au moins ${MIN_SLOT}). Essayez une autre tranche horaire${sameDay ? ' ou décochez « Seulement les ' + DAYS[initial.day] + 's »' : ''}.`}
        </p>
      ) : (
        <>
          {failed
            ? <p role="alert" className="text-sm text-amber-700">La carte n’a pas pu se charger (connexion requise). La liste ci-dessous reste valable.</p>
            : <div ref={box} role="img" aria-label="Carte des secteurs d’achalandage" className="h-72 w-full rounded-2xl overflow-hidden border border-slate-100 z-0" />}
          <ul className="space-y-2">
            {result.spots.map((s, i) => {
              const style = LEVEL_STYLE[s.level as keyof typeof LEVEL_STYLE];
              return (
                <li key={`${s.lat},${s.lng}`} className="flex items-start gap-3 text-sm">
                  <span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: style.color }} />
                  <span className="text-slate-700">
                    <strong>{style.label}</strong> · secteur {i + 1} ({s.lat.toFixed(3)}, {s.lng.toFixed(3)}) : {s.count} appel{s.count > 1 ? 's' : ''} ({pct(s.share)}), {money(s.averageAmount)} en moyenne, surtout « {s.topType} »
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-slate-400">Fond de carte © OpenStreetMap. Calculé sur {result.located} appel{result.located > 1 ? 's' : ''} localisé{result.located > 1 ? 's' : ''}.</p>
        </>
      )}
    </section>
  );
};

export default ZoneMap;
