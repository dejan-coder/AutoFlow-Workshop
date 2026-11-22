import { useState } from 'react';
import { get, patch, post, qs, type Booking, type Mechanic, type Vehicle } from '../api';
import { ErrorText, Plate, useAction, useLoad, VehiclePicker } from '../components/common';
import { addDays, BOOKING_STATUS, mondayOf, stockholmIso, time, today } from '../format';

const DAY_NAMES = ['Måndag', 'Tisdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lördag', 'Söndag'];

export function Bookings() {
  const [week, setWeek] = useState(mondayOf(today()));
  const [mechanicFilter, setMechanicFilter] = useState('');
  const [creatingOn, setCreatingOn] = useState<string | null>(null);
  const days = DAY_NAMES.map((_, i) => addDays(week, i));
  const { data: mechanics } = useLoad(() => get<{ items: Mechanic[] }>('/api/mechanics'), []);
  const { data, reload } = useLoad(
    () => get<{ items: Booking[] }>(`/api/bookings?${qs({ from: days[0], to: days[6], mechanic_id: mechanicFilter || undefined })}`),
    [week, mechanicFilter],
  );
  const action = useAction();
  const mechanicIndex = new Map(mechanics?.items.map((m, i) => [m.id, i % 6]));
  const dayOf = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(iso));
  const weekNo = isoWeek(week);

  return (
    <>
      <header className="page-head">
        <h1>Tidbok</h1>
        <div className="actions">
          <button className="ghost" onClick={() => setWeek(addDays(week, -7))}>‹ Förra</button>
          <button className="ghost" onClick={() => setWeek(mondayOf(today()))}>Vecka {weekNo}</button>
          <button className="ghost" onClick={() => setWeek(addDays(week, 7))}>Nästa ›</button>
          <select value={mechanicFilter} onChange={(e) => setMechanicFilter(e.target.value)} aria-label="Mekaniker">
            <option value="">Alla mekaniker</option>
            {mechanics?.items.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </header>
      {creatingOn && (
        <NewBooking
          day={creatingOn}
          mechanics={mechanics?.items ?? []}
          onCancel={() => setCreatingOn(null)}
          onCreated={() => {
            setCreatingOn(null);
            reload();
          }}
        />
      )}
      <ErrorText error={action.error} />
      <div className="week">
        {days.map((d, i) => {
          const items = (data?.items ?? []).filter((b) => dayOf(b.starts_at) === d);
          return (
            <section key={d} className={`day card${d === today() ? ' today' : ''}`}>
              <header className="day-head">
                <div>
                  <strong>{DAY_NAMES[i]}</strong> <span className="muted">{Number(d.slice(8))}/{Number(d.slice(5, 7))}</span>
                </div>
                <button className="icon" title="Ny bokning" onClick={() => setCreatingOn(d)}>+</button>
              </header>
              {items.length === 0 && <p className="empty small">Inga bokningar</p>}
              {items.map((b) => (
                <article key={b.id} className={`booking m${b.mechanic_id ? mechanicIndex.get(b.mechanic_id) : 'x'} st-${b.status}`}>
                  <div className="booking-time">
                    {time(b.starts_at)}–{time(b.ends_at)} <span className="muted">{b.mechanic_name ?? 'Ingen mekaniker'}</span>
                  </div>
                  <div>
                    <Plate reg={b.registration_number} /> {b.customer_name}
                  </div>
                  {b.description && <div className="muted small">{b.description}</div>}
                  {b.customer_phone && <div className="muted small">{b.customer_phone}</div>}
                  <div className="booking-actions">
                    {b.work_order_id ? (
                      <a href={`#/arbetsordrar/${b.work_order_id}`}>Arbetsorder {b.work_order_id}</a>
                    ) : (
                      <>
                        {b.vehicle_id && (
                          <button className="link" onClick={() => action.run(async () => {
                            const wo = await post<{ id: number }>(`/api/bookings/${b.id}/work-order`);
                            location.hash = `#/arbetsordrar/${wo.id}`;
                          })}>Kunden har kommit</button>
                        )}
                        <button className="link danger-text" onClick={() => action.run(async () => {
                          await patch(`/api/bookings/${b.id}`, { status: 'cancelled' });
                          reload();
                        })}>Avboka</button>
                      </>
                    )}
                    {b.status !== 'booked' && <span className="muted small">{BOOKING_STATUS[b.status]}</span>}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

function NewBooking({ day, mechanics, onCancel, onCreated }: { day: string; mechanics: Mechanic[]; onCancel: () => void; onCreated: () => void }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [date, setDate] = useState(day);
  const [start, setStart] = useState('08:00');
  const [duration, setDuration] = useState('60');
  const [mechanic, setMechanic] = useState('');
  const [description, setDescription] = useState('');
  const action = useAction();
  return (
    <section className="card">
      <h2>Ny bokning</h2>
      <div className="form">
        <div className="row">
          <label className="field"><span>Datum</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>Starttid</span><input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field">
            <span>Längd</span>
            <select value={duration} onChange={(e) => setDuration(e.target.value)}>
              {[30, 60, 90, 120, 180, 240, 480].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} tim`}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Mekaniker</span>
            <select value={mechanic} onChange={(e) => setMechanic(e.target.value)}>
              <option value="">Ingen vald</option>
              {mechanics.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        </div>
        <div className="field">
          <span>Fordon</span>
          {vehicle ? (
            <p><Plate reg={vehicle.registration_number} /> {vehicle.customer_name} <button className="link" onClick={() => setVehicle(null)}>Byt</button></p>
          ) : (
            <VehiclePicker onSelect={setVehicle} />
          )}
        </div>
        <label className="field"><span>Vad ska göras</span><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="t.ex. Service, däckbyte" /></label>
      </div>
      <ErrorText error={action.error} />
      <div className="actions">
        <button className="ghost" onClick={onCancel}>Avbryt</button>
        <button disabled={action.busy} onClick={() => action.run(async () => {
          await post('/api/bookings', {
            starts_at: stockholmIso(date, start),
            duration_minutes: Number(duration),
            mechanic_id: mechanic ? Number(mechanic) : null,
            vehicle_id: vehicle?.id ?? null,
            description: description || null,
          });
          onCreated();
        })}>Boka</button>
      </div>
    </section>
  );
}

function isoWeek(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}
