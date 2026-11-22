import { useEffect, useState } from 'react';
import { CustomerDetail } from './pages/CustomerDetail';
import { Customers } from './pages/Customers';
import { Vehicles } from './pages/Vehicles';

function useHash() {
  const [hash, setHash] = useState(location.hash || '#/kunder');
  useEffect(() => {
    const on = () => setHash(location.hash || '#/kunder');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

const NAV = [
  { href: '#/kunder', label: 'Kunder', ready: true },
  { href: '#/fordon', label: 'Fordon', ready: true },
  { href: '#/arbetsordrar', label: 'Arbetsordrar', ready: false },
  { href: '#/tidbok', label: 'Tidbok', ready: false },
  { href: '#/lager', label: 'Artiklar och lager', ready: false },
  { href: '#/faktura', label: 'Offert och faktura', ready: false },
];

export function App() {
  const hash = useHash();
  const customerMatch = hash.match(/^#\/kunder\/(\d+)$/);

  let page;
  if (customerMatch) page = <CustomerDetail id={Number(customerMatch[1])} />;
  else if (hash.startsWith('#/kunder')) page = <Customers />;
  else if (hash.startsWith('#/fordon')) page = <Vehicles />;
  else page = <div className="card empty">Den här modulen byggs i en senare version.</div>;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">AF</span>
          <div>
            <strong>AutoFlow</strong>
            <small>Workshop</small>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={`${hash.startsWith(n.href) ? 'active' : ''} ${n.ready ? '' : 'soon'}`}>
              {n.label}
              {!n.ready && <em>snart</em>}
            </a>
          ))}
        </nav>
      </aside>
      <main>{page}</main>
    </div>
  );
}
