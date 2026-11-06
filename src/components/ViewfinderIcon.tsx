import React from 'react';

interface ViewfinderIconProps {
  size?: number;
  className?: string;
  rounded?: string;
}

export const ViewfinderIcon: React.FC<ViewfinderIconProps> = ({
  size = 40,
  className = '',
  rounded = 'rounded-2xl',
}) => {
  return (
    <div
      style={{ width: size, height: size }}
      className={`relative bg-[#0B0B10] flex items-center justify-center shadow-md select-none shrink-0 overflow-hidden ${rounded} ${className}`}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full p-[18%]"
      >
        {/* Four white scan-frame corners */}
        {/* Top-Left */}
        <path
          d="M 12 28 L 12 12 L 28 12"
          stroke="#FFFFFF"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Top-Right */}
        <path
          d="M 72 12 L 88 12 L 88 28"
          stroke="#FFFFFF"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Bottom-Left */}
        <path
          d="M 12 72 L 12 88 L 28 88"
          stroke="#FFFFFF"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Bottom-Right */}
        <path
          d="M 72 88 L 88 88 L 88 72"
          stroke="#FFFFFF"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Violet (#A78BFA) letter P */}
        <path
          d="M 38 28 L 38 72 M 38 28 L 56 28 C 68 28 68 48 56 48 L 38 48"
          stroke="#A78BFA"
          strokeWidth="7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
