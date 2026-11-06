import React, { useState } from 'react';
import { Sparkles, Sliders, Check, X, Layers } from 'lucide-react';
import { DocFilterType } from '../utils/documentFilters';
import { triggerHaptic } from '../utils/haptics';

interface FilterPickerModalProps {
  isOpen: boolean;
  onApply: (filter: DocFilterType, scope: 'page' | 'all') => void;
  onClose: () => void;
}

export const FilterPickerModal: React.FC<FilterPickerModalProps> = ({
  isOpen,
  onApply,
  onClose,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<DocFilterType>('smart_hd');
  const [scope, setScope] = useState<'page' | 'all'>('page');

  if (!isOpen) return null;

  const filters: { id: DocFilterType; name: string; desc: string }[] = [
    {
      id: 'smart_hd',
      name: 'Smart HD (4K)',
      desc: 'Enlarges to 4K, whitens paper background, removes shadows and sharpens text',
    },
    {
      id: 'magic_color',
      name: 'Magic Color',
      desc: 'Vibrant contrast boost with saturated document colors',
    },
    {
      id: 'enhance',
      name: 'Enhance',
      desc: 'Balanced illumination leveling and subtle shadow lifting',
    },
    {
      id: 'grayscale',
      name: 'Grayscale',
      desc: 'Smooth neutral monochrome shading',
    },
    {
      id: 'black_white',
      name: 'Black & White',
      desc: 'High-contrast adaptive binarization for clean printouts',
    },
  ];

  const handleApply = () => {
    triggerHaptic('success');
    onApply(selectedFilter, scope);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm select-none">
      <div className="w-full max-w-sm bg-[#1C1C1E] border border-white/15 rounded-3xl p-5 shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#7D7AFF]" />
            <h3 className="text-base font-bold">Document Filters</h3>
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

        {/* Scope Selector: This Page vs All Pages */}
        <div className="mb-4">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
            Apply Filter To
          </span>
          <div className="flex bg-white/10 p-1 rounded-xl">
            <button
              onClick={() => {
                triggerHaptic('light');
                setScope('page');
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                scope === 'page' ? 'bg-[#5856D6] text-white shadow-xs' : 'text-gray-400 hover:text-white'
              }`}
            >
              This Page Only
            </button>
            <button
              onClick={() => {
                triggerHaptic('light');
                setScope('all');
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                scope === 'all' ? 'bg-[#5856D6] text-white shadow-xs' : 'text-gray-400 hover:text-white'
              }`}
            >
              All Pages in Document
            </button>
          </div>
        </div>

        {/* Filter List */}
        <div className="space-y-2 mb-6 max-h-60 overflow-y-auto ios-scroll">
          {filters.map((f) => (
            <div
              key={f.id}
              onClick={() => {
                triggerHaptic('light');
                setSelectedFilter(f.id);
              }}
              className={`p-3 rounded-2xl border cursor-pointer transition-all ${
                selectedFilter === f.id
                  ? 'border-[#5856D6] bg-[#5856D6]/15 ring-1 ring-[#5856D6]'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{f.name}</span>
                {selectedFilter === f.id && <Check className="w-4 h-4 text-[#7D7AFF]" />}
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Apply Button */}
        <button
          onClick={handleApply}
          className="w-full py-3 rounded-2xl bg-[#5856D6] hover:bg-[#6866E6] text-white font-semibold text-sm shadow-lg ios-press"
        >
          Apply Filter
        </button>
      </div>
    </div>
  );
};
