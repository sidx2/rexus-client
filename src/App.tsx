import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Leaf, Flame, Sparkles, Plus, Minus, X, ShoppingBag, ClipboardList,
  Pencil, Clock, ChefHat, BellRing, CheckCircle2, XCircle, Check,
  Soup, Beef, IceCream2, CupSoda, Salad, Fish, UtensilsCrossed,
} from 'lucide-react';
import './App.css';

/* =====================================================================
   Backend endpoints

   Derived from the current page's own host, not hardcoded to
   "localhost" — this is what lets a phone that scanned
   http://10.139.71.1:9999/?orgId=...&tableId=... reach the API at
   http://10.139.71.1:8080 automatically, on this device or any other.
   Change API_PORT if the Rust backend isn't on 8080 for you.
   ===================================================================== */

const API_PORT = 8080;
const API_BASE_URL = `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

/* =====================================================================
   Types
   ===================================================================== */

type TagType = 'veg' | 'spicy' | 'popular';

interface OrgTheme {
  primary: string;
  primaryDark: string;
  accent: string;
  accentSoft: string;
  background: string;
  surface: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
}

interface Org {
  id: string;
  name: string;
  tagline: string;
  logoInitial: string;
  theme: OrgTheme;
}

interface TableInfo {
  id: string;
  name: string;
  seats: number;
}

interface MenuCategory {
  id: string;    // == the raw category string from the backend
  name: string;
  icon: LucideIcon;
}

// Matches the backend's MenuItemOut exactly (camelCase on the wire).
// There's no `icon` field over the wire — it's derived client-side from
// the category name (see iconForCategory below), and no `categoryId` —
// `category` is used directly as the grouping key.
interface MenuItem {
  id: string;
  category: string;
  name: string;
  description: string;
  price: number;
  tags: string[];
}

interface CartLine {
  cartId: string;
  itemId: string;
  name: string;
  price: number;
  qty: number;
  note: string;
}

type OrderStatus = 'new' | 'preparing' | 'ready' | 'served' | 'cancelled';

interface TrackedOrderItem {
  name: string;
  qty: number;
  price?: number;
  note?: string;
}

interface TrackedOrder {
  id: string;
  items: TrackedOrderItem[];
  total: number;
  subtotal?: number;
  tax?: number;
  status: OrderStatus;
  createdAt: number;
}

/* =====================================================================
   Real API layer — talks to the Rust/axum/sqlite backend built earlier.
   All of these are public/unauthenticated endpoints; guests never log in.
   ===================================================================== */

class ApiError extends Error { }

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

async function fetchOrgDetails(orgId: string): Promise<Org> {
  return apiGet<Org>(`/api/orgs/${orgId}`);
}

async function fetchTableDetails(orgId: string, tableId: string): Promise<TableInfo> {
  return apiGet<TableInfo>(`/api/orgs/${orgId}/tables/${tableId}`);
}

async function fetchMenu(orgId: string): Promise<MenuItem[]> {
  return apiGet<MenuItem[]>(`/api/orgs/${orgId}/menu`);
}

async function fetchPendingOrders(orgId: string, tableId: string): Promise<TrackedOrder[]> {
  return apiGet<TrackedOrder[]>(`/api/orgs/${orgId}/tables/${tableId}/orders?status=pending`);
}

async function submitOrder(orgId: string, tableId: string, lines: CartLine[]): Promise<TrackedOrder> {
  const res = await fetch(`${API_BASE_URL}/api/orgs/${orgId}/tables/${tableId}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: lines.map((l) => ({
        itemId: l.itemId,
        name: l.name,
        price: l.price,
        qty: l.qty,
        note: l.note,
      })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? 'Could not place order');
  return data as TrackedOrder;
}

/* =====================================================================
   Helpers
   ===================================================================== */

