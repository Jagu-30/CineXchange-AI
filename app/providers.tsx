'use client';

import type { ReactNode } from 'react';
import { MissionProvider } from '@/lib/mission-context';

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  return <MissionProvider>{children}</MissionProvider>;
}
