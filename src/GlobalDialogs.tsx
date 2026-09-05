import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, X, User, Phone } from 'lucide-react';
import './GlobalDialogs.css';

/* =====================================================================
   Types + window augmentation

   Register once, call from anywhere (event handlers, other components,
   even plain non-React code) as:

     const ok = await window.askUserConfirmation({ message: 'Place this order?' });
     if (ok) { ... }

     const info = await window.askUserForNameAndPhone();
     if (info) { ... } // null if the user closed/cancelled the dialog

     if (!window.hasUserNameAndPhone()) { ... }
   ===================================================================== */

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // styles the confirm button red, for destructive actions
}

export interface GuestInfo {
  name: string;
  phone: string; // normalized to 10 digits, no country code/spaces
}

declare global {
  interface Window {
    askUserConfirmation: (options?: ConfirmOptions) => Promise<boolean>;
    askUserForNameAndPhone: () => Promise<GuestInfo | null>;
    hasUserNameAndPhone: () => boolean;
  }
}

const GUEST_INFO_KEY = 'guest_user_info';

/* =====================================================================
   localStorage helpers
   ===================================================================== */

function readGuestInfo(): GuestInfo | null {
  try {
    const raw = localStorage.getItem(GUEST_INFO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.name === 'string' && typeof parsed?.phone === 'string' && parsed.name && parsed.phone) {
      return parsed as GuestInfo;
    }
    return null;
  } catch {
    return null;
  }
}

function writeGuestInfo(info: GuestInfo) {
  localStorage.setItem(GUEST_INFO_KEY, JSON.stringify(info));
}

/* =====================================================================
   Validation — deliberately simple ("basic checks")
   ===================================================================== */

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return 'Please enter your name.';
  if (trimmed.length > 60) return 'That name looks too long.';
  if (!/[a-zA-Z]/.test(trimmed)) return 'Please enter a valid name.';
  return null;
}

// Accepts Indian mobile numbers: 10 digits, starting 6-9, optionally
// written with a +91 prefix, spaces, or dashes. Adjust the regex if
// you're serving guests outside India.
function validatePhone(phone: string): string | null {
  const digits = normalizePhone(phone);
  if (digits.length !== 10) return 'Enter a valid 10-digit phone number.';
  if (!/^[6-9]/.test(digits)) return "That doesn't look like a valid mobile number.";
  return null;
}

function normalizePhone(phone: string): string {
  const digitsOnly = phone.replace(/\D/g, '');
  return digitsOnly.length > 10 && digitsOnly.startsWith('91')
    ? digitsOnly.slice(2)
    : digitsOnly.slice(-10);
}

/* =====================================================================
   Host component — mount this ONCE near the root of your app. While
   mounted it keeps window.askUserConfirmation / askUserForNameAndPhone /
   hasUserNameAndPhone registered; it renders nothing visible until one
   of them is actually called.
   ===================================================================== */

type ConfirmState = { options: ConfirmOptions; resolve: (v: boolean) => void };
type NameState = { resolve: (v: GuestInfo | null) => void };

export function GlobalDialogHost() {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [nameState, setNameState] = useState<NameState | null>(null);

  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const closeConfirm = useCallback((result: boolean) => {
    setConfirmState((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  const closeName = useCallback((result: GuestInfo | null) => {
    setNameState((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  const askUserConfirmation = useCallback((options: ConfirmOptions = {}) => {
    return new Promise<boolean>((resolve) => {
      // only one confirmation at a time — resolve any pending one as
      // "cancelled" rather than leaving its promise hanging forever
      setConfirmState((current) => {
        current?.resolve(false);
        return { options, resolve };
      });
    });
  }, []);

  const askUserForNameAndPhone = useCallback(() => {
    const existing = readGuestInfo();
    setNameInput(existing?.name ?? '');
    setPhoneInput(existing?.phone ?? '');
    setNameError(null);
    setPhoneError(null);
    return new Promise<GuestInfo | null>((resolve) => {
      setNameState((current) => {
        current?.resolve(null);
        return { resolve };
      });
    });
  }, []);

  const hasUserNameAndPhone = useCallback(() => readGuestInfo() !== null, []);

  useEffect(() => {
    window.askUserConfirmation = askUserConfirmation;
    window.askUserForNameAndPhone = askUserForNameAndPhone;
    window.hasUserNameAndPhone = hasUserNameAndPhone;
  }, [askUserConfirmation, askUserForNameAndPhone, hasUserNameAndPhone]);

  // Escape closes whichever dialog is open, resolving it as "cancelled"
  useEffect(() => {
    if (!confirmState && !nameState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirmState) closeConfirm(false);
      if (nameState) closeName(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmState, nameState, closeConfirm, closeName]);

  const handleNameSubmit = (e: FormEvent) => {
    e.preventDefault();
    const nErr = validateName(nameInput);
    const pErr = validatePhone(phoneInput);
    setNameError(nErr);
    setPhoneError(pErr);
    if (nErr || pErr) return;

    const info: GuestInfo = { name: nameInput.trim(), phone: normalizePhone(phoneInput) };
    writeGuestInfo(info);
    closeName(info);
  };

  return (
    <>
      {confirmState && (
        <div className="gd-backdrop" onClick={() => closeConfirm(false)}>
          <div className="gd-dialog gd-confirm" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={`gd-confirm-icon ${confirmState.options.danger ? 'gd-confirm-icon--danger' : ''}`}>
              <AlertTriangle size={20} strokeWidth={1.8} />
            </div>
            <h3 className="gd-dialog-title">{confirmState.options.title ?? 'Are you sure?'}</h3>
            {confirmState.options.message && <p className="gd-dialog-message">{confirmState.options.message}</p>}
            <div className="gd-dialog-actions">
              <button className="gd-btn gd-btn-ghost" onClick={() => closeConfirm(false)}>
                {confirmState.options.cancelLabel ?? 'Cancel'}
              </button>
              <button
                className={`gd-btn ${confirmState.options.danger ? 'gd-btn-danger' : 'gd-btn-primary'}`}
                onClick={() => closeConfirm(true)}
                autoFocus
              >
                {confirmState.options.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {nameState && (
        <div className="gd-backdrop" onClick={() => closeName(null)}>
          <div className="gd-dialog gd-name-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="gd-dialog-close" onClick={() => closeName(null)} aria-label="Close">
              <X size={16} />
            </button>
            <h3 className="gd-dialog-title">A couple of details first</h3>
            <p className="gd-dialog-message">We'll use this to keep you posted on your order.</p>

            <form onSubmit={handleNameSubmit} className="gd-form" noValidate>
              <label className="gd-field">
                <span><User size={13} strokeWidth={2} /> Your name</span>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="e.g. Aditi Sharma"
                  autoFocus
                />
                {nameError && <em className="gd-field-error">{nameError}</em>}
              </label>

              <label className="gd-field">
                <span><Phone size={13} strokeWidth={2} /> Phone number</span>
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="98765 43210"
                  inputMode="numeric"
                />
                {phoneError && <em className="gd-field-error">{phoneError}</em>}
              </label>

              <button type="submit" className="gd-btn gd-btn-primary gd-btn-full">
                Continue
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}