// ₹ — Indian Rupee, no decimals (matches how the admin's menu builder
// already enters prices, e.g. ₹180 for Paneer Butter Masala).
function formatPrice(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatClockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// GST for restaurants (non-AC/no-liquor slab) — adjust to match your
// establishment's actual rate, or better, have the backend return this
// per-org so it isn't hardcoded on the client at all.
const GST_RATE = 0.05;

const STATUS_META: Record<OrderStatus, { label: string; icon: LucideIcon; color: string }> = {
  new: { label: 'New', icon: Sparkles, color: 'var(--status-new)' },
  preparing: { label: 'Preparing', icon: ChefHat, color: 'var(--status-preparing)' },
  ready: { label: 'Ready', icon: BellRing, color: 'var(--status-ready)' },
  served: { label: 'Served', icon: CheckCircle2, color: 'var(--status-served)' },
  cancelled: { label: 'Cancelled', icon: XCircle, color: 'var(--status-cancelled)' },
};

const STATUS_ORDER: OrderStatus[] = ['new', 'preparing', 'ready', 'served'];

const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  starters: Salad,
  appetizers: Salad,
  breakfast: Soup,
  soup: Soup,
  soups: Soup,
  mains: Beef,
  'main course': Beef,
  entrees: Beef,
  desserts: IceCream2,
  dessert: IceCream2,
  drinks: CupSoda,
  beverages: CupSoda,
};

