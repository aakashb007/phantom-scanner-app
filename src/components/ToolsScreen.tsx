import React from 'react';
import {
  FileText,
  Clock,
  Printer,
  Sparkles,
  Shield,
  Layers,
  Calendar,
  CheckCircle,
} from 'lucide-react';
import { DocumentRecord } from '../types/document';
import { triggerHaptic } from '../utils/haptics';

interface ToolsScreenProps {
  documents: DocumentRecord[];
  onOpenDocument: (doc: DocumentRecord) => void;
}

export const ToolsScreen: React.FC<ToolsScreenProps> = ({ documents, onOpenDocument }) => {
  const expiringDocs = documents.filter((d) => d.expiry && d.expiry > Date.now());

  return (
    <div className="flex-1 overflow-y-auto ios-scroll pb-24 p-4 sm:p-6 select-none max-w-3xl mx-auto w-full space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Scanner Tools</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Built-in browser utilities for PDF generation and document management.
        </p>
      </div>

      {/* Grid of Tools */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* PDF Batch Export */}
        <div className="bg-white dark:bg-[#1C1C1E] p-4 rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-xs flex flex-col justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#5856D6]/10 text-[#5856D6] dark:text-[#7D7AFF] flex items-center justify-center shrink-0">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-[15px] font-semibold text-gray-900 dark:text-white">
                PDF Batch Print
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Generate high-resolution printable PDFs from any scan without external servers.
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/5 flex items-center justify-between text-xs text-gray-400">
            <span>Client-side native print</span>
            <span className="text-[#5856D6] dark:text-[#7D7AFF] font-medium">Ready</span>
          </div>
        </div>

        {/* Expiry Tracker */}
        <div className="bg-white dark:bg-[#1C1C1E] p-4 rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-xs flex flex-col justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-500 flex items-center justify-center shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-[15px] font-semibold text-gray-900 dark:text-white">
                Expiry Alerts
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Track passports, ID cards, visas, and warranty deadlines locally.
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/5 flex items-center justify-between text-xs text-gray-400">
            <span>{expiringDocs.length} tracked items</span>
            <span className="text-orange-500 font-medium">Active</span>
          </div>
        </div>

        {/* Zero-Trace Sanitization */}
        <div className="bg-white dark:bg-[#1C1C1E] p-4 rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-xs flex flex-col justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-[15px] font-semibold text-gray-900 dark:text-white">
                Zero Cloud Leakage
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Strict isolated sandbox. Documents never leave your device browser storage.
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/5 flex items-center justify-between text-xs text-gray-400">
            <span>Security audit</span>
            <span className="text-emerald-500 font-medium flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" /> 100% Private
            </span>
          </div>
        </div>

        {/* Multi-Page Stitcher */}
        <div className="bg-white dark:bg-[#1C1C1E] p-4 rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-xs flex flex-col justify-between">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-[15px] font-semibold text-gray-900 dark:text-white">
                Multi-Page Booklets
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Combine receipts, agreements, and notes into multi-page documents seamlessly.
              </p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100 dark:border-white/5 flex items-center justify-between text-xs text-gray-400">
            <span>Automatic ordering</span>
            <span className="text-purple-500 font-medium">Supported</span>
          </div>
        </div>
      </div>
    </div>
  );
};
