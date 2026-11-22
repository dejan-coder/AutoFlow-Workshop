import { useEffect, useState } from 'react';
import { api, type Customer } from '../api';
import { CustomerForm } from './CustomerForm';

export function Customers() {
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ items: Customer[]; total: number }>({ items: [], total: 0 });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => api.listCustomers(search).then(setData), 200);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <>
      <header className="page-head">
        <h1>Kunder</h1>
        <button onClick={() => setCreating(true)}>Ny kund</button>
      </header>
      {creating && (
        <section className="card">
          <h2>Ny kund</h2>
          <CustomerForm
            submitLabel="Skapa kund"
            onCancel={() => setCreating(false)}
            onSubmit={async (c) => {
              const created = await api.createCustomer(c);
              location.hash = `#/kunder/${created.id}`;
            }}
          />
        </section>
      )}
      <section className="card">
        <input
          className="search"
          placeholder="Sök på namn, telefon, e-post, personnummer eller regnummer"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <table>
          <thead>
            <tr><th>Namn</th><th>Typ</th><th>Telefon</th><th>E-post</th><th>Ort</th></tr>
          </thead>
          <tbody>
            {data.items.map((c) => (
              <tr key={c.id} onClick={() => (location.hash = `#/kunder/${c.id}`)} className="clickable">
                <td>{c.name}</td>
                <td>{c.customer_type === 'company' ? 'Företag' : 'Privat'}</td>
                <td>{c.phone}</td>
                <td>{c.email}</td>
                <td>{c.city}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.items.length === 0 && <p className="empty">Inga kunder hittades.</p>}
        <p className="muted">{data.total} kunder</p>
      </section>
    </>
  );
}
