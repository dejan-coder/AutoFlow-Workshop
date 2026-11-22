import { useState, type FormEvent } from 'react';
import { ApiError, FUEL_LABELS, get, type Fuel, type Vehicle } from '../api';
import { Field } from '../components/Field';

export function VehicleForm({
  initial = {},
  onSubmit,
  onCancel,
}: {
  initial?: Partial<Vehicle>;
  onSubmit: (v: Partial<Vehicle>) => Promise<void>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<Partial<Vehicle>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const set = (k: keyof Vehicle) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const num = (v: unknown) => (v === '' || v == null ? null : Number(v));
  const [lookupMsg, setLookupMsg] = useState('');

  async function lookup() {
    setLookupMsg('');
    try {
      const r = await get<Partial<Vehicle> & { source: string; existing_vehicle_id?: number }>(
        `/api/vehicle-lookup/${encodeURIComponent(form.registration_number ?? '')}`,
      );
      if (r.existing_vehicle_id && r.existing_vehicle_id !== form.id) {
        setLookupMsg('Fordonet finns redan i registret.');
        return;
      }
      setForm((f) => ({
        ...f,
        make: f.make || r.make,
        model: f.model || r.model,
        model_year: f.model_year || r.model_year,
        vin: f.vin || r.vin,
        fuel: f.fuel || (r.fuel as Fuel | null),
      }));
      setLookupMsg('Uppgifterna är hämtade.');
    } catch (err) {
      setLookupMsg(err instanceof ApiError ? err.message : 'Uppslaget misslyckades');
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      setErrors({});
      setMessage('');
      await onSubmit({
        registration_number: form.registration_number ?? '',
        customer_id: form.customer_id ?? null,
        make: form.make,
        model: form.model,
        model_year: num(form.model_year),
        vin: form.vin,
        fuel: (form.fuel || null) as Fuel | null,
        mileage_km: num(form.mileage_km),
        notes: form.notes,
        next_service_date: form.next_service_date || null,
        next_service_km: num(form.next_service_km),
        inspection_due: form.inspection_due || null,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMessage(err.message);
      } else throw err;
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        <Field label="Regnummer" error={errors.registration_number}>
          <div className="input-with-button">
            <input className="plate" value={form.registration_number ?? ''} onChange={set('registration_number')} placeholder="ABC123" autoFocus />
            <button type="button" className="ghost" onClick={lookup} disabled={(form.registration_number ?? '').length < 6}>Hämta</button>
          </div>
          {lookupMsg && <small className="muted">{lookupMsg}</small>}
        </Field>
        <Field label="Märke">
          <input value={form.make ?? ''} onChange={set('make')} />
        </Field>
        <Field label="Modell">
          <input value={form.model ?? ''} onChange={set('model')} />
        </Field>
        <Field label="Årsmodell" error={errors.model_year}>
          <input value={form.model_year ?? ''} onChange={set('model_year')} inputMode="numeric" />
        </Field>
      </div>
      <div className="row">
        <Field label="Drivmedel">
          <select value={form.fuel ?? ''} onChange={set('fuel')}>
            <option value="">Välj</option>
            {Object.entries(FUEL_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Mätarställning (km)" error={errors.mileage_km}>
          <input value={form.mileage_km ?? ''} onChange={set('mileage_km')} inputMode="numeric" />
        </Field>
        <Field label="Chassinummer (VIN)" error={errors.vin}>
          <input value={form.vin ?? ''} onChange={set('vin')} />
        </Field>
      </div>
      <div className="row">
        <Field label="Nästa service (datum)" error={errors.next_service_date}>
          <input type="date" value={form.next_service_date ?? ''} onChange={set('next_service_date')} />
        </Field>
        <Field label="Nästa service (km)" error={errors.next_service_km}>
          <input value={form.next_service_km ?? ''} onChange={set('next_service_km')} inputMode="numeric" />
        </Field>
        <Field label="Besiktning senast" error={errors.inspection_due}>
          <input type="date" value={form.inspection_due ?? ''} onChange={set('inspection_due')} />
        </Field>
      </div>
      <Field label="Anteckningar">
        <textarea value={form.notes ?? ''} onChange={set('notes')} rows={2} />
      </Field>
      {message && <p className="error">{message}</p>}
      <div className="actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Avbryt</button>}
        <button type="submit">Spara fordon</button>
      </div>
    </form>
  );
}