function iconForCategory(category: string): LucideIcon {
  return CATEGORY_ICON_MAP[category.trim().toLowerCase()] ?? UtensilsCrossed;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/* =====================================================================
   Small presentational pieces
   ===================================================================== */

function TagBadge({ tag }: { tag: string }) {
  if (tag === 'veg') return <span className="gm-tag gm-tag--veg"><Leaf size={10} strokeWidth={2.4} /> Veg</span>;
  if (tag === 'spicy') return <span className="gm-tag gm-tag--spicy"><Flame size={10} strokeWidth={2.4} /> Spicy</span>;
  if (tag === 'popular') return <span className="gm-tag gm-tag--popular"><Sparkles size={10} strokeWidth={2.4} /> Popular</span>;
  return null; // unrecognized tags are ignored rather than breaking the UI
}

function StatusPill({ status }: { status: OrderStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className="gm-status-pill" style={{ color: meta.color, background: `${meta.color}1F` }}>
      <Icon size={12} strokeWidth={2.4} /> {meta.label}
    </span>
  );
}

function StatusTrack({ status }: { status: OrderStatus }) {
  if (status === 'cancelled') {
    return (
      <div className="gm-status-cancelled">
        <XCircle size={14} strokeWidth={2.2} /> This order was cancelled.
      </div>
    );
  }
  const currentIndex = STATUS_ORDER.indexOf(status);
  return (
    <div className="gm-status-track">
      {STATUS_ORDER.map((step, i) => {
        const StepIcon = STATUS_META[step].icon;
        const done = i < currentIndex;
        const active = i === currentIndex;
        const cls = done ? 'gm-status-step gm-status-step--done' : active ? 'gm-status-step gm-status-step--active' : 'gm-status-step';
        return (
          <div key={step} className={cls}>
            <span className="gm-status-step__line" />
            <span className="gm-status-step__dot">
              {done ? <Check size={13} strokeWidth={2.6} /> : <StepIcon size={13} strokeWidth={2.2} />}
            </span>
            <span className="gm-status-step__label">{STATUS_META[step].label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* =====================================================================
   Header
   ===================================================================== */

function Header({
  org, table, activeOrderCount, onTrackClick,
}: {
  org: Org;
  table: TableInfo;
  activeOrderCount: number;
  onTrackClick: () => void;
}) {
  return (
    <header className="gm-header">
      <div className="gm-header__top">
        <div className="gm-header__brand">
          <div className="gm-header__logo">{org.logoInitial}</div>
          <div style={{ minWidth: 0 }}>
            <p className="gm-header__name">{org.name}</p>
            <p className="gm-header__tagline">{org.tagline}</p>
          </div>
        </div>
        <button className="gm-track-btn" onClick={onTrackClick} aria-label="Track your order">
          <ClipboardList size={18} strokeWidth={1.8} />
          {activeOrderCount > 0 && <span className="gm-track-btn__badge">{activeOrderCount}</span>}
        </button>
      </div>
      <div className="gm-header__table">
        <strong>{table.name}</strong>
        <span>· {table.seats} seats</span>
      </div>
    </header>
  );
}

/* =====================================================================
   Category tabs
   ===================================================================== */

function CategoryTabs({
  categories, activeId, onSelect,
}: {
  categories: MenuCategory[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="gm-tabs">
      {categories.map((cat) => {
        const Icon = cat.icon;
        const active = cat.id === activeId;
        return (
          <button
            key={cat.id}
            className={active ? 'gm-tab gm-tab--active' : 'gm-tab'}
            onClick={() => onSelect(cat.id)}
          >
            <Icon size={14} strokeWidth={1.9} /> {cat.name}
          </button>
        );
      })}
    </nav>
  );
}

/* =====================================================================
   Menu item card
   ===================================================================== */

function MenuItemCard({
  item, onOpen, onQuickAdd,
}: {
  item: MenuItem;
  onOpen: (item: MenuItem) => void;
  onQuickAdd: (item: MenuItem) => void;
}) {
  const Icon = iconForCategory(item.category);
  return (
    <div className="gm-item-card" onClick={() => onOpen(item)} role="button" tabIndex={0}>
      <div className="gm-item-card__icon">
        <Icon size={26} strokeWidth={1.6} />
      </div>
      <div className="gm-item-card__body">
        <div className="gm-item-card__row">
          <p className="gm-item-card__name">{item.name}</p>
        </div>
        {item.description && <p className="gm-item-card__desc">{item.description}</p>}
        <div className="gm-item-card__footer">
          <div className="gm-tags">
            {item.tags.map((t) => <TagBadge key={t} tag={t} />)}
          </div>
          <div className="gm-item-card__price-row">
            <span className="gm-item-card__price">{formatPrice(item.price)}</span>
            <button
              className="gm-quick-add"
              aria-label={`Add ${item.name}`}
              onClick={(e) => { e.stopPropagation(); onQuickAdd(item); }}
            >
              <Plus size={15} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   Add-to-cart / edit-line sheet
   ===================================================================== */

function AddToCartSheet({
  item, editingLine, onClose, onConfirm,
}: {
  item: MenuItem;
  editingLine: CartLine | null;
  onClose: () => void;
  onConfirm: (qty: number, note: string) => void;
}) {
  const [qty, setQty] = useState(editingLine?.qty ?? 1);
  const [note, setNote] = useState(editingLine?.note ?? '');
  const Icon = iconForCategory(item.category);

  return (
    <>
      <div className="gm-backdrop" onClick={onClose} />
      <div className="gm-sheet" role="dialog" aria-modal="true">
        <div className="gm-sheet__handle" />
        <div className="gm-sheet__header">
          <div>
            <h3 className="gm-sheet__title">{editingLine ? 'Edit item' : 'Add to order'}</h3>
          </div>
          <button className="gm-sheet__close" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2} /></button>
        </div>

        <div className="gm-sheet__body">
          <div className="gm-atc-item">
            <div className="gm-atc-icon"><Icon size={24} strokeWidth={1.6} /></div>
            <div>
              <p className="gm-atc-name">{item.name}</p>
              {item.description && <p className="gm-atc-desc">{item.description}</p>}
              <p className="gm-atc-price">{formatPrice(item.price)}</p>
            </div>
          </div>

          <label className="gm-field-label" htmlFor="gm-qty">Quantity</label>
          <div className="gm-stepper" id="gm-qty">
            <button className="gm-stepper__btn" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Decrease quantity">
              <Minus size={15} strokeWidth={2.2} />
            </button>
            <span className="gm-stepper__value">{qty}</span>
            <button className="gm-stepper__btn" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="Increase quantity">
              <Plus size={15} strokeWidth={2.2} />
            </button>
          </div>

          <label className="gm-field-label" htmlFor="gm-note">Add a note (optional)</label>
          <textarea
            id="gm-note"
            className="gm-textarea"
            placeholder="e.g. no onions, allergy notes, extra spicy…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={140}
          />
        </div>

        <div className="gm-sheet__footer">
          <button className="gm-cta-btn" onClick={() => onConfirm(qty, note.trim())}>
            {editingLine ? 'Update item' : 'Add to order'} · {formatPrice(item.price * qty)}
          </button>
        </div>
      </div>
    </>
  );
}

/* =====================================================================
   Cart bar + cart sheet
   ===================================================================== */

function CartBar({ lines, onOpen }: { lines: CartLine[]; onOpen: () => void }) {
  const count = lines.reduce((sum, l) => sum + l.qty, 0);
  const total = lines.reduce((sum, l) => sum + l.qty * l.price, 0);
  if (count === 0) return null;
  return (
    <div className="gm-cart-bar">
      <button className="gm-cart-bar__inner" onClick={onOpen}>
        <span className="gm-cart-bar__count">{count}</span>
        <span className="gm-cart-bar__label">View your order</span>
        <ShoppingBag size={16} strokeWidth={1.8} />
        <span className="gm-cart-bar__total">{formatPrice(total)}</span>
      </button>
    </div>
  );
}

function CartSheet({
  lines, onClose, onEditLine, onChangeQty, onPlaceOrder, placing, error,
}: {
  lines: CartLine[];
  onClose: () => void;
  onEditLine: (line: CartLine) => void;
  onChangeQty: (cartId: string, delta: number) => void;
  onPlaceOrder: () => void;
  placing: boolean;
  error: string | null;
}) {
  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.price, 0);
  const tax = subtotal * GST_RATE;
  const total = subtotal + tax;

  return (
    <>
      <div className="gm-backdrop" onClick={onClose} />
      <div className="gm-sheet" role="dialog" aria-modal="true" style={{ maxHeight: '90vh' }}>
        <div className="gm-sheet__handle" />
        <div className="gm-sheet__header">
          <div>
            <h3 className="gm-sheet__title">Your order</h3>
            <p className="gm-sheet__subtitle">Review before sending to the kitchen</p>
          </div>
          <button className="gm-sheet__close" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2} /></button>
        </div>

        <div className="gm-sheet__body">
          {lines.length === 0 ? (
            <div className="gm-empty">
              <div className="gm-empty__icon"><ShoppingBag size={22} strokeWidth={1.6} /></div>
              <p className="gm-empty__title">Your cart is empty</p>
              <p className="gm-empty__desc">Add a few dishes to get started.</p>
            </div>
          ) : (
            <>
              {lines.map((line) => (
                <div className="gm-cart-line" key={line.cartId}>
                  <div className="gm-cart-line__info">
                    <p className="gm-cart-line__name">{line.name}</p>
                    <p className="gm-cart-line__price">{formatPrice(line.price)} each</p>
                    {line.note && (
                      <div className="gm-cart-line__note">
                        <Pencil size={11} strokeWidth={2} style={{ marginTop: 2, flexShrink: 0 }} />
                        <span>{line.note}</span>
                      </div>
                    )}
                    <button className="gm-cart-line__edit" onClick={() => onEditLine(line)}>
                      <Pencil size={11} strokeWidth={2.2} /> Edit
                    </button>
                  </div>
                  <div className="gm-cart-line__side">
                    <span className="gm-line-total">{formatPrice(line.price * line.qty)}</span>
                    <div className="gm-mini-stepper">
                      <button className="gm-mini-stepper__btn" onClick={() => onChangeQty(line.cartId, -1)} aria-label="Decrease quantity">
                        <Minus size={12} strokeWidth={2.4} />
                      </button>
                      <span className="gm-mini-stepper__value">{line.qty}</span>
                      <button className="gm-mini-stepper__btn" onClick={() => onChangeQty(line.cartId, 1)} aria-label="Increase quantity">
                        <Plus size={12} strokeWidth={2.4} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <div className="gm-perforation" />

              <div className="gm-bill-row"><span>Subtotal</span><span>{formatPrice(subtotal)}</span></div>
              <div className="gm-bill-row"><span>GST (5%)</span><span>{formatPrice(tax)}</span></div>
              <div className="gm-bill-row gm-bill-row--total"><span>Total</span><span>{formatPrice(total)}</span></div>
            </>
          )}

          {error && <p className="gm-order-error">{error}</p>}
        </div>

        {lines.length > 0 && (
          <div className="gm-sheet__footer">
            <button className="gm-cta-btn" onClick={onPlaceOrder} disabled={placing}>
              {placing ? 'Sending to kitchen…' : `Place order · ${formatPrice(total)}`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/* =====================================================================
   Order tracking sheet
   ===================================================================== */

function TrackingSheet({
  orders, onClose, connected,
}: {
  orders: TrackedOrder[];
  onClose: () => void;
  connected: boolean;
}) {
  return (
    <>
      <div className="gm-backdrop" onClick={onClose} />
      <div className="gm-sheet" role="dialog" aria-modal="true" style={{ maxHeight: '90vh' }}>
        <div className="gm-sheet__handle" />
        <div className="gm-sheet__header">
          <div>
            <h3 className="gm-sheet__title">Your orders</h3>
            <p className="gm-sheet__subtitle">
              <span className={connected ? 'gm-live-dot gm-live-dot--on' : 'gm-live-dot'} />
              {connected ? 'Live status for this table, today' : 'Refreshing periodically'}
            </p>
          </div>
          <button className="gm-sheet__close" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2} /></button>
        </div>

        <div className="gm-sheet__body">
          {orders.length === 0 ? (
            <div className="gm-empty">
              <div className="gm-empty__icon"><ClipboardList size={22} strokeWidth={1.6} /></div>
              <p className="gm-empty__title">No orders yet</p>
              <p className="gm-empty__desc">Anything you order will show up here.</p>
            </div>
          ) : (
            orders.map((order) => (
              <div className="gm-order-card" key={order.id}>
                <div className="gm-order-card__head">
                  <div>
                    <p className="gm-order-card__id">Order #{order.id.slice(0, 5).toUpperCase()}</p>
                    <p className="gm-order-card__time"><Clock size={11} style={{ verticalAlign: -1, marginRight: 3 }} />{formatClockTime(order.createdAt)}</p>
                  </div>
                  <StatusPill status={order.status} />
                </div>
                <StatusTrack status={order.status} />
                <div className="gm-order-items">
                  {order.items.map((it, i) => (
                    <div key={i}><span>{it.qty}× {it.name}</span></div>
                  ))}
                </div>
                <div className="gm-order-total"><span>Total</span><span>{formatPrice(order.total)}</span></div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

/* =====================================================================
   Toast
   ===================================================================== */

function Toast({ message }: { message: string }) {
  return (
    <div className="gm-toast">
      <Check size={14} strokeWidth={2.4} />
      {message}
    </div>
  );
}

/* =====================================================================
   Root component
   ===================================================================== */

export default function GuestMenu() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const orgId = params.get('orgId') ?? '';
  const tableId = params.get('tableId') ?? '';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [table, setTable] = useState<TableInfo | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<TrackedOrder[]>([]);

  const [activeCategory, setActiveCategory] = useState<string>('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // ---- live order tracking ----
  //
  // NOTE ON BACKEND: this connects to a *guest-scoped* endpoint,
  // `/ws/orders/table?orgId=&tableId=`, that does not exist on the
  // backend yet — the admin dashboard's `/ws/orders` requires an admin
  // JWT, which guests never have and shouldn't be given. The addition
  // needed is small: an unauthenticated upgrade that subscribes to
  // broadcast messages filtered by (org_id, table_id) instead of just
  // org_id, reusing the exact same BroadcastMsg/order:new/order:update
  // machinery already in main.rs.
  //
  // Until that lands, the socket will simply fail to connect and retry
  // in the background — the polling fallback below keeps tracking
  // working either way, so nothing here is blocked on the backend change.
  const connectSocket = useCallback(() => {
    if (!orgId || !tableId) return;
    const socket = new WebSocket(`${WS_BASE_URL}/ws/orders/table?orgId=${orgId}&tableId=${tableId}`);
    socketRef.current = socket;

    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
      setConnected(true);
      socket.send(JSON.stringify({ type: 'orders:subscribe' }));
    };

    socket.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }

      console.log("event msg: ", msg);
      switch (msg.type) {
        case 'orders:sync':
          setOrders(msg.orders as TrackedOrder[]);
          break;
        case 'order:new':
          setOrders((prev) => (prev.some((o) => o.id === msg.order.id) ? prev : [msg.order as TrackedOrder, ...prev]));
          break;
        case 'order:update':
          setOrders((prev) => prev.map((o) => (o.id === msg.order.id ? (msg.order as TrackedOrder) : o)));
          break;
        case 'order:delete':
          setOrders((prev) => prev.filter((o) => o.id !== msg.orderId));
          break;
      }
    };

    socket.onclose = () => {
      setConnected(false);
      if (!mountedRef.current) return;
      const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 15000);
      reconnectAttemptRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(connectSocket, delay);
    };

    socket.onerror = () => socket.close();
  }, [orgId, tableId]);

  // ---- initial load ----
  useEffect(() => {
    if (!orgId || !tableId) {
      setLoadError('This link is missing table information. Please re-scan the QR code on your table.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [orgData, tableData, menuData, orderData] = await Promise.all([
          fetchOrgDetails(orgId),
          fetchTableDetails(orgId, tableId),
          fetchMenu(orgId),
          fetchPendingOrders(orgId, tableId),
        ]);
        if (cancelled) return;
        setOrg(orgData);
        setTable(tableData);
        setMenu(menuData);
        setOrders(orderData);
        if (menuData.length > 0) setActiveCategory(menuData[0].category);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load this menu.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    connectSocket();

    // Fallback safety net: refresh pending orders periodically regardless
    // of socket state, so tracking still updates even before the
    // guest-scoped WS endpoint exists on the backend (see connectSocket).
    pollIntervalRef.current = setInterval(() => {
      fetchPendingOrders(orgId, tableId).then(setOrders).catch(() => { });
    }, 20000);

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      socketRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, tableId]);

  useEffect(() => {
    if (org) document.title = `${org.name} · Menu`;
  }, [org]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  // ---- scroll-spy for category tabs ----
  useEffect(() => {
    if (loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveCategory(entry.target.getAttribute('data-category') || '');
        });
      },
      { rootMargin: '-112px 0px -70% 0px', threshold: 0 }
    );
    sectionRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [loading, menu]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const scrollToCategory = (id: string) => {
    setActiveCategory(id);
    sectionRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ---- cart operations ----
  const addOrUpdateCart = (item: MenuItem, qty: number, note: string) => {
    setCart((prev) => {
      if (editingLine) {
        return prev.map((l) => (l.cartId === editingLine.cartId ? { ...l, qty, note } : l));
      }
      const existing = prev.find((l) => l.itemId === item.id && l.note === note);
      if (existing) {
        return prev.map((l) => (l.cartId === existing.cartId ? { ...l, qty: l.qty + qty } : l));
      }
      return [...prev, { cartId: uid(), itemId: item.id, name: item.name, price: item.price, qty, note }];
    });
    showToast(editingLine ? 'Item updated' : `${item.name} added`);
    setSheetItem(null);
    setEditingLine(null);
  };

  const quickAdd = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === item.id && l.note === '');
      if (existing) return prev.map((l) => (l.cartId === existing.cartId ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { cartId: uid(), itemId: item.id, name: item.name, price: item.price, qty: 1, note: '' }];
    });
    showToast(`${item.name} added`);
  };

  const changeLineQty = (cartId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.cartId === cartId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );
  };

  const openEditLine = (line: CartLine) => {
    const item = menu.find((m) => m.id === line.itemId);
    if (!item) return;
    setEditingLine(line);
    setSheetItem(item);
    setCartOpen(false);
  };

  const placeOrder = async () => {
    if (cart.length === 0 || placing) return;
    setPlacing(true);
    setOrderError(null);

    const confirmed = await window.askUserConfirmation({
      title: 'Send this order to the kitchen?',
      message: `${cart.reduce((n, l) => n + l.qty, 0)} items`,
      confirmLabel: 'Place order',
    });
    if (!confirmed) return;

    if (!window.hasUserNameAndPhone()) {
      const info = await window.askUserForNameAndPhone();
      if (!info) return; // they backed out — don't place the order
    }
    try {
      const newOrder = await submitOrder(orgId, tableId, cart);
      setOrders((prev) => [newOrder, ...prev]);
      setCart([]);
      setCartOpen(false);
      showToast('Order sent to the kitchen');
      setTimeout(() => setTrackingOpen(true), 350);
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : 'Could not place your order. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  const activeOrderCount = orders.filter((o) => o.status !== 'served' && o.status !== 'cancelled').length;

  const categories: MenuCategory[] = useMemo(() => {
    const seen: string[] = [];
    menu.forEach((m) => { if (!seen.includes(m.category)) seen.push(m.category); });
    return seen.map((cat) => ({ id: cat, name: cat, icon: iconForCategory(cat) }));
  }, [menu]);

  if (loading) {
    return (
      <div className="gm-loading">
        <div className="gm-loading__mark" />
      </div>
    );
  }

  if (loadError || !org || !table) {
    return (
      <div className="gm-load-error">
        <UtensilsCrossed size={28} strokeWidth={1.6} />
        <p>{loadError ?? 'Something went wrong loading this menu.'}</p>
      </div>
    );
  }

  const themeVars = {
    '--brand-primary': org.theme.primary,
    '--brand-primary-dark': org.theme.primaryDark,
    '--brand-accent': org.theme.accent,
    '--brand-accent-soft': org.theme.accentSoft,
    '--brand-bg': org.theme.background,
    '--brand-surface': org.theme.surface,
    '--brand-text': org.theme.textPrimary,
    '--brand-text-secondary': org.theme.textSecondary,
    '--brand-border': org.theme.border,
  } as CSSProperties;

  return (
    <div className="gm-app" style={themeVars}>
      <div className="gm-shell">
        <Header org={org} table={table} activeOrderCount={activeOrderCount} onTrackClick={() => setTrackingOpen(true)} />
        <CategoryTabs categories={categories} activeId={activeCategory} onSelect={scrollToCategory} />

        <div className="gm-content">
          {categories.map((cat) => {
            const items = menu.filter((m) => m.category === cat.id);
            return (
              <section
                key={cat.id}
                className="gm-section"
                data-category={cat.id}
                ref={(el) => { if (el) sectionRefs.current.set(cat.id, el); }}
              >
                <h2 className="gm-section__title">{cat.name}</h2>
                <p className="gm-section__count">{items.length} {items.length === 1 ? 'item' : 'items'}</p>
                {items.map((item) => (
                  <MenuItemCard
                    key={item.id}
                    item={item}
                    onOpen={(it) => { setEditingLine(null); setSheetItem(it); }}
                    onQuickAdd={quickAdd}
                  />
                ))}
              </section>
            );
          })}
          {menu.length === 0 && (
            <div className="gm-empty">
              <div className="gm-empty__icon"><UtensilsCrossed size={22} strokeWidth={1.6} /></div>
              <p className="gm-empty__title">Menu coming soon</p>
              <p className="gm-empty__desc">This restaurant hasn't published a menu yet.</p>
            </div>
          )}
        </div>

        <CartBar lines={cart} onOpen={() => setCartOpen(true)} />

        {sheetItem && (
          <AddToCartSheet
            item={sheetItem}
            editingLine={editingLine}
            onClose={() => { setSheetItem(null); setEditingLine(null); }}
            onConfirm={(qty, note) => addOrUpdateCart(sheetItem, qty, note)}
          />
        )}

        {cartOpen && (
          <CartSheet
            lines={cart}
            onClose={() => setCartOpen(false)}
            onEditLine={openEditLine}
            onChangeQty={changeLineQty}
            onPlaceOrder={placeOrder}
            placing={placing}
            error={orderError}
          />
        )}

        {trackingOpen && (
          <TrackingSheet orders={orders} onClose={() => setTrackingOpen(false)} connected={connected} />
        )}

        {toast && <Toast message={toast} />}
      </div>
    </div>
  );
}