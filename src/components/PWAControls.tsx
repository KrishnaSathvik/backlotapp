'use client';

import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/src/hooks/usePWAInstall';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="animate-toast-in fixed left-1/2 top-[calc(4rem+env(safe-area-inset-top))] z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
    >
      <WifiOff className="h-3.5 w-3.5 text-cantaloupe-400 dark:text-cantaloupe-600" aria-hidden="true" />
      You’re offline — changes won’t save until you reconnect
    </div>
  );
};
