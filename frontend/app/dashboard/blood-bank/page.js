'use client';

import { useSyncExternalStore } from 'react';
import HospitalDashboard from '../hospital/page';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Activity, ShieldCheck, ShieldX } from 'lucide-react';

function subscribe() {
  return () => {};
}

export default function BloodBankDashboard() {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  const user = isClient ? JSON.parse(localStorage.getItem('user') || 'null') : null;
  const dcgiVerified = user?.license_type === 'DCGI_Verified';

  if (!user) {
    return null;
  }

  return (
    <div className="space-y-8">
      <Card className="border-[#0b4ea2]/25">
        <CardHeader>
          <Badge variant={dcgiVerified ? 'success' : 'saffron'}>
            {dcgiVerified ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldX className="h-3.5 w-3.5" />}
            {dcgiVerified ? 'DCGI Verified' : 'Verification Restricted'}
          </Badge>
          <CardTitle>Blood bank issuance control</CardTitle>
          <CardDescription>
            Issue workflows are enabled only when the linked registry record reports `license_type: DCGI_Verified`.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-slate-300">License number: <span className="font-semibold text-white">{user.dcgiLicenseNumber || 'Unavailable'}</span></p>
            <p className="mt-1 text-sm text-slate-300">HFR mapping: <span className="font-semibold text-white">{user.hfrFacilityId || 'Unavailable'}</span></p>
            <p className="mt-1 text-sm text-slate-300">Registry state: <span className="font-semibold text-white">{user.license_type || user.licenseStatus || 'Pending'}</span></p>
          </div>
          <Button variant={dcgiVerified ? 'success' : 'secondary'} size="lg" disabled={!dcgiVerified} className={!dcgiVerified ? 'bg-slate-700 text-slate-300 hover:bg-slate-700' : ''}>
            {dcgiVerified ? <><Activity className="h-4 w-4" /> Issue Blood</> : 'Issue Blood Locked'}
          </Button>
        </CardContent>
      </Card>
      <HospitalDashboard />
    </div>
  );
}

