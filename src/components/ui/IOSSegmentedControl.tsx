import React from 'react';
import { motion } from 'motion/react';
import { triggerHaptic } from '../../utils/haptics';

interface Option<T extends string> {
  value: T;
  label: React.ReactNode;
}

interface IOSSegmentedControlProps<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export function IOSSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = '',
  size = 'md',
}: IOSSegmentedControlProps<T>) {
  const handleSelect = (val: T) => {
    if (val !== value) {
      triggerHaptic('light');
      onChange(val);
    }
  };

  const pad = size === 'sm' ? 'p-0.5 text-xs' : 'p-1 text-sm';
  const itemPad = size === 'sm' ? 'py-1 px-2.5' : 'py-1.5 px-3.5';

  return (
    <div
      role="tablist"
      className={`relative flex items-center bg-[#767680]/15 dark:bg-[#767680]/25 rounded-[9px] select-none ${pad} ${className}`}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={isSelected}
            onClick={() => handleSelect(opt.value)}
            className={`relative flex-1 flex items-center justify-center font-medium transition-colors z-10 rounded-[7px] cursor-pointer ${itemPad} ${
              isSelected
                ? 'text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
            }`}
          >
            {isSelected && (
              <motion.div
                layoutId="iosSegmentedIndicator"
                className="absolute inset-0 bg-white dark:bg-[#636366] rounded-[7px] shadow-sm -z-10"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
