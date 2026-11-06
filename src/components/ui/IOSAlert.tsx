import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { triggerHaptic } from '../../utils/haptics';

export interface AlertButton {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'cancel' | 'destructive';
  isBold?: boolean;
}

interface IOSAlertProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  buttons: AlertButton[];
}

export const IOSAlert: React.FC<IOSAlertProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  buttons,
}) => {
  // Listen for Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop blur */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
          />

          {/* Dialog Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 8 }}
            transition={{ type: 'spring', damping: 28, stiffness: 350 }}
            className="relative w-full max-w-[310px] sm:max-w-[360px] bg-[#F2F2F2]/90 dark:bg-[#1E1E1E]/90 backdrop-blur-xl rounded-[16px] shadow-2xl border border-white/20 dark:border-white/10 overflow-hidden text-center z-10"
          >
            {/* Header Content */}
            <div className="p-5 pb-4">
              <h3 className="text-[17px] font-semibold text-gray-900 dark:text-white leading-tight">
                {title}
              </h3>
              {description && (
                <p className="mt-1.5 text-[13px] text-gray-500 dark:text-gray-400 leading-snug">
                  {description}
                </p>
              )}
              {children && <div className="mt-4 text-left">{children}</div>}
            </div>

            {/* iOS Action Buttons */}
            <div
              className={`border-t border-[#3C3C43]/20 dark:border-[#545458]/40 grid ${
                buttons.length === 2 ? 'grid-cols-2 divide-x divide-[#3C3C43]/20 dark:divide-[#545458]/40' : 'grid-cols-1 divide-y divide-[#3C3C43]/20 dark:divide-[#545458]/40'
              }`}
            >
              {buttons.map((btn, idx) => {
                const isDestructive = btn.variant === 'destructive';
                const isCancel = btn.variant === 'cancel';

                let colorClasses = 'text-[#5856D6] dark:text-[#7D7AFF]';
                if (isDestructive) colorClasses = 'text-[#FF3B30] dark:text-[#FF453A]';
                else if (isCancel) colorClasses = 'text-gray-600 dark:text-gray-300';

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      btn.onClick();
                    }}
                    className={`h-[44px] text-[16px] flex items-center justify-center active:bg-black/5 dark:active:bg-white/10 transition-colors ${colorClasses} ${
                      btn.isBold ? 'font-semibold' : 'font-normal'
                    }`}
                  >
                    {btn.label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
