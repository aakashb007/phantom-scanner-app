import React from 'react';
import { triggerHaptic } from '../../utils/haptics';

interface IOSSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  activeColor?: string;
}

export const IOSSwitch: React.FC<IOSSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  activeColor = 'bg-[#34C759]', // iOS Green or Indigo #5856D6
}) => {
  const toggle = () => {
    if (disabled) return;
    triggerHaptic('light');
    onChange(!checked);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={toggle}
      className={`relative inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer rounded-full p-[2px] transition-colors duration-200 ease-in-out focus:outline-none ${
        checked ? activeColor : 'bg-[#E9E9EB] dark:bg-[#39393D]'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`pointer-events-none inline-block h-[27px] w-[27px] transform rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)] transition-transform duration-200 ease-in-out ${
          checked ? 'translate-x-[20px]' : 'translate-x-0'
        }`}
      />
    </button>
  );
};
