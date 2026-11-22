import { useEffect, useState, type ReactNode } from 'react';
import { Articles } from './pages/Articles';
import { Bookings } from './pages/Bookings';
import { CustomerDetail } from './pages/CustomerDetail';
import { Customers } from './pages/Customers';
import { InvoiceDetail, Invoices } from './pages/Invoices';
import { Overview, Reports, SettingsPage } from './pages/Overview';
import { QuoteDetail, Quotes } from './pages/Quotes';
import { Vehicles } from './pages/Vehicles';
import { WorkOrderDetail, WorkOrders } from './pages/WorkOrders';

function useHash() {
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const on = () => {
      setHash(location.hash || '#/');
      scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

const NAV: { href: string; label: string; section?: string }[] = [
  { href: '#/', label: 'Översikt' },
  { href: '#/tidbok', label: 'Tidbok' },
  { href: '#/arbetsordrar', label: 'Arbetsordrar' },
  { href: '#/kunder', label: 'Kunder', section: 'Register' },
  { href: '#/fordon', label: 'Fordon' },
  { href: '#/lager', label: 'Artiklar och lager' },
  { href: '#/offerter', label: 'Offerter', section: 'Ekonomi' },
  { href: '#/fakturor', label: 'Fakturor' },
  { href: '#/rapporter', label: 'Rapporter' },
  { href: '#/installningar', label: 'Inställningar', section: 'System' },
];

function route(hash: string): ReactNode {
  const m = (re: RegExp) => hash.match(re);
  let r;
  if ((r = m(/^#\/kunder\/(\d+)$/))) return <CustomerDetail id={Number(r[1])} />;
  if ((r = m(/^#\/arbetsordrar\/(\d+)$/))) return <WorkOrderDetail id={Number(r[1])} />;
  if ((r = m(/^#\/offerter\/(\d+)$/))) return <QuoteDetail id={Number(r[1])} />;
  if ((r = m(/^#\/fakturor\/(\d+)$/))) return <InvoiceDetail id={Number(r[1])} />;
  const pages: Record<string, ReactNode> = {
    '#/': <Overview />,
    '#/tidbok': <Bookings />,
    '#/arbetsordrar': <WorkOrders />,
    '#/kunder': <Customers />,
    '#/fordon': <Vehicles />,
    '#/lager': <Articles />,
    '#/offerter': <Quotes />,
    '#/fakturor': <Invoices />,
    '#/rapporter': <Reports />,
    '#/installningar': <SettingsPage />,
  };
  return pages[hash] ?? <div className="card empty">Sidan finns inte.</div>;
}

export function App() {
  const hash = useHash();
  const active = (href: string) => (href === '#/' ? hash === '#/' : hash.startsWith(href));
  return (
    <div className="layout">
      <aside className="sidebar">
        <a className="brand" href="#/">
          <span className="logo">AF</span>
          <div>
            <strong>AutoFlow</strong>
            <small>Workshop</small>
          </div>
        </a>
        <nav>
          {NAV.map((n) => (
            <div key={n.href} className="nav-group">
              {n.section && <div className="nav-section">{n.section}</div>}
              <a href={n.href} className={active(n.href) ? 'active' : ''}>{n.label}</a>
            </div>
          ))}
        </nav>
      </aside>
      <main key={hash}>{route(hash)}</main>
    </div>
  );
}
