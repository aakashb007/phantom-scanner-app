import React, { useState } from 'react';
import { Calendar, Bell, Check, X, Trash2 } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

interface ExpiryDateModalProps {
  isOpen: boolean;
  currentExpiry: number | null;
  onSave: (expiry: number | null) => void;
  onClose: () => void;
}

export const ExpiryDateModal: React.FC<ExpiryDateModalProps> = ({
  isOpen,
  currentExpiry,
  onSave,
  onClose,
}) => {
  const [dateStr, setDateStr] = useState<string>(() => {
    if (currentExpiry) {
      const d = new Date(currentExpiry);
      return d.toISOString().split('T')[0];
    }
    return '';
  });

  if (!isOpen) return null;

  const handleSave = () => {
    triggerHaptic('success');
    if (!dateStr) {
      onSave(null);
    } else {
      const parts = dateStr.split('-');
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 23, 59, 59);
      onSave(d.getTime());
    }
    onClose();
  };

  const addPresetMonths = (months: number) => {
    triggerHaptic('light');
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    setDateStr(d.toISOString().split('T')[0]);
  };

  const handleClear = () => {
    triggerHaptic('light');
    setDateStr('');
    onSave(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none">
      <div className="w-full max-w-sm bg-[#1C1C1E] border border-white/15 rounded-3xl p-5 shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-orange-400" />
            <h3 className="text-base font-bold">Document Expiry Date</h3>
          </div>
          <button
            onClick={() => {
              triggerHaptic('light');
              onClose();
            }}
            className="p-1 rounded-full text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Date Input */}
        <div className="mb-4">
          <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
            Select Expiry Date
          </label>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            className="w-full bg-white/10 text-white px-3.5 py-2.5 rounded-xl border border-white/15 text-sm focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Quick presets */}
        <div className="mb-5">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
            Quick Presets
          </span>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: '+3 Mo', months: 3 },
              { label: '+6 Mo', months: 6 },
              { label: '+1 Yr', months: 12 },
              { label: '+5 Yrs', months: 60 },
              { label: '+10 Yrs', months: 120 },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => addPresetMonths(p.months)}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-gray-200 ios-press"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Reminders explanation note */}
        <div className="p-3 bg-orange-500/15 border border-orange-500/30 rounded-2xl mb-5 flex items-start gap-2.5 text-xs text-orange-300 leading-snug">
          <Bell className="w-4 h-4 shrink-0 mt-0.5 text-orange-400" />
          <span>
            Reminders activate automatically <strong>30 days</strong>, <strong>7 days</strong> before, and on the day of expiry (shown as the &quot;Expiring soon&quot; banner on Home).
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {currentExpiry && (
            <button
              onClick={handleClear}
              className="py-2.5 px-3 rounded-xl bg-red-500/20 text-red-400 font-semibold text-xs hover:bg-red-500/30 ios-press flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Remove</span>
            </button>
          )}

          <button
            onClick={handleSave}
            className="flex-1 py-2.5 rounded-xl bg-[#5856D6] hover:bg-[#6866E6] text-white font-semibold text-sm shadow-md ios-press flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Save Expiry</span>
          </button>
        </div>
      </div>
    </div>
  );
};
