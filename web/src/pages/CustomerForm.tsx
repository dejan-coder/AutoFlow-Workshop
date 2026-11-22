import { useState, type FormEvent } from 'react';
import { ApiError, type Customer } from '../api';
import { Field } from '../components/Field';

const EMPTY: Partial<Customer> = { customer_type: 'private', name: '' };

export function CustomerForm({
  initial = EMPTY,
  onSubmit,
  onCancel,
  submitLabel = 'Spara',
}: {
  initial?: Partial<Customer>;
  onSubmit: (c: Partial<Customer>) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [form, setForm] = useState<Partial<Customer>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const set = (k: keyof Customer) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      setErrors({});
      setMessage('');
      const { id: _id, ...body } = form as Customer & { vehicles?: unknown; created_at?: unknown; updated_at?: unknown };
      delete (body as Record<string, unknown>).vehicles;
      delete (body as Record<string, unknown>).created_at;
      delete (body as Record<string, unknown>).updated_at;
      await onSubmit(body);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setMessage(err.message);
      } else throw err;
    }
  }

  const company = form.customer_type === 'company';
  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        <Field label="Kundtyp">
          <select value={form.customer_type} onChange={set('customer_type')}>
            <option value="private">Privatperson</option>
            <option value="company">Företag</option>
          </select>
        </Field>
        <Field label={company ? 'Företagsnamn' : 'Namn'} error={errors.name}>
          <input value={form.name ?? ''} onChange={set('name')} autoFocus />
        </Field>
        <Field label={company ? 'Organisationsnummer' : 'Personnummer'} error={errors.identity_number}>
          <input value={form.identity_number ?? ''} onChange={set('identity_number')} placeholder="ÅÅMMDD-NNNN" />
        </Field>
      </div>
      <div className="row">
        <Field label="Telefon" error={errors.phone}>
          <input value={form.phone ?? ''} onChange={set('phone')} />
        </Field>
        <Field label="E-post" error={errors.email}>
          <input value={form.email ?? ''} onChange={set('email')} type="email" />
        </Field>
      </div>
      <div className="row">
        <Field label="Gatuadress">
          <input value={form.street ?? ''} onChange={set('street')} />
        </Field>
        <Field label="Postnummer">
          <input value={form.postal_code ?? ''} onChange={set('postal_code')} />
        </Field>
        <Field label="Ort">
          <input value={form.city ?? ''} onChange={set('city')} />
        </Field>
      </div>
      <Field label="Anteckningar">
        <textarea value={form.notes ?? ''} onChange={set('notes')} rows={2} />
      </Field>
      {message && <p className="error">{message}</p>}
      <div className="actions">
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Avbryt
          </button>
        )}
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}
