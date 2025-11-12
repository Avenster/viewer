// PdfModal.tsx
import React, { useEffect } from "react";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  pdfObjectUrl: string | null; // object URL or null while loading
};

export default function PdfModal({ isOpen, onClose, pdfObjectUrl }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative max-w-6xl w-full h-[85vh] bg-gray-900 rounded-lg shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
          <div className="text-sm text-white font-medium">PDF Preview</div>
          <div>
            <button onClick={onClose} className="px-3 py-1 rounded text-sm border border-gray-700 text-white">Close</button>
          </div>
        </div>

        <div className="w-full h-full bg-black flex items-center justify-center">
          {pdfObjectUrl ? (
            // embed via iframe/object URL for native PDF viewer
            <iframe
              src={pdfObjectUrl}
              title="PDF viewer"
              className="w-full h-full border-0"
            />
          ) : (
            <div className="text-white/80">Loading PDF…</div>
          )}
        </div>
      </div>
    </div>
  );
}
