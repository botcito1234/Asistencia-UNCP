/**
 * Mapa de una marcacion.
 *
 * Decision: Leaflet con teselas de OpenStreetMap. No exige clave de API, con lo
 * que el sistema se puede desplegar sin depender de una cuenta de un proveedor
 * comercial. Si la institucion prefiere otro proveedor, basta cambiar
 * VITE_MAP_TILE_URL en el entorno; la clave queda en la configuracion del panel
 * y nunca en el codigo.
 */
import { MapContainer, TileLayer, Circle, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { metros } from '../lib/format';

const TILE_URL =
  (import.meta.env.VITE_MAP_TILE_URL as string | undefined) ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) ?? '&copy; Colaboradores de OpenStreetMap';

/**
 * Los iconos por defecto de Leaflet se cargan por URL relativa y se rompen al
 * empaquetar. Se definen como SVG en linea para que no dependan de assets.
 */
function iconoSvg(color: string, letra: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html:
      '<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:' +
      color +
      ';box-shadow:0 1px 4px rgba(0,0,0,.4);border:2px solid #fff"><span style="transform:rotate(45deg);color:#fff;font:700 11px/1 system-ui">' +
      letra +
      '</span></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 26],
    popupAnchor: [0, -24],
  });
}

const ICONO_SEDE = iconoSvg('#1F3A5F', 'S');
const ICONO_DENTRO = iconoSvg('#059669', 'E');
const ICONO_FUERA = iconoSvg('#E11D48', '!');

export interface PuntoMarcacion {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  distanceMeters: number;
  etiqueta: string;
  hora: string;
}

export function MapView({
  sede,
  puntos,
  alto = 380,
}: {
  sede: { latitude: number; longitude: number; radiusMeters: number; nombre?: string };
  puntos: PuntoMarcacion[];
  alto?: number;
}) {
  const centro: [number, number] = [sede.latitude, sede.longitude];

  // El zoom se ajusta al radio para que la geocerca ocupe una parte util de la
  // vista sin tener que calcular limites con puntos fuera de rango.
  const zoom = sede.radiusMeters <= 60 ? 18 : sede.radiusMeters <= 200 ? 16 : 14;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200" style={{ height: alto }}>
      <MapContainer center={centro} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />

        {/* Geocerca */}
        <Circle
          center={centro}
          radius={sede.radiusMeters}
          pathOptions={{ color: '#1F3A5F', fillColor: '#2F66AA', fillOpacity: 0.12, weight: 2 }}
        />

        <Marker position={centro} icon={ICONO_SEDE}>
          <Popup>
            <strong>{sede.nombre ?? 'Sede'}</strong>
            <br />
            Radio permitido: {sede.radiusMeters} m
            <br />
            {sede.latitude.toFixed(6)}, {sede.longitude.toFixed(6)}
          </Popup>
        </Marker>

        {puntos.map((p, i) => {
          const dentro = p.distanceMeters <= sede.radiusMeters;
          const pos: [number, number] = [p.latitude, p.longitude];
          return (
            <div key={i}>
              {/* Circulo de incertidumbre del GPS */}
              <Circle
                center={pos}
                radius={p.accuracyMeters}
                pathOptions={{
                  color: dentro ? '#059669' : '#E11D48',
                  fillColor: dentro ? '#10B981' : '#F43F5E',
                  fillOpacity: 0.1,
                  weight: 1,
                  dashArray: '4 4',
                }}
              />
              {/* Linea al centro, para leer la distancia de un vistazo */}
              <Polyline
                positions={[centro, pos]}
                pathOptions={{ color: dentro ? '#059669' : '#E11D48', weight: 1.5, dashArray: '6 6' }}
              />
              <Marker position={pos} icon={dentro ? ICONO_DENTRO : ICONO_FUERA}>
                <Popup>
                  <strong>{p.etiqueta}</strong>
                  <br />
                  Hora: {p.hora}
                  <br />
                  Distancia: {metros(p.distanceMeters)}
                  <br />
                  Precision: {metros(p.accuracyMeters)}
                  <br />
                  {p.latitude.toFixed(6)}, {p.longitude.toFixed(6)}
                  <br />
                  <em>{dentro ? 'Dentro del radio' : 'Fuera del radio'}</em>
                </Popup>
              </Marker>
            </div>
          );
        })}
      </MapContainer>
    </div>
  );
}

/** Mapa reducido para elegir la ubicacion de una sede. */
export function SitePickerMap({
  latitude,
  longitude,
  radiusMeters,
  onChange,
}: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const centro: [number, number] = [latitude, longitude];

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200" style={{ height: 300 }}>
      <MapContainer center={centro} zoom={17} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer url={TILE_URL} attribution={ATTRIBUTION} maxZoom={19} />
        <Circle
          center={centro}
          radius={radiusMeters}
          pathOptions={{ color: '#1F3A5F', fillColor: '#2F66AA', fillOpacity: 0.12, weight: 2 }}
        />
        <Marker
          position={centro}
          icon={ICONO_SEDE}
          draggable
          eventHandlers={{
            dragend: (e) => {
              const m = e.target as L.Marker;
              const pos = m.getLatLng();
              onChange(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
            },
          }}
        >
          <Popup>Arrastre el marcador para ajustar el centro de la sede.</Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}
