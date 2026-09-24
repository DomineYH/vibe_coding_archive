import React from "react";
import { Check, Lock } from "lucide-react";

export function StatusBadge({ status, isPublic }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
      {isPublic ? (
        <Check className="w-3.5 h-3.5" data-testid="status-check-icon" />
      ) : (
        <Lock className="w-3.5 h-3.5" data-testid="status-lock-icon" />
      )}
      <span>{status}</span>
    </div>
  );
}
