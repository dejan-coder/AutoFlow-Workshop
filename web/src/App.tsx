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
import { Accounting } from './pages/Accounting';
import { Tires } from './pages/Tires';
import { MyAccount } from './pages/Users';
import { AuthGate, useAuth } from './auth';
import { ROLE_LABELS, type Role } from './api';

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

const ALL: Role[] = ['admin', 'office', 'mechanic'];
const MONEY: Role[] = ['admin', 'office'];
const NAV: { href: string; label: string; section?: string; roles: Role[] }[] = [
  { href: '#/', label: 'Översikt', roles: ALL },
  { href: '#/tidbok', label: 'Tidbok', roles: ALL },
  { href: '#/arbetsordrar', label: 'Arbetsordrar', roles: ALL },
  { href: '#/kunder', label: 'Kunder', section: 'Register', roles: ALL },
  { href: '#/fordon', label: 'Fordon', roles: ALL },
  { href: '#/lager', label: 'Artiklar och lager', roles: ALL },
  { href: '#/dackhotell', label: 'Däckhotell', roles: ALL },
  { href: '#/offerter', label: 'Offerter', section: 'Ekonomi', roles: MONEY },
  { href: '#/fakturor', label: 'Fakturor', roles: MONEY },
  { href: '#/bokforing', label: 'Bokföring', roles: MONEY },
  { href: '#/rapporter', label: 'Rapporter', roles: MONEY },
  { href: '#/installningar', label: 'Inställningar', section: 'System', roles: ALL },
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
    '#/dackhotell': <Tires />,
    '#/bokforing': <Accounting />,
    '#/konto': <MyAccount />,
  };
  return pages[hash] ?? <div className="card empty">Sidan finns inte.</div>;
}

export function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}

function Shell() {
  const hash = useHash();
  const { user, logout, can } = useAuth();
  const nav = NAV.filter((n) => can(...n.roles));
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
          {nav.map((n) => (
            <div key={n.href} className="nav-group">
              {n.section && <div className="nav-section">{n.section}</div>}
              <a href={n.href} className={active(n.href) ? 'active' : ''}>{n.label}</a>
            </div>
          ))}
        </nav>
        <div className="user-box">
          <a href="#/konto" className={active('#/konto') ? 'active' : ''}>
            <strong>{user.name}</strong>
            <small>{ROLE_LABELS[user.role]}</small>
          </a>
          <button className="link" onClick={logout}>Logga ut</button>
        </div>
      </aside>
      <main key={hash}>{route(hash)}</main>
    </div>
  );
}
