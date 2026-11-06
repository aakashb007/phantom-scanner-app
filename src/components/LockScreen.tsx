import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Lock, ScanFace, Delete, X } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';
import {
  checkPin,
  hasPasskey,
  hasPin,
  verifyPasskey,
  setPin,
  isBiometricAvailable,
  createPasskey,
} from '../utils/security';

interface LockScreenProps {
  title: string;
  subtitle?: string;
  onUnlock: () => void;
  onCancel?: () => void;
  /** Full-screen cover (App Lock) or an inline panel (Vault). */
  fullScreen?: boolean;
}

/** Unlock with Face ID / Touch ID / fingerprint (passkey) or the PIN. Sets up a PIN the first time. */
export const LockScreen: React.FC<LockScreenProps> = ({ title, subtitle, onUnlock, onCancel, fullScreen }) => {
  const [mode, setMode] = useState<'loading' | 'unlock' | 'setup' | 'confirm'>('loading');
  const [pin, setPinValue] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, k, bio] = await Promise.all([hasPin(), hasPasskey(), isBiometricAvailable()]);
      setBioAvailable(bio);
      setBioEnrolled(k);
      setMode(p || k ? 'unlock' : 'setup');
    })();
  }, []);

  const tryBiometric = async () => {
    setError('');
    const ok = await verifyPasskey();
    if (ok) {
      triggerHaptic('success');
      onUnlock();
    } else setError('Not recognised. Try again or use your PIN.');
  };

  const pressDigit = async (d: string) => {
    triggerHaptic('light');
    setError('');
    const next = (pin + d).slice(0, 6);
    setPinValue(next);
    if (mode === 'unlock' && next.length >= 4) {
      if (await checkPin(next)) {
        triggerHaptic('success');
        onUnlock();
      } else if (next.length === 6) {
        triggerHaptic('warning');
        setError('Wrong PIN');
        setPinValue('');
      }
    }
  };

  const submitSetup = async () => {
    if (mode === 'setup') {
      if (pin.length < 4) return setError('Use 4 to 6 digits');
      setFirstPin(pin);
      setPinValue('');
      setMode('confirm');
    } else if (mode === 'confirm') {
      if (pin !== firstPin) {
        setError('PINs do not match. Start again.');
        setPinValue('');
        setFirstPin('');
        setMode('setup');
        return;
      }
      await setPin(pin);
      if (bioAvailable) {
        try {
          await createPasskey();
        } catch {
          /* the PIN still works */
        }
      }
      triggerHaptic('success');
      onUnlock();
    }
  };

  const heading =
    mode === 'setup' ? 'Create a PIN' : mode === 'confirm' ? 'Enter the PIN again' : title;
  const sub =
    mode === 'setup'
      ? `4 to 6 digits.${bioAvailable ? ' Face ID / fingerprint is added next.' : ''}`
      : mode === 'confirm'
      ? 'Confirm your new PIN'
      : subtitle;

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'];

  return (
    <div
      className={`${
        fullScreen ? 'fixed inset-0 z-[100] pt-safe pb-safe' : 'relative flex-1 w-full overflow-y-auto pb-32 lg:pb-6'
      } flex flex-col items-center justify-center bg-[#F2F2F7] dark:bg-black text-gray-900 dark:text-white select-none p-6`}
    >
      {onCancel && (
        <button onClick={onCancel} className="absolute top-4 right-4 mt-safe p-2 rounded-full bg-black/5 dark:bg-white/10 ios-press" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      )}
      <div className="w-14 h-14 rounded-2xl bg-[#5856D6] text-white flex items-center justify-center mb-4 shadow-lg">
        <Lock className="w-7 h-7" />
      </div>
      <h2 className="text-xl font-bold">{heading}</h2>
      {sub && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 text-center max-w-xs">{sub}</p>}

      <div className="flex gap-3 my-6 h-4">
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <motion.span
            key={i}
            animate={{ scale: i < pin.length ? 1.15 : 1 }}
            className={`w-3.5 h-3.5 rounded-full border-2 border-[#5856D6] dark:border-[#7D7AFF] ${
              i < pin.length ? 'bg-[#5856D6] dark:bg-[#7D7AFF]' : ''
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-red-500 h-4 mb-2">{error}</p>

      {mode !== 'loading' && (
        <div className="grid grid-cols-3 gap-4">
          {keys.map((k) => {
            if (k === 'bio') {
              if (mode === 'unlock' && bioEnrolled) {
                return (
                  <button key={k} onClick={tryBiometric} className="w-[72px] h-[72px] rounded-full flex items-center justify-center ios-press text-[#5856D6] dark:text-[#7D7AFF]" aria-label="Face ID or fingerprint">
                    <ScanFace className="w-8 h-8" />
                  </button>
                );
              }
              if (mode !== 'unlock') {
                return (
                  <button key={k} onClick={submitSetup} className="w-[72px] h-[72px] rounded-full flex items-center justify-center ios-press text-[#5856D6] dark:text-[#7D7AFF] font-semibold text-sm">
                    OK
                  </button>
                );
              }
              return <span key={k} />;
            }
            if (k === 'del') {
              return (
                <button key={k} onClick={() => setPinValue(pin.slice(0, -1))} className="w-[72px] h-[72px] rounded-full flex items-center justify-center ios-press" aria-label="Delete">
                  <Delete className="w-6 h-6" />
                </button>
              );
            }
            return (
              <button
                key={k}
                onClick={() => pressDigit(k)}
                className="w-[68px] h-[68px] rounded-full bg-white dark:bg-[#1C1C1E] shadow-sm text-2xl font-medium ios-press"
              >
                {k}
              </button>
            );
          })}
        </div>
      )}
      {mode === 'unlock' && bioEnrolled && (
        <button onClick={tryBiometric} className="mt-6 text-sm font-semibold text-[#5856D6] dark:text-[#7D7AFF] ios-press">
          Use Face ID / fingerprint
        </button>
      )}
    </div>
  );
};
