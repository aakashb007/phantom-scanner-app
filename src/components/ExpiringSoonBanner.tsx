import React, { useState } from 'react';
import { AlertTriangle, Calendar, ChevronDown, ChevronUp, ChevronRight, X, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DocumentRecord } from '../types/document';
import { triggerHaptic } from '../utils/haptics';

interface ExpiringSoonBannerProps {
  documents: DocumentRecord[];
  onOpenDocument: (doc: DocumentRecord) => void;
}

export const ExpiringSoonBanner: React.FC<ExpiringSoonBannerProps> = ({
  documents,
  onOpenDocument,
}) => {
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Filter for non-vault docs with expiry within next 30 days or already expired
  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  const expiringDocs = documents
    .filter((doc) => !doc.vault && doc.expiry !== null && doc.expiry <= now + THIRTY_DAYS_MS)
    .sort((a, b) => (a.expiry || 0) - (b.expiry || 0));

  if (isDismissed || expiringDocs.length === 0) {
    return null;
  }

  const formatExpiryTimeLeft = (expiryTime: number) => {
    const diffMs = expiryTime - now;
    const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

    if (diffDays < 0) {
      const pastDays = Math.abs(diffDays);
      return pastDays === 1 ? 'Expired yesterday' : `Expired ${pastDays} days ago`;
    }
    if (diffDays === 0) return 'Expires today';
    if (diffDays === 1) return 'Expires tomorrow';
    return `Expires in ${diffDays} days`;
  };

  const getBadgeStyle = (expiryTime: number) => {
    const isPast = expiryTime < now;
    if (isPast) {
      return 'bg-red-500/20 text-red-700 dark:text-red-400 border border-red-500/30';
    }
    return 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30';
  };

  const urgentCount = expiringDocs.filter((d) => (d.expiry || 0) < now).length;

  return (
    <div className="mb-3 px-1">
      <div className="rounded-2xl border border-amber-500/40 dark:border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/15 overflow-hidden shadow-xs backdrop-blur-md">
        {/* Banner Header */}
        <div className="p-3 sm:p-3.5 flex items-center justify-between gap-3">
          <div
            onClick={() => {
              triggerHaptic('light');
              setIsExpanded(!isExpanded);
            }}
            className="flex-1 flex items-center gap-2.5 cursor-pointer select-none"
          >
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 dark:bg-amber-500/30 flex items-center justify-center shrink-0 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                  Expiring soon
                </span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/25 text-amber-900 dark:text-amber-200">
                  {expiringDocs.length} {expiringDocs.length === 1 ? 'document' : 'documents'}
                </span>
                {urgentCount > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-700 dark:text-red-300">
                    {urgentCount} overdue
                  </span>
                )}
              </div>
              <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 truncate">
                {expiringDocs[0].name} ({formatExpiryTimeLeft(expiringDocs[0].expiry!)})
              </p>
            </div>
          </div>

          {/* Controls: Expand/Collapse & Dismiss */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => {
                triggerHaptic('light');
                setIsExpanded(!isExpanded);
              }}
              className="p-1.5 rounded-lg text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 ios-press"
              title={isExpanded ? 'Hide list' : 'View expiring documents'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                triggerHaptic('light');
                setIsDismissed(true);
              }}
              className="p-1.5 rounded-lg text-amber-800/70 dark:text-amber-300/70 hover:bg-amber-500/20 hover:text-amber-900 dark:hover:text-white ios-press"
              title="Dismiss banner"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Collapsible Expiring Documents List */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-amber-500/20 dark:border-amber-500/20 bg-white/40 dark:bg-black/30 divide-y divide-amber-500/15"
            >
              {expiringDocs.map((doc) => {
                const firstPage = doc.pages[0];
                const isOverdue = (doc.expiry || 0) < now;

                return (
                  <div
                    key={doc.docId}
                    onClick={() => {
                      triggerHaptic('light');
                      onOpenDocument(doc);
                    }}
                    className="p-2.5 sm:px-3.5 flex items-center justify-between gap-3 hover:bg-amber-500/10 cursor-pointer transition-colors ios-press-subtle"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-11 bg-gray-200 dark:bg-gray-800 rounded-md overflow-hidden shrink-0 border border-black/5 dark:border-white/10">
                        {firstPage?.dataUrl ? (
                          <img
                            src={firstPage.dataUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">
                            📄
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <h4 className="text-xs font-semibold text-gray-900 dark:text-white truncate">
                          {doc.name}
                        </h4>
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                          <span>{doc.category}</span>
                          <span>•</span>
                          <span>{doc.folder || 'Default'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${getBadgeStyle(
                          doc.expiry!
                        )}`}
                      >
                        <Clock className="w-3 h-3" />
                        <span>{formatExpiryTimeLeft(doc.expiry!)}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